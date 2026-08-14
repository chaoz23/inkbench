#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { BUG_FAMILIES, SCHEMA_VERSION, type AlgorithmId, type BugFamily, type ExperimentConfig, type ResourceLimits, type RunProgressEvent } from "./core/types.js";
import { generateFixture } from "./fixtures/generate.js";
import { runBenchmark } from "./core/run.js";
import { runBenchmarkIsolated } from "./core/isolated.js";
import { InstrumentedController } from "./core/runtime.js";
import { writeJsonAtomic } from "./core/atomic.js";
import { runExperiment, writeExperiment } from "./experiments/run.js";
import { runExperimentIsolated } from "./experiments/isolated.js";
import { listAuthoredStories, loadAuthoredFixture } from "./corpus/load.js";
import { runAuthoredExperiment, writeAuthoredExperiment, type AuthoredExperimentConfig } from "./corpus/experiment.js";
import { runAuthoredExperimentIsolated } from "./corpus/isolated.js";
import { listAuthoredPlantedStories, loadAuthoredPlantedFixture, loadAuthoredPlantedWitnesses } from "./mutants/load.js";
import { runMutantExperiment, writeMutantExperiment, type MutantExperimentConfig } from "./mutants/experiment.js";
import { runMutantExperimentIsolated } from "./mutants/isolated.js";

const ALGORITHMS: readonly AlgorithmId[] = ["random", "systematic", "coverage", "swarm", "inkcheck"];

function usage(message?: string): never {
  if (message) console.error(`error: ${message}\n`);
  console.error(`InkBench 0.1.0 — neutral planted-bug benchmarks for Ink search strategies

Usage:
  inkbench families
  inkbench generate --family <name> [--fixture-seed N] [--difficulty N] [--out DIR]
  inkbench run --family <name> --algorithm random|systematic|coverage|swarm|inkcheck
               [--fixture-seed N] [--search-seed N] [--story-seed N]
               [--difficulty N] [--budget N] [--time-budget-ms N] [--inkcheck-command PATH] [--json]
               [--isolated] [--max-memory-mb N] [--max-time-seconds N]
               [--worker-heap-mb N] [--progress ndjson|off] [--progress-file FILE]
  inkbench experiment [--preset quick|development|mature|marathon-20m|marathon-60m] [--config FILE] [--out DIR]
                      [--inkcheck-command PATH] [--isolated] [--resume]
                      [--max-memory-mb N] [--max-time-seconds N]
                      [--worker-heap-mb N] [--progress ndjson|off]
  inkbench corpus list
  inkbench corpus verify
  inkbench corpus run --story <id> --algorithm random|systematic|coverage|swarm|inkcheck
                      [--search-seed N] [--story-seed N] [--budget N]
                      [--time-budget-ms N] [--inkcheck-command PATH] [--json] [--isolated]
                      [--max-memory-mb N] [--max-time-seconds N]
                      [--worker-heap-mb N] [--progress ndjson|off] [--progress-file FILE]
  inkbench corpus experiment [--preset smoke|development|mature|marathon-20m|marathon-60m] [--config FILE]
                             [--out DIR] [--inkcheck-command PATH] [--isolated] [--resume]
                             [--max-memory-mb N] [--max-time-seconds N]
                             [--worker-heap-mb N] [--progress ndjson|off]
  inkbench mutants list
  inkbench mutants verify
  inkbench mutants run --story the-intercept-20
                       --algorithm random|systematic|coverage|swarm|inkcheck
                       [--search-seed N] [--story-seed N] [--budget N]
                       [--time-budget-ms N] [--inkcheck-command PATH] [--json] [--isolated]
                       [--max-memory-mb N] [--max-time-seconds N]
                       [--worker-heap-mb N] [--progress ndjson|off] [--progress-file FILE]
  inkbench mutants experiment [--preset smoke|development|mature|marathon-20m|marathon-60m] [--config FILE]
                              [--out DIR] [--inkcheck-command PATH] [--isolated] [--resume]
                              [--max-memory-mb N] [--max-time-seconds N]
                              [--worker-heap-mb N] [--progress ndjson|off]

The primary in-process budget unit is one legal Ink choice transition. The
InkCheck adapter retains InkCheck's native state unit and labels it explicitly.`);
  process.exit(2);
}

function value(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const found = args[index + 1];
  if (!found || found.startsWith("--")) usage(`${name} requires a value`);
  return found;
}

function integer(args: string[], name: string, fallback: number, min = 1): number {
  const raw = value(args, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min) usage(`${name} must be an integer >= ${min}`);
  return parsed;
}

function optionalInteger(args: string[], name: string, min = 1): number | undefined {
  const raw = value(args, name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min) usage(`${name} must be an integer >= ${min}`);
  return parsed;
}

