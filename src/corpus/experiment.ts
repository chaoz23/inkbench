import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic, writeNdjsonAtomicFromJsonFiles } from "../core/atomic.js";
import { runBenchmark } from "../core/run.js";
import { SCHEMA_VERSION, type AlgorithmId, type BudgetSpec, type CoverageCounts, type InkCheckOptions, type ResourceLimits, type RunReport, type RunRequest } from "../core/types.js";
import { getAuthoredCorpusManifest, listAuthoredStories, loadAuthoredFixture } from "./load.js";

export interface AuthoredExperimentConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  storyIds: string[];
  algorithms: AlgorithmId[];
  searchSeeds: number[];
  budgets: number[];
  budgetMode?: "work" | "wall-time";
  workBudgetCeiling?: number;
  storySeed: number;
  inkcheckCommand?: string;
  inkcheckOptions?: InkCheckOptions;
  resources?: ResourceLimits;
}

interface CoverageAggregate {
  locations: number;
  choiceConfigurations: number;
  choices: number;
  edges: number;
  semanticStates: number;
  rawStates: number;
  variableValues: number;
  variableTransitions: number;
}

export interface AuthoredCoverageCell {
  storyId: string;
  algorithm: AlgorithmId;
  budget: number;
  budgetUnit: BudgetSpec["unit"];
  runs: number;
  completed: number;
  resourceStopped: number;
  meanCoverage: CoverageAggregate | null;
  maxCoverage: CoverageCounts | null;
  meanTransitions: number;
  meanEpisodesCompleted: number;
  runtimeFindingRuns: number;
  distinctRuntimeFindings: number;
  meanWallMs: number;
  meanCpuMs: number | null;
  meanPeakHeapBytes: number | null;
  meanPeakCheckpointBytes: number | null;
}

export interface AuthoredComplementarityCell {
  storyId: string;
  budget: number;
  algorithms: AlgorithmId[];
  pairedRuns: number;
  meanUnionLocations: number;
  meanUnionEdges: number;
  meanExclusiveLocations: Record<string, number>;
  meanExclusiveEdges: Record<string, number>;
}

export interface AuthoredExperimentSummary {
  schemaVersion: typeof SCHEMA_VERSION;
  benchmarkTier: "authored-project";
  generatedAt: string;
  config: AuthoredExperimentConfig;
  totalRuns: number;
  successfulRuns: number;
  coverage: AuthoredCoverageCell[];
  complementarity: AuthoredComplementarityCell[];
  interpretation: string;
}

export interface AuthoredExperimentResult {
  runs: RunReport[];
  summary: AuthoredExperimentSummary;
  /** Full authoritative reports persisted by isolated matrix execution. */
  cellFiles?: string[];
}

const COVERAGE_KEYS = [
  "locations",
  "choiceConfigurations",
  "choices",
  "edges",
  "semanticStates",
  "rawStates",
  "variableValues",
  "variableTransitions",
] as const;

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregateCoverage(values: CoverageCounts[], mode: "mean" | "max"): CoverageAggregate {
  return Object.fromEntries(COVERAGE_KEYS.map((key) => [key, mode === "mean" ? mean(values.map((value) => value[key])) : Math.max(...values.map((value) => value[key]))])) as unknown as CoverageAggregate;
}

function coverageCells(runs: RunReport[], config: AuthoredExperimentConfig): AuthoredCoverageCell[] {
  const cells: AuthoredCoverageCell[] = [];
  for (const storyId of config.storyIds) for (const budget of config.budgets) for (const algorithm of config.algorithms) {
    const matching = runs.filter((run) => run.fixtureId === `authored-${storyId}` && run.budget.limit === budget && run.algorithm === algorithm);
    const completed = matching.filter((run) => run.status === "completed");
    const coverage = completed.flatMap((run) => run.coverage ? [run.coverage] : []);
    const cpu = completed.flatMap((run) => run.timing.cpuMs === null ? [] : [run.timing.cpuMs]);
    const measured = matching.filter((run) => run.resources !== null);
    const findingKeys = new Set(completed.flatMap((run) => run.runtimeFindings.map((finding) => `${finding.kind}\u0000${finding.value}`)));
    cells.push({
      storyId,
      algorithm,
      budget,
      budgetUnit: matching[0]?.budget.unit ?? (algorithm === "inkcheck" ? "inkcheck-states" : "choice-transitions"),
      runs: matching.length,
      completed: completed.length,
      resourceStopped: matching.filter((run) => run.status === "resource-stopped").length,
      meanCoverage: coverage.length > 0 ? aggregateCoverage(coverage, "mean") : null,
      maxCoverage: coverage.length > 0 ? aggregateCoverage(coverage, "max") : null,
      meanTransitions: mean(completed.map((run) => run.counts.transitions)),
      meanEpisodesCompleted: mean(completed.map((run) => run.counts.episodesCompleted)),
      runtimeFindingRuns: completed.filter((run) => run.runtimeFindings.length > 0).length,
      distinctRuntimeFindings: findingKeys.size,
      meanWallMs: mean(completed.map((run) => run.timing.wallMs)),
      meanCpuMs: cpu.length > 0 ? mean(cpu) : null,
      meanPeakHeapBytes: measured.length > 0 ? mean(measured.map((run) => run.resources!.process.peak.heapUsedBytes)) : null,
      meanPeakCheckpointBytes: measured.length > 0 ? mean(measured.map((run) => run.resources!.snapshots.peakCheckpointBytes)) : null,
    });
  }
  return cells;
}

