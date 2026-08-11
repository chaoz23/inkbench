#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { BUG_FAMILIES, SCHEMA_VERSION, type AlgorithmId, type BugFamily, type ExperimentConfig } from "./core/types.js";
import { generateFixture } from "./fixtures/generate.js";
import { runBenchmark } from "./core/run.js";
import { runExperiment, writeExperiment } from "./experiments/run.js";
import { listAuthoredStories, loadAuthoredFixture } from "./corpus/load.js";
import { runAuthoredExperiment, writeAuthoredExperiment, type AuthoredExperimentConfig } from "./corpus/experiment.js";

const ALGORITHMS: readonly AlgorithmId[] = ["random", "systematic", "coverage", "swarm", "inkcheck"];

function usage(message?: string): never {
  if (message) console.error(`error: ${message}\n`);
  console.error(`InkBench 0.1.0 — neutral planted-bug benchmarks for Ink search strategies

Usage:
  inkbench families
  inkbench generate --family <name> [--fixture-seed N] [--difficulty N] [--out DIR]
  inkbench run --family <name> --algorithm random|systematic|coverage|swarm|inkcheck
               [--fixture-seed N] [--search-seed N] [--story-seed N]
               [--difficulty N] [--budget N] [--inkcheck-command PATH] [--json]
  inkbench experiment [--preset quick|development] [--config FILE] [--out DIR]
                      [--inkcheck-command PATH]
  inkbench corpus list
  inkbench corpus verify
  inkbench corpus run --story <id> --algorithm random|systematic|coverage|swarm|inkcheck
                      [--search-seed N] [--story-seed N] [--budget N]
                      [--inkcheck-command PATH] [--json]
  inkbench corpus experiment [--preset smoke|development] [--config FILE]
                             [--out DIR] [--inkcheck-command PATH]

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
  usage(`unknown preset ${name}`);
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

function commandRun(args: string[]): void {
  const family = familyArg(args);
  const fixture = generateFixture(family, integer(args, "--fixture-seed", 1), integer(args, "--difficulty", 1));
  const inkcheckCommand = value(args, "--inkcheck-command");
  const report = runBenchmark({
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
    console.log(`budget: ${report.counts.transitions}/${report.budget.limit} ${report.budget.unit}; ${report.timing.wallMs.toFixed(1)} ms wall`);
    console.log(first ? `found ${first.bugId} at transition ${first.transition}; replay [${first.choicePath.join(", ")}]` : "planted bug not discovered within budget");
    if (report.coverage) console.log(`empirical coverage: ${report.coverage.locations} locations, ${report.coverage.edges} edges, ${report.coverage.semanticStates} semantic states`);
    if (report.error) console.error(report.error);
  }
  if (report.status !== "completed") process.exitCode = 1;
}

function commandExperiment(args: string[]): void {
  const configPath = value(args, "--config");
  let config = configPath
    ? validateConfig(JSON.parse(readFileSync(resolve(configPath), "utf8")) as unknown)
    : preset(value(args, "--preset") ?? "quick");
  const inkcheckCommand = value(args, "--inkcheck-command");
  if (inkcheckCommand) config = { ...config, inkcheckCommand };
  const output = resolve(value(args, "--out") ?? "artifacts/experiment");
  const result = runExperiment(config, (report, completed, total) => {
    const found = report.discoveredBugs.length > 0 ? "found" : "miss";
    console.error(`[${completed}/${total}] ${report.family} ${report.algorithm} budget=${report.budget.limit} ${report.status}/${found}`);
  });
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
  return record as AuthoredExperimentConfig;
}

function commandCorpus(args: string[]): void {
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
    const report = runBenchmark({
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
      console.log(`budget: ${report.counts.transitions}/${report.budget.limit} ${report.budget.unit}; ${report.timing.wallMs.toFixed(1)} ms wall`);
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
    let config = configPath
      ? validateAuthoredConfig(JSON.parse(readFileSync(resolve(configPath), "utf8")) as unknown)
      : authoredPreset(value(actionArgs, "--preset") ?? "smoke");
    const inkcheckCommand = value(actionArgs, "--inkcheck-command");
    if (inkcheckCommand) config = { ...config, inkcheckCommand };
    const output = resolve(value(actionArgs, "--out") ?? "artifacts/corpus");
    const result = runAuthoredExperiment(config, (report, completed, total) => {
      console.error(`[${completed}/${total}] ${report.fixtureId} ${report.algorithm} budget=${report.budget.limit} ${report.status}`);
    });
    writeAuthoredExperiment(output, result);
    console.log(`wrote ${result.runs.length} authored-project runs and separate summaries to ${output}`);
    return;
  }
  usage("corpus requires list, verify, run, or experiment");
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === "help" || command === "--help" || command === "-h") usage();
if (command === "families") {
  console.log(BUG_FAMILIES.join("\n"));
} else if (command === "generate") {
  commandGenerate(args);
} else if (command === "run") {
  commandRun(args);
} else if (command === "experiment") {
  commandExperiment(args);
} else if (command === "corpus") {
  commandCorpus(args);
} else {
  usage(`unknown command ${command}`);
}