function resourcesFromArgs(args: string[], base?: ResourceLimits): ResourceLimits | undefined {
  const maxMemoryMb = optionalInteger(args, "--max-memory-mb");
  const maxTimeSeconds = optionalInteger(args, "--max-time-seconds");
  const progressIntervalTransitions = optionalInteger(args, "--progress-interval");
  const merged: ResourceLimits = {
    ...(base ?? {}),
    ...(maxMemoryMb === undefined ? {} : { maxMemoryMb }),
    ...(maxTimeSeconds === undefined ? {} : { maxTimeMs: maxTimeSeconds * 1_000 }),
    ...(progressIntervalTransitions === undefined ? {} : { progressIntervalTransitions }),
  };
  return Object.keys(merged).length === 0 ? undefined : merged;
}

function progressWriter(args: string[]): ((event: RunProgressEvent) => void) | undefined {
  const mode = value(args, "--progress") ?? "off";
  if (mode !== "off" && mode !== "ndjson") usage("--progress must be ndjson or off");
  const path = value(args, "--progress-file");
  if (mode === "off" && !path) return undefined;
  return (event) => {
    if (mode === "ndjson") process.stderr.write(`${JSON.stringify(event)}\n`);
    if (path) writeJsonAtomic(resolve(path), event);
  };
}

function familyArg(args: string[]): BugFamily {
  const family = value(args, "--family");
  if (!family) usage("--family is required");
  if (!BUG_FAMILIES.includes(family as BugFamily)) usage(`unknown family ${family}`);
  return family as BugFamily;
}

function algorithmArg(args: string[]): AlgorithmId {
  const algorithm = value(args, "--algorithm") ?? "random";
  if (!ALGORITHMS.includes(algorithm as AlgorithmId)) usage(`unknown algorithm ${algorithm}`);
  return algorithm as AlgorithmId;
}

function preset(name: string): ExperimentConfig {
  if (name === "quick") {
    return {
      schemaVersion: SCHEMA_VERSION,
      families: ["shallow-obvious", "deep-corridor", "combination-lock", "novelty-honeypot"],
      algorithms: ["random", "systematic", "coverage", "swarm"],
      fixtureSeeds: [1, 2],
      searchSeeds: [1, 2],
      budgets: [100],
      difficulty: 2,
      storySeed: 1,
    };
  }
  if (name === "development") {
    return {
      schemaVersion: SCHEMA_VERSION,
      families: [...BUG_FAMILIES],
      algorithms: ["random", "systematic", "coverage", "swarm"],
      fixtureSeeds: [1, 2, 3],
      searchSeeds: [1, 2, 3],
      budgets: [100, 500],
      difficulty: 2,
      storySeed: 1,
    };
  }
  if (name === "mature") {
    return {
      schemaVersion: SCHEMA_VERSION,
      families: ["deep-corridor", "rare-prefix", "combination-lock", "novelty-honeypot", "false-novelty", "delayed-consequence", "order-dependent", "compound-needle"],
      algorithms: ["random", "systematic", "coverage", "swarm"],
      fixtureSeeds: [101, 102, 103, 104, 105, 106],
      searchSeeds: [101, 102, 103, 104, 105],
      budgets: [1_000, 3_000, 10_000, 30_000, 100_000, 300_000, 1_000_000, 3_000_000, 10_000_000],
      difficulty: 3,
      storySeed: 1,
      cellOrder: "counterbalanced",
      scheduleSeed: 7001,
      fixturePartition: "validation",
      resources: { maxMemoryMb: 1_536, maxTimeMs: 1_800_000, progressIntervalTransitions: 10_000 },
    };
  }
  if (name === "marathon-20m" || name === "marathon-60m") {
    return {
      schemaVersion: SCHEMA_VERSION,
      families: ["deep-corridor", "rare-prefix", "combination-lock", "novelty-honeypot", "false-novelty", "delayed-consequence", "order-dependent", "compound-needle"],
      algorithms: ["random", "systematic", "coverage", "swarm", "inkcheck"],
      fixtureSeeds: [201, 202, 203],
      searchSeeds: [501, 502, 503],
      budgets: [name === "marathon-20m" ? 20 * 60 * 1_000 : 60 * 60 * 1_000],
      budgetMode: "wall-time",
      workBudgetCeiling: 100_000_000,
      difficulty: 10,
      storySeed: 1,
      cellOrder: "counterbalanced",
      scheduleSeed: 9001,
      fixturePartition: "evaluation",
      inkcheckOptions: { search: "portfolio", minRepro: false, maxDepth: 1_000, concurrency: 1 },
      resources: { maxMemoryMb: 4_096, progressIntervalTransitions: 10_000, progressIntervalMs: 1_000 },
    };
  }
  usage(`unknown preset ${name}`);
}