function exclusiveCount(own: Set<string>, others: Set<string>[]): number {
  let count = 0;
  for (const item of own) if (!others.some((set) => set.has(item))) count += 1;
  return count;
}

function complementarityCells(runs: RunReport[], config: AuthoredExperimentConfig): AuthoredComplementarityCell[] {
  const cells: AuthoredComplementarityCell[] = [];
  for (const storyId of config.storyIds) for (const budget of config.budgets) {
    const matching = runs.filter((run) => run.fixtureId === `authored-${storyId}` && run.budget.limit === budget);
    const comparable = config.algorithms.filter((algorithm) => matching.some((run) => run.algorithm === algorithm && run.coverageItems !== null));
    const paired = new Map<string, Map<AlgorithmId, RunReport>>();
    for (const run of matching) {
      const key = `${run.searchSeed}\u0000${run.storySeed}`;
      const group = paired.get(key) ?? new Map<AlgorithmId, RunReport>();
      group.set(run.algorithm, run);
      paired.set(key, group);
    }
    let compared = 0;
    let unionLocations = 0;
    let unionEdges = 0;
    const exclusiveLocations = Object.fromEntries(comparable.map((algorithm) => [algorithm, 0]));
    const exclusiveEdges = Object.fromEntries(comparable.map((algorithm) => [algorithm, 0]));
    if (comparable.length >= 2) for (const group of paired.values()) {
      const selected = comparable.map((algorithm) => group.get(algorithm));
      if (selected.some((run) => run?.status !== "completed" || run.coverageItems === null)) continue;
      const locationSets = selected.map((run) => new Set(run!.coverageItems!.locations));
      const edgeSets = selected.map((run) => new Set(run!.coverageItems!.edges));
      unionLocations += new Set(locationSets.flatMap((set) => [...set])).size;
      unionEdges += new Set(edgeSets.flatMap((set) => [...set])).size;
      for (let index = 0; index < comparable.length; index += 1) {
        const algorithm = comparable[index]!;
        exclusiveLocations[algorithm] = (exclusiveLocations[algorithm] ?? 0) + exclusiveCount(locationSets[index]!, locationSets.filter((_, other) => other !== index));
        exclusiveEdges[algorithm] = (exclusiveEdges[algorithm] ?? 0) + exclusiveCount(edgeSets[index]!, edgeSets.filter((_, other) => other !== index));
      }
      compared += 1;
    }
    cells.push({
      storyId,
      budget,
      algorithms: comparable,
      pairedRuns: compared,
      meanUnionLocations: compared > 0 ? unionLocations / compared : 0,
      meanUnionEdges: compared > 0 ? unionEdges / compared : 0,
      meanExclusiveLocations: Object.fromEntries(Object.entries(exclusiveLocations).map(([algorithm, count]) => [algorithm, compared > 0 ? count / compared : 0])),
      meanExclusiveEdges: Object.fromEntries(Object.entries(exclusiveEdges).map(([algorithm, count]) => [algorithm, compared > 0 ? count / compared : 0])),
    });
  }
  return cells;
}

export function runAuthoredExperiment(config: AuthoredExperimentConfig, onRun?: (report: RunReport, completed: number, total: number) => void): AuthoredExperimentResult {
  if (config.schemaVersion !== SCHEMA_VERSION) throw new RangeError(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (config.storyIds.length === 0 || new Set(config.storyIds).size !== config.storyIds.length) throw new RangeError("storyIds must be non-empty and unique");
  if (config.algorithms.length === 0 || new Set(config.algorithms).size !== config.algorithms.length) throw new RangeError("algorithms must be non-empty and unique");
  if (config.searchSeeds.length === 0 || config.searchSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)) throw new RangeError("searchSeeds must contain non-negative safe integers");
  if (config.budgets.length === 0 || config.budgets.some((budget) => !Number.isSafeInteger(budget) || budget < 1)) throw new RangeError("budgets must contain positive safe integers");
  if (config.budgetMode !== undefined && config.budgetMode !== "work" && config.budgetMode !== "wall-time") throw new RangeError("budgetMode must be work or wall-time");
  if (config.budgetMode === "wall-time" && (!Number.isSafeInteger(config.workBudgetCeiling) || (config.workBudgetCeiling ?? 0) < 1)) throw new RangeError("wall-time mode requires a positive workBudgetCeiling");
  if (config.budgetMode === "wall-time" && config.resources?.maxTimeMs !== undefined) throw new RangeError("wall-time mode cannot also set resources.maxTimeMs");
  if (!Number.isSafeInteger(config.storySeed) || config.storySeed < 1) throw new RangeError("storySeed must be a positive safe integer");
  const available = new Set(listAuthoredStories().map((story) => story.id));
  for (const storyId of config.storyIds) if (!available.has(storyId)) throw new RangeError(`unknown authored story: ${storyId}`);
  const runs: RunReport[] = [];
  const total = config.storyIds.length * config.budgets.length * config.searchSeeds.length * config.algorithms.length;
  for (const storyId of config.storyIds) {
    const fixture = loadAuthoredFixture(storyId);
    for (const budget of config.budgets) for (const searchSeed of config.searchSeeds) for (const algorithm of config.algorithms) {
      const report = runBenchmark(authoredRunRequest(config, fixture, algorithm, searchSeed, budget));
      runs.push(report);
      onRun?.(report, runs.length, total);
    }
  }
  return { runs, summary: summarizeAuthoredRuns(runs, config) };
}

export function authoredRunRequest(
  config: AuthoredExperimentConfig,
  fixture: RunRequest["fixture"],
  algorithm: AlgorithmId,
  searchSeed: number,
  budget: number,
): RunRequest {
  if (config.budgetMode === "wall-time" && (!Number.isSafeInteger(config.workBudgetCeiling) || config.workBudgetCeiling! < 1)) throw new RangeError("wall-time mode requires a positive workBudgetCeiling");
  if (config.budgetMode === "wall-time" && config.resources?.maxTimeMs !== undefined) throw new RangeError("wall-time mode cannot also set resources.maxTimeMs");
  return {
    fixture,
    algorithm,
    searchSeed,
    storySeed: config.storySeed,
    budget: config.budgetMode === "wall-time" ? config.workBudgetCeiling! : budget,
    ...(config.budgetMode === "wall-time" ? { timeBudgetMs: budget } : {}),
    ...(config.inkcheckCommand ? { inkcheckCommand: config.inkcheckCommand } : {}),
    ...(config.inkcheckOptions ? { inkcheckOptions: config.inkcheckOptions } : {}),
    ...(config.resources ? { resources: config.resources } : {}),
  };
}