function validateResources(resources: ResourceLimits | undefined): void {
  if (resources === undefined) return;
  if (resources === null || typeof resources !== "object") usage("resources must be an object");
  for (const [name, item] of Object.entries(resources)) {
    if (!["maxMemoryMb", "maxTimeMs", "progressIntervalTransitions", "progressIntervalMs"].includes(name)) usage(`unknown resources field ${name}`);
    if (!Number.isSafeInteger(item) || (item as number) < 1) usage(`resources.${name} must be a positive integer`);
  }
}

function validateConfig(input: unknown): ExperimentConfig {
  if (input === null || typeof input !== "object") usage("experiment config must be an object");
  const record = input as Partial<ExperimentConfig>;
  if (record.schemaVersion !== SCHEMA_VERSION) usage(`config schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(record.families) || !record.families.every((family) => BUG_FAMILIES.includes(family))) usage("config contains an unknown family");
  if (!Array.isArray(record.algorithms) || !record.algorithms.every((algorithm) => ALGORITHMS.includes(algorithm))) usage("config contains an unknown algorithm");
  for (const [name, values] of [["fixtureSeeds", record.fixtureSeeds], ["searchSeeds", record.searchSeeds], ["budgets", record.budgets]] as const) {
    if (!Array.isArray(values) || values.length === 0 || !values.every((item) => Number.isSafeInteger(item) && item >= 1)) usage(`${name} must contain positive integers`);
  }
  if (!Number.isSafeInteger(record.difficulty) || (record.difficulty ?? 0) < 1 || (record.difficulty ?? 0) > 10) usage("difficulty must be 1..10");
  if (!Number.isSafeInteger(record.storySeed) || (record.storySeed ?? 0) < 1) usage("storySeed must be a positive integer");
  if (record.budgetMode !== undefined && record.budgetMode !== "work" && record.budgetMode !== "wall-time") usage("budgetMode must be work or wall-time");
  if (record.budgetMode === "wall-time" && (!Number.isSafeInteger(record.workBudgetCeiling) || (record.workBudgetCeiling ?? 0) < 1)) usage("wall-time configs require a positive workBudgetCeiling");
  if (record.budgetMode === "wall-time" && record.resources?.maxTimeMs !== undefined) usage("wall-time configs cannot also use resources.maxTimeMs");
  if (record.cellOrder !== undefined && record.cellOrder !== "configured" && record.cellOrder !== "counterbalanced") usage("cellOrder must be configured or counterbalanced");
  if (record.scheduleSeed !== undefined && !Number.isSafeInteger(record.scheduleSeed)) usage("scheduleSeed must be a safe integer");
  if (record.fixturePartition !== undefined && !["development", "validation", "evaluation"].includes(record.fixturePartition)) usage("fixturePartition must be development, validation, or evaluation");
  validateResources(record.resources);
  return record as ExperimentConfig;
}

function commandGenerate(args: string[]): void {
  const family = familyArg(args);
  const fixture = generateFixture(family, integer(args, "--fixture-seed", 1), integer(args, "--difficulty", 1));
  const out = value(args, "--out");
  if (!out) {
    process.stdout.write(fixture.source);
    return;
  }
  const directory = resolve(out);
  mkdirSync(directory, { recursive: true });
  const sourcePath = join(directory, `${fixture.manifest.fixtureId}.ink`);
  const manifestPath = join(directory, `${fixture.manifest.fixtureId}.manifest.json`);
  writeFileSync(sourcePath, fixture.source, "utf8");
  writeFileSync(manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`, "utf8");
  console.log(`generated ${sourcePath}`);
  console.log(`manifest  ${manifestPath}`);
}

async function executeRun(args: string[], request: Parameters<typeof runBenchmark>[0]) {
  const resources = resourcesFromArgs(args, request.resources);
  const onProgress = progressWriter(args);
  const timeBudgetMs = optionalInteger(args, "--time-budget-ms");
  const configured = {
    ...request,
    ...(timeBudgetMs === undefined ? {} : { timeBudgetMs }),
    ...(resources ? { resources } : {}),
    ...(onProgress ? { onProgress } : {}),
  };
  if (!args.includes("--isolated")) return runBenchmark(configured);
  const heapLimitMb = optionalInteger(args, "--worker-heap-mb");
  return runBenchmarkIsolated(configured, {
    ...(heapLimitMb === undefined ? {} : { heapLimitMb }),
    ...(onProgress ? { onProgress } : {}),
  });
}

function printBudget(report: Awaited<ReturnType<typeof executeRun>>): void {
  console.log(`budget: ${report.budget.limit} ${report.budget.unit}; work consumed: ${report.counts.transitions} ${report.workBudget?.unit ?? "native units"}; ${report.timing.wallMs.toFixed(1)} ms wall`);
}

async function commandRun(args: string[]): Promise<void> {
  const family = familyArg(args);
  const fixture = generateFixture(family, integer(args, "--fixture-seed", 1), integer(args, "--difficulty", 1));
  const inkcheckCommand = value(args, "--inkcheck-command");
  const report = await executeRun(args, {
    fixture,
    algorithm: algorithmArg(args),
    searchSeed: integer(args, "--search-seed", 1, 0),
    storySeed: integer(args, "--story-seed", 1),
    budget: integer(args, "--budget", 1_000),
    ...(inkcheckCommand ? { inkcheckCommand } : {}),
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const first = report.discoveredBugs[0];
    console.log(`${report.algorithm} on ${report.fixtureId}: ${report.status}`);
    printBudget(report);
    console.log(first ? `found ${first.bugId} at transition ${first.transition}; replay [${first.choicePath.join(", ")}]` : "planted bug not discovered within budget");
    if (report.coverage) console.log(`empirical coverage: ${report.coverage.locations} locations, ${report.coverage.edges} edges, ${report.coverage.semanticStates} semantic states`);
    if (report.error) console.error(report.error);
  }
  if (report.status !== "completed") process.exitCode = 1;
}

async function commandExperiment(args: string[]): Promise<void> {
  const configPath = value(args, "--config");
  const presetName = value(args, "--preset") ?? "quick";
  let config = configPath
    ? validateConfig(JSON.parse(readFileSync(resolve(configPath), "utf8")) as unknown)
    : preset(presetName);
  const inkcheckCommand = value(args, "--inkcheck-command");
  if (inkcheckCommand) config = { ...config, inkcheckCommand };
  const resources = resourcesFromArgs(args, config.resources);
  if (resources) config = { ...config, resources };
  const output = resolve(value(args, "--out") ?? "artifacts/experiment");
  const isolated = args.includes("--isolated") || (!configPath && (presetName === "mature" || presetName.startsWith("marathon-")));
  if (args.includes("--resume") && !isolated) usage("--resume requires --isolated or an isolated preset");
  const onRun = (report: Awaited<ReturnType<typeof executeRun>>, completed: number, total: number, resumed = false) => {
    const found = report.discoveredBugs.length > 0 ? "found" : "miss";
    console.error(`[${completed}/${total}] ${report.family} ${report.algorithm} budget=${report.budget.limit} ${report.status}/${found}${resumed ? " resumed" : ""}`);
  };
  const progress = progressWriter(args);
  const heapLimitMb = optionalInteger(args, "--worker-heap-mb");
  const result = isolated
    ? await runExperimentIsolated(config, {
      outputDirectory: output,
      resume: args.includes("--resume"),
      retainCoverageItems: false,
      ...(heapLimitMb === undefined ? {} : { heapLimitMb }),
      ...(progress ? { onProgress: progress } : {}),
      onRun,
    })
    : runExperiment(config, (report, completed, total) => onRun(report, completed, total));
  writeExperiment(output, result);
  console.log(`wrote ${result.runs.length} raw runs and summaries to ${output}`);
}

function storyArg(args: string[]): string {
  const story = value(args, "--story");
  if (!story) usage("--story is required");
  if (!listAuthoredStories().some((candidate) => candidate.id === story)) usage(`unknown authored story ${story}`);
  return story;
}

function authoredPreset(name: string): AuthoredExperimentConfig {
  const storyIds = listAuthoredStories().map((story) => story.id);
  if (name === "smoke") {
    return {
      schemaVersion: SCHEMA_VERSION,
      storyIds,
      algorithms: ["random", "systematic", "coverage", "swarm"],
      searchSeeds: [1],
      budgets: [100],
      storySeed: 1,
    };
  }
  if (name === "development") {
    return {
      schemaVersion: SCHEMA_VERSION,
      storyIds,
      algorithms: ["random", "systematic", "coverage", "swarm"],
      searchSeeds: [1, 2, 3],
      budgets: [500, 2_000],
      storySeed: 1,
    };
  }
  if (name === "mature") {
    return {
      schemaVersion: SCHEMA_VERSION,
      storyIds,
      algorithms: ["random", "systematic", "coverage", "swarm"],
      searchSeeds: Array.from({ length: 30 }, (_, index) => 101 + index),
      budgets: [1_000, 3_000, 10_000, 30_000, 100_000, 300_000, 1_000_000, 3_000_000, 10_000_000],
      storySeed: 1,
      cellOrder: "counterbalanced",
      scheduleSeed: 7101,
      fixturePartition: "validation",
      resources: { maxMemoryMb: 1_536, maxTimeMs: 1_800_000, progressIntervalTransitions: 10_000 },
    };
  }
  if (name === "marathon-20m" || name === "marathon-60m") {
    return {
      schemaVersion: SCHEMA_VERSION,
      storyIds: ["heresy2"],
      algorithms: ["random", "systematic", "coverage", "swarm", "inkcheck"],
      searchSeeds: [101, 102, 103, 104, 105],
      budgets: [name === "marathon-20m" ? 20 * 60 * 1_000 : 60 * 60 * 1_000],
      budgetMode: "wall-time",
      workBudgetCeiling: 100_000_000,
      storySeed: 1,
      cellOrder: "counterbalanced",
      scheduleSeed: 9101,
      fixturePartition: "evaluation",
      inkcheckOptions: { search: "portfolio", minRepro: false, maxDepth: 1_000, concurrency: 1 },
      resources: { maxMemoryMb: 4_096, progressIntervalTransitions: 10_000, progressIntervalMs: 1_000 },
    };
  }
  if (name === "marathon-20m-inkcheck-product" || name === "marathon-60m-inkcheck-product") {
    return {
      schemaVersion: SCHEMA_VERSION,
      storyIds: ["heresy2"],
      algorithms: ["inkcheck"],
      searchSeeds: [101, 102, 103, 104, 105],
      budgets: [name === "marathon-20m-inkcheck-product" ? 20 * 60 * 1_000 : 60 * 60 * 1_000],
      budgetMode: "wall-time",
      workBudgetCeiling: 100_000_000,
      storySeed: 1,
      inkcheckOptions: {},
      resources: { maxMemoryMb: 4_096, progressIntervalTransitions: 10_000, progressIntervalMs: 1_000 },
    };
  }
  usage(`unknown corpus preset ${name}`);
}

function validateAuthoredConfig(input: unknown): AuthoredExperimentConfig {
  if (input === null || typeof input !== "object") usage("corpus experiment config must be an object");
  const record = input as Partial<AuthoredExperimentConfig>;
  const knownStories = new Set(listAuthoredStories().map((story) => story.id));
  if (record.schemaVersion !== SCHEMA_VERSION) usage(`config schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(record.storyIds) || record.storyIds.length === 0 || !record.storyIds.every((story) => knownStories.has(story))) usage("config contains an unknown authored story");
  if (!Array.isArray(record.algorithms) || record.algorithms.length === 0 || !record.algorithms.every((algorithm) => ALGORITHMS.includes(algorithm))) usage("config contains an unknown algorithm");
  for (const [name, values] of [["searchSeeds", record.searchSeeds], ["budgets", record.budgets]] as const) {
    if (!Array.isArray(values) || values.length === 0 || !values.every((item) => Number.isSafeInteger(item) && item >= (name === "searchSeeds" ? 0 : 1))) usage(`${name} contains an invalid integer`);
  }
  if (!Number.isSafeInteger(record.storySeed) || (record.storySeed ?? 0) < 1) usage("storySeed must be a positive integer");
  if (record.budgetMode !== undefined && record.budgetMode !== "work" && record.budgetMode !== "wall-time") usage("budgetMode must be work or wall-time");
  if (record.budgetMode === "wall-time" && (!Number.isSafeInteger(record.workBudgetCeiling) || (record.workBudgetCeiling ?? 0) < 1)) usage("wall-time configs require a positive workBudgetCeiling");
  if (record.budgetMode === "wall-time" && record.resources?.maxTimeMs !== undefined) usage("wall-time configs cannot also use resources.maxTimeMs");
  if (record.cellOrder !== undefined && record.cellOrder !== "configured" && record.cellOrder !== "counterbalanced") usage("cellOrder must be configured or counterbalanced");
  if (record.scheduleSeed !== undefined && !Number.isSafeInteger(record.scheduleSeed)) usage("scheduleSeed must be a safe integer");
  if (record.fixturePartition !== undefined && !["development", "validation", "evaluation"].includes(record.fixturePartition)) usage("fixturePartition must be development, validation, or evaluation");
  validateResources(record.resources);
  return record as AuthoredExperimentConfig;
}

async function commandCorpus(args: string[]): Promise<void> {
  const [action, ...actionArgs] = args;
  if (action === "list") {
    for (const story of listAuthoredStories()) {
      console.log(`${story.id}\t${story.projectSize}\t${story.source.license}\t${story.source.name}`);
    }
    return;
  }
  if (action === "verify") {
    for (const story of listAuthoredStories()) {
      const fixture = loadAuthoredFixture(story.id);
      console.log(`verified ${story.id}: ${Object.keys(fixture.sourceBundle.files).length} source file(s), ${fixture.manifest.locations.length} instrumented locations`);
    }
    return;
  }
  if (action === "run") {
    const storyId = storyArg(actionArgs);
    const fixture = loadAuthoredFixture(storyId);
    const inkcheckCommand = value(actionArgs, "--inkcheck-command");
    const report = await executeRun(actionArgs, {
      fixture,
      algorithm: algorithmArg(actionArgs),
      searchSeed: integer(actionArgs, "--search-seed", 1, 0),
      storySeed: integer(actionArgs, "--story-seed", 1),
      budget: integer(actionArgs, "--budget", 1_000),
      ...(inkcheckCommand ? { inkcheckCommand } : {}),
    });
    if (actionArgs.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`${report.algorithm} on ${storyId}: ${report.status}`);
      printBudget(report);
      if (report.coverage) console.log(`empirical coverage: ${report.coverage.locations} locations, ${report.coverage.edges} edges, ${report.coverage.semanticStates} semantic states`);
      console.log(`runtime findings: ${report.runtimeFindings.length}; completed episodes: ${report.counts.episodesCompleted}`);
      console.log("authored-project tier: no planted-bug probability or survival claim");
      if (report.error) console.error(report.error);
    }
    if (report.status !== "completed") process.exitCode = 1;
    return;
  }
  if (action === "experiment") {
    const configPath = value(actionArgs, "--config");
    const presetName = value(actionArgs, "--preset") ?? "smoke";
    let config = configPath
      ? validateAuthoredConfig(JSON.parse(readFileSync(resolve(configPath), "utf8")) as unknown)
      : authoredPreset(presetName);
    const inkcheckCommand = value(actionArgs, "--inkcheck-command");
    if (inkcheckCommand) config = { ...config, inkcheckCommand };
    const resources = resourcesFromArgs(actionArgs, config.resources);
    if (resources) config = { ...config, resources };
    const output = resolve(value(actionArgs, "--out") ?? "artifacts/corpus");
    const isolated = actionArgs.includes("--isolated") || (!configPath && (presetName === "mature" || presetName.startsWith("marathon-")));
    if (actionArgs.includes("--resume") && !isolated) usage("--resume requires --isolated or an isolated preset");
    const onRun = (report: Awaited<ReturnType<typeof executeRun>>, completed: number, total: number, resumed = false) => {
      console.error(`[${completed}/${total}] ${report.fixtureId} ${report.algorithm} budget=${report.budget.limit} ${report.status}${resumed ? " resumed" : ""}`);
    };
    const progress = progressWriter(actionArgs);
    const heapLimitMb = optionalInteger(actionArgs, "--worker-heap-mb");
    const result = isolated
      ? await runAuthoredExperimentIsolated(config, {
        outputDirectory: output,
        resume: actionArgs.includes("--resume"),
        retainCoverageItems: false,
        ...(heapLimitMb === undefined ? {} : { heapLimitMb }),
        ...(progress ? { onProgress: progress } : {}),
        onRun,
      })
      : runAuthoredExperiment(config, (report, completed, total) => onRun(report, completed, total));
    writeAuthoredExperiment(output, result);
    console.log(`wrote ${result.runs.length} authored-project runs and separate summaries to ${output}`);
    return;
  }
  usage("corpus requires list, verify, run, or experiment");
}

function mutantStoryArg(args: string[]): string {
  const story = value(args, "--story");
  if (!story) usage("--story is required");
  if (!listAuthoredPlantedStories().some((candidate) => candidate.id === story)) usage(`unknown authored-planted story ${story}`);
  return story;
}

function mutantPreset(name: string): MutantExperimentConfig {
  const storyIds = listAuthoredPlantedStories().map((story) => story.id);
  if (name === "smoke") {
    return {
      schemaVersion: SCHEMA_VERSION,
      storyIds,
      algorithms: ["random", "systematic", "coverage", "swarm"],
      searchSeeds: [1],
      budgets: [100],
      storySeed: 1,
    };
  }
  if (name === "development") {
    return {
      schemaVersion: SCHEMA_VERSION,
      storyIds,
      algorithms: ["random", "systematic", "coverage", "swarm"],
      searchSeeds: [1, 2, 3, 4, 5],
      budgets: [100, 1_000, 10_000],
      storySeed: 1,
      resources: { maxMemoryMb: 1_536, maxTimeMs: 300_000, progressIntervalTransitions: 10_000 },
    };
  }
  if (name === "mature") {
    return {
      schemaVersion: SCHEMA_VERSION,
      storyIds,
      algorithms: ["random", "systematic", "coverage", "swarm", "inkcheck"],
      searchSeeds: Array.from({ length: 30 }, (_, index) => 101 + index),
      budgets: [1_000, 10_000, 100_000, 1_000_000, 10_000_000],
      storySeed: 1,
      cellOrder: "counterbalanced",
      scheduleSeed: 7201,
      fixturePartition: "validation",
      resources: { maxMemoryMb: 1_536, maxTimeMs: 1_800_000, progressIntervalTransitions: 10_000 },
    };
  }
  if (name === "marathon-20m" || name === "marathon-60m") {
    return {
      schemaVersion: SCHEMA_VERSION,
      storyIds,
      algorithms: ["random", "systematic", "coverage", "swarm", "inkcheck"],
      searchSeeds: [101, 102, 103, 104, 105],
      budgets: [name === "marathon-20m" ? 20 * 60 * 1_000 : 60 * 60 * 1_000],
      budgetMode: "wall-time",
      workBudgetCeiling: 100_000_000,
      storySeed: 1,
      cellOrder: "counterbalanced",
      scheduleSeed: 9201,
      fixturePartition: "evaluation",
      inkcheckOptions: { search: "portfolio", minRepro: false, maxDepth: 1_000, concurrency: 1 },
      resources: { maxMemoryMb: 4_096, progressIntervalTransitions: 10_000, progressIntervalMs: 1_000 },
    };
  }
  if (name === "marathon-20m-inkcheck-product" || name === "marathon-60m-inkcheck-product") {
    return {
      schemaVersion: SCHEMA_VERSION,
      storyIds,
      algorithms: ["inkcheck"],
      searchSeeds: [101, 102, 103, 104, 105],
      budgets: [name === "marathon-20m-inkcheck-product" ? 20 * 60 * 1_000 : 60 * 60 * 1_000],
      budgetMode: "wall-time",
      workBudgetCeiling: 100_000_000,
      storySeed: 1,
      inkcheckOptions: {},
      resources: { maxMemoryMb: 4_096, progressIntervalTransitions: 10_000, progressIntervalMs: 1_000 },
    };
  }
  usage(`unknown mutants preset ${name}`);
}

function validateMutantConfig(input: unknown): MutantExperimentConfig {
  if (input === null || typeof input !== "object") usage("mutants experiment config must be an object");
  const record = input as Partial<MutantExperimentConfig>;
  const knownStories = new Set(listAuthoredPlantedStories().map((story) => story.id));
  if (record.schemaVersion !== SCHEMA_VERSION) usage(`config schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(record.storyIds) || record.storyIds.length === 0 || !record.storyIds.every((story) => knownStories.has(story))) usage("config contains an unknown authored-planted story");
  if (!Array.isArray(record.algorithms) || record.algorithms.length === 0 || !record.algorithms.every((algorithm) => ALGORITHMS.includes(algorithm))) usage("config contains an unknown algorithm");
  for (const [name, values] of [["searchSeeds", record.searchSeeds], ["budgets", record.budgets]] as const) {
    if (!Array.isArray(values) || values.length === 0 || !values.every((item) => Number.isSafeInteger(item) && item >= (name === "searchSeeds" ? 0 : 1))) usage(`${name} contains an invalid integer`);
  }
  if (!Number.isSafeInteger(record.storySeed) || (record.storySeed ?? 0) < 1) usage("storySeed must be a positive integer");
  if (record.budgetMode !== undefined && record.budgetMode !== "work" && record.budgetMode !== "wall-time") usage("budgetMode must be work or wall-time");
  if (record.budgetMode === "wall-time" && (!Number.isSafeInteger(record.workBudgetCeiling) || (record.workBudgetCeiling ?? 0) < 1)) usage("wall-time configs require a positive workBudgetCeiling");
  if (record.budgetMode === "wall-time" && record.resources?.maxTimeMs !== undefined) usage("wall-time configs cannot also use resources.maxTimeMs");
  if (record.cellOrder !== undefined && record.cellOrder !== "configured" && record.cellOrder !== "counterbalanced") usage("cellOrder must be configured or counterbalanced");
  if (record.scheduleSeed !== undefined && !Number.isSafeInteger(record.scheduleSeed)) usage("scheduleSeed must be a safe integer");
  if (record.fixturePartition !== undefined && !["development", "validation", "evaluation"].includes(record.fixturePartition)) usage("fixturePartition must be development, validation, or evaluation");
  validateResources(record.resources);
  return record as MutantExperimentConfig;
}

async function commandMutants(args: string[]): Promise<void> {
  const [action, ...actionArgs] = args;
  if (action === "list") {
    for (const story of listAuthoredPlantedStories()) {
      const faultTypes = new Set(story.bugs.map((bug) => bug.faultType));
      console.log(`${story.id}\t${story.bugs.length} bugs\t${faultTypes.size} fault types\t${story.source.name}`);
    }
    return;
  }
  if (action === "verify") {
    for (const story of listAuthoredPlantedStories()) {
      const fixture = loadAuthoredPlantedFixture(story.id);
      const recorded = loadAuthoredPlantedWitnesses(story.id);
      let replayed = 0;
      for (const bug of fixture.manifest.bugs) {
        const witness = recorded.witnesses[bug.id];
        if (!witness) throw new Error(`${story.id}: missing witness for ${bug.id}`);
        const controller = new InstrumentedController(fixture, witness.choicePath.length + 1, 1);
        let observation = controller.launch();
        for (let index = 0; index < witness.choicePath.length; index += 1) {
          const choiceIndex = witness.choicePath[index]!;
          const expectedText = witness.choiceTextPath[index]!;
          const actualText = observation.choices[choiceIndex]?.text;
          if (actualText !== expectedText) {
            throw new Error(`${story.id}: witness for ${bug.id} diverged at choice ${index}; expected ${JSON.stringify(expectedText)}, got ${JSON.stringify(actualText)}`);
          }
          observation = controller.step(choiceIndex).after;
        }
        if (!controller.bugDiscoveries.some((discovery) => discovery.bugId === bug.id)) {
          throw new Error(`${story.id}: witness did not trigger ${bug.id}`);
        }
        replayed += 1;
      }
      console.log(`verified ${story.id}: ${fixture.manifest.bugs.length} bugs, ${new Set(fixture.manifest.bugs.map((bug) => bug.faultType)).size} fault types, ${Object.keys(fixture.sourceBundle.files).length} source files, ${fixture.manifest.locations.length} locations, ${replayed}/${fixture.manifest.bugs.length} witnesses replayed`);
    }
    return;
  }
  if (action === "run") {
    const storyId = mutantStoryArg(actionArgs);
    const fixture = loadAuthoredPlantedFixture(storyId);
    const inkcheckCommand = value(actionArgs, "--inkcheck-command");
    const report = await executeRun(actionArgs, {
      fixture,
      algorithm: algorithmArg(actionArgs),
      searchSeed: integer(actionArgs, "--search-seed", 1, 0),
      storySeed: integer(actionArgs, "--story-seed", 1),
      budget: integer(actionArgs, "--budget", 1_000),
      ...(inkcheckCommand ? { inkcheckCommand } : {}),
    });
    if (actionArgs.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`${report.algorithm} on ${storyId}: ${report.status}`);
      printBudget(report);
      console.log(`bugs: ${report.discoveredBugs.length}/${report.plantedBugIds.length} distinct planted defects discovered`);
      for (const discovery of report.discoveredBugs) console.log(`  ${discovery.bugId} at transition ${discovery.transition}; replay [${discovery.choicePath.join(", ")}]`);
      if (report.coverage) console.log(`empirical coverage: ${report.coverage.locations} locations, ${report.coverage.edges} edges, ${report.coverage.semanticStates} semantic states`);
      if (report.error) console.error(report.error);
    }
    if (report.status !== "completed") process.exitCode = 1;
    return;
  }
  if (action === "experiment") {
    const configPath = value(actionArgs, "--config");
    const presetName = value(actionArgs, "--preset") ?? "smoke";
    let config = configPath
      ? validateMutantConfig(JSON.parse(readFileSync(resolve(configPath), "utf8")) as unknown)
      : mutantPreset(presetName);
    const inkcheckCommand = value(actionArgs, "--inkcheck-command");
    if (inkcheckCommand) config = { ...config, inkcheckCommand };
    const resources = resourcesFromArgs(actionArgs, config.resources);
    if (resources) config = { ...config, resources };
    const output = resolve(value(actionArgs, "--out") ?? "artifacts/mutants");
    const isolated = actionArgs.includes("--isolated") || (!configPath && (presetName === "mature" || presetName.startsWith("marathon-")));
    if (actionArgs.includes("--resume") && !isolated) usage("--resume requires --isolated or an isolated preset");
    const onRun = (report: Awaited<ReturnType<typeof executeRun>>, completed: number, total: number, resumed = false) => {
      console.error(`[${completed}/${total}] ${report.fixtureId} ${report.algorithm} budget=${report.budget.limit} ${report.status} bugs=${report.discoveredBugs.length}/${report.plantedBugIds.length}${resumed ? " resumed" : ""}`);
    };
    const progress = progressWriter(actionArgs);
    const heapLimitMb = optionalInteger(actionArgs, "--worker-heap-mb");
    const result = isolated
      ? await runMutantExperimentIsolated(config, {
        outputDirectory: output,
        resume: actionArgs.includes("--resume"),
        retainCoverageItems: false,
        ...(heapLimitMb === undefined ? {} : { heapLimitMb }),
        ...(progress ? { onProgress: progress } : {}),
        onRun,
      })
      : runMutantExperiment(config, (report, completed, total) => onRun(report, completed, total));
    writeMutantExperiment(output, result);
    console.log(`wrote ${result.runs.length} authored-planted runs and multi-bug summaries to ${output}`);
    return;
  }
  usage("mutants requires list, verify, run, or experiment");
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === "help" || command === "--help" || command === "-h") usage();
if (command === "families") {
  console.log(BUG_FAMILIES.join("\n"));
} else if (command === "generate") {
  commandGenerate(args);
} else if (command === "run") {
  await commandRun(args);
} else if (command === "experiment") {
  await commandExperiment(args);
} else if (command === "corpus") {
  await commandCorpus(args);
} else if (command === "mutants") {
  await commandMutants(args);
} else {
  usage(`unknown command ${command}`);
}