export function summarizeAuthoredRuns(runs: RunReport[], config: AuthoredExperimentConfig): AuthoredExperimentSummary {
  return {
      schemaVersion: SCHEMA_VERSION,
      benchmarkTier: "authored-project",
      generatedAt: new Date().toISOString(),
      config,
      totalRuns: runs.length,
      successfulRuns: runs.filter((run) => run.status === "completed").length,
      coverage: coverageCells(runs, config),
      complementarity: complementarityCells(runs, config),
      interpretation: `Authored stories provide ecological-validity coverage and runtime-finding evidence. They have no planted oracle and are excluded from planted-bug probability and survival curves.${config.budgetMode === "wall-time" ? " Planned wall-time expiry is completed evidence; memory stops and prematurely reached work ceilings are incomplete." : ""}`,
  };
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function record(record: Record<string, number>): string {
  return Object.entries(record).map(([key, value]) => `${key}: ${format(value)}`).join(", ") || "none";
}

export function renderAuthoredMarkdown(summary: AuthoredExperimentSummary): string {
  const sources = listAuthoredStories();
  const lines = [
    "# InkBench authored-project summary",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    `Runs: ${summary.successfulRuns}/${summary.totalRuns} completed.`,
    "",
    "> These stories have no planted-bug oracle. The counts below measure empirically observed runtime behavior; they are not proof-relative coverage percentages and must not be pooled with planted-bug yield or survival curves.",
    "",
    "## Coverage competence map",
    "",
    "| Story | Algorithm | Budget | Unit | Completed | Resource-stopped | Mean locations | Mean edges | Mean semantic states | Runtime-finding runs | Mean wall ms | Peak heap MiB | Peak checkpoints MiB |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const cell of summary.coverage) {
    lines.push(`| ${cell.storyId} | ${cell.algorithm} | ${cell.budget} | ${cell.budgetUnit} | ${cell.completed}/${cell.runs} | ${cell.resourceStopped} | ${cell.meanCoverage ? format(cell.meanCoverage.locations) : "n/a"} | ${cell.meanCoverage ? format(cell.meanCoverage.edges) : "n/a"} | ${cell.meanCoverage ? format(cell.meanCoverage.semanticStates) : "n/a"} | ${cell.runtimeFindingRuns} | ${format(cell.meanWallMs)} | ${cell.meanPeakHeapBytes === null ? "n/a" : format(cell.meanPeakHeapBytes / 2 ** 20)} | ${cell.meanPeakCheckpointBytes === null ? "n/a" : format(cell.meanPeakCheckpointBytes / 2 ** 20)} |`);
  }
  lines.push(
    "",
    "## Paired complementarity",
    "",
    "Exclusive counts are mean empirical items found by only one comparable in-process strategy within the same story/search seed/budget cell. External adapters without item-level evidence are excluded.",
    "",
    "| Story | Budget | Paired runs | Mean union locations | Mean union edges | Exclusive locations | Exclusive edges |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- |",
  );
  for (const cell of summary.complementarity) {
    lines.push(`| ${cell.storyId} | ${cell.budget} | ${cell.pairedRuns} | ${format(cell.meanUnionLocations)} | ${format(cell.meanUnionEdges)} | ${record(cell.meanExclusiveLocations)} | ${record(cell.meanExclusiveEdges)} |`);
  }
  lines.push("", "## Sources", "");
  for (const storyId of summary.config.storyIds) {
    const story = sources.find((candidate) => candidate.id === storyId)!;
    lines.push(`- **${story.source.name}**, ${story.source.author}; ${story.source.license}; upstream commit \`${story.source.commit}\`; ${story.source.repository}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function csv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function writeAuthoredExperiment(outputDirectory: string, result: AuthoredExperimentResult): void {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileAtomic(join(outputDirectory, "config.json"), `${JSON.stringify(result.summary.config, null, 2)}\n`);
  writeFileAtomic(join(outputDirectory, "corpus-manifest.json"), `${JSON.stringify(getAuthoredCorpusManifest(), null, 2)}\n`);
  if (result.cellFiles) writeNdjsonAtomicFromJsonFiles(join(outputDirectory, "runs.ndjson"), result.cellFiles);
  else writeFileAtomic(join(outputDirectory, "runs.ndjson"), `${result.runs.map((run) => JSON.stringify(run)).join("\n")}\n`);
  const headers = ["runId", "storyId", "algorithm", "searchSeed", "storySeed", "primaryBudgetUnit", "primaryBudget", "workBudgetUnit", "workBudgetLimit", "requestedParallelism", "effectiveParallelism", "parallelismMode", "status", "stopReason", "transitions", "episodesCompleted", "runtimeFindings", "wallMs", "cpuMs", "peakHeapBytes", "peakRssBytes", "peakSnapshotBytes", "peakCheckpointBytes", "locations", "choices", "edges", "semanticStates", "rawStates"];
  const rows = result.runs.map((run) => [
    run.runId, run.fixtureId.replace(/^authored-/, ""), run.algorithm, run.searchSeed, run.storySeed, run.budget.unit, run.budget.limit, run.workBudget?.unit ?? "", run.workBudget?.limit ?? "",
    run.parallelism.requested ?? "", run.parallelism.effective ?? "", run.parallelism.mode, run.status, run.stopReason, run.counts.transitions, run.counts.episodesCompleted, run.runtimeFindings.length, run.timing.wallMs, run.timing.cpuMs ?? "",
    run.resources?.process.peak.heapUsedBytes ?? "", run.resources?.process.peak.rssBytes ?? "", run.resources?.snapshots.peakBytes ?? "", run.resources?.snapshots.peakCheckpointBytes ?? "",
    run.coverage?.locations ?? "", run.coverage?.choices ?? "", run.coverage?.edges ?? "", run.coverage?.semanticStates ?? "", run.coverage?.rawStates ?? "",
  ]);
  writeFileAtomic(join(outputDirectory, "runs.csv"), `${[headers, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`);
  writeFileAtomic(join(outputDirectory, "summary.json"), `${JSON.stringify(result.summary, null, 2)}\n`);
  writeFileAtomic(join(outputDirectory, "summary.md"), renderAuthoredMarkdown(result.summary));
}
