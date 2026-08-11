import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic, writeNdjsonAtomicFromJsonFiles } from "../core/atomic.js";
import { runBenchmark } from "../core/run.js";
import { SCHEMA_VERSION, type AlgorithmId, type AuthoredFaultType, type BugFamily, type InkCheckOptions, type ResourceLimits, type RunReport, type RunRequest } from "../core/types.js";
import { getAuthoredPlantedCorpusManifest, listAuthoredPlantedStories, loadAuthoredPlantedFixture } from "./load.js";

export interface MutantExperimentConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  storyIds: string[];
  algorithms: AlgorithmId[];
  searchSeeds: number[];
  /** Budgets are native work units by default or planned milliseconds in wall-time mode. */
  budgets: number[];
  budgetMode?: "work" | "wall-time";
  /** Required in wall-time mode and intentionally set high enough not to bind. */
  workBudgetCeiling?: number;
  storySeed: number;
  inkcheckCommand?: string;
  inkcheckOptions?: InkCheckOptions;
  resources?: ResourceLimits;
}

export interface BugYieldCell {
  storyId: string;
  algorithm: AlgorithmId;
  budget: number;
  runs: number;
  completed: number;
  plantedBugs: number;
  meanBugsDiscovered: number;
  medianBugsDiscovered: number | null;
  maxBugsDiscovered: number;
  meanBugFraction: number;
  probabilityAny: number;
  probabilityAll: number;
  medianTransitionsToFirst: number | null;
  meanWallMs: number;
}

export interface PerBugCell {
  storyId: string;
  bugId: string;
  family: BugFamily;
  faultType: AuthoredFaultType;
  algorithm: AlgorithmId;
  budget: number;
  runs: number;
  discoveries: number;
  probability: number;
  medianTransitionsToDiscovery: number | null;
}

export interface MutantComplementarityCell {
  storyId: string;
  budget: number;
  algorithms: AlgorithmId[];
  pairedRuns: number;
  bugOpportunities: number;
  unionDiscoveries: number;
  exclusiveDiscoveries: Record<string, number>;
  discoveryPatternCounts: Record<string, number>;
}

export interface MutantResourceCell {
  storyId: string;
  algorithm: AlgorithmId;
  budget: number;
  runs: number;
  completed: number;
  resourceStopped: number;
  meanTransitions: number;
  meanPeakHeapBytes: number | null;
  meanAdapterPeakTrackedHeapBytes: number | null;
  meanPeakCheckpointBytes: number | null;
}

export interface MutantExperimentSummary {
  schemaVersion: typeof SCHEMA_VERSION;
  benchmarkTier: "authored-planted";
  generatedAt: string;
  config: MutantExperimentConfig;
  totalRuns: number;
  successfulRuns: number;
  bugYield: BugYieldCell[];
  perBug: PerBugCell[];
  complementarity: MutantComplementarityCell[];
  resources: MutantResourceCell[];
  interpretation: string;
}

export interface MutantExperimentResult {
  runs: RunReport[];
  summary: MutantExperimentSummary;
  cellFiles?: string[];
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function fixtureId(storyId: string): string {
  return `authored-planted-${storyId}`;
}

function bugYieldCells(runs: RunReport[], config: MutantExperimentConfig): BugYieldCell[] {
  const cells: BugYieldCell[] = [];
  for (const storyId of config.storyIds) for (const budget of config.budgets) for (const algorithm of config.algorithms) {
    const matching = runs.filter((run) => run.fixtureId === fixtureId(storyId) && run.budget.limit === budget && run.algorithm === algorithm);
    const completed = matching.filter((run) => run.status === "completed");
    const plantedBugs = matching[0]?.plantedBugIds.length ?? loadAuthoredPlantedFixture(storyId).manifest.bugs.length;
    const counts = completed.map((run) => run.discoveredBugs.length);
    const firstTimes = completed.flatMap((run) => run.discoveryTimingBasis === "global-work" && run.discoveredBugs[0] ? [run.discoveredBugs[0].transition] : []);
    cells.push({
      storyId,
      algorithm,
      budget,
      runs: matching.length,
      completed: completed.length,
      plantedBugs,
      meanBugsDiscovered: mean(counts),
      medianBugsDiscovered: median(counts),
      maxBugsDiscovered: counts.length === 0 ? 0 : Math.max(...counts),
      meanBugFraction: plantedBugs === 0 ? 0 : mean(counts) / plantedBugs,
      probabilityAny: completed.length === 0 ? 0 : completed.filter((run) => run.discoveredBugs.length > 0).length / completed.length,
      probabilityAll: completed.length === 0 ? 0 : completed.filter((run) => run.discoveredBugs.length === plantedBugs).length / completed.length,
      medianTransitionsToFirst: median(firstTimes),
      meanWallMs: mean(completed.map((run) => run.timing.wallMs)),
    });
  }
  return cells;
}

function perBugCells(runs: RunReport[], config: MutantExperimentConfig): PerBugCell[] {
  const cells: PerBugCell[] = [];
  for (const storyId of config.storyIds) {
    const bugs = loadAuthoredPlantedFixture(storyId).manifest.bugs;
    for (const budget of config.budgets) for (const algorithm of config.algorithms) {
      const completed = runs.filter((run) => run.fixtureId === fixtureId(storyId) && run.budget.limit === budget && run.algorithm === algorithm && run.status === "completed");
      for (const bug of bugs) {
        const discoveries = completed.flatMap((run) => {
          if (run.discoveryTimingBasis !== "global-work") return [];
          const found = run.discoveredBugs.find((candidate) => candidate.bugId === bug.id);
          return found ? [found.transition] : [];
        });
        cells.push({
          storyId,
          bugId: bug.id,
          family: bug.family,
          faultType: bug.faultType,
          algorithm,
          budget,
          runs: completed.length,
          discoveries: discoveries.length,
          probability: completed.length === 0 ? 0 : discoveries.length / completed.length,
          medianTransitionsToDiscovery: median(discoveries),
        });
      }
    }
  }
  return cells;
}

function complementarityCells(runs: RunReport[], config: MutantExperimentConfig): MutantComplementarityCell[] {
  const cells: MutantComplementarityCell[] = [];
  for (const storyId of config.storyIds) for (const budget of config.budgets) {
    const bugs = loadAuthoredPlantedFixture(storyId).manifest.bugs;
    const matching = runs.filter((run) => run.fixtureId === fixtureId(storyId) && run.budget.limit === budget);
    const paired = new Map<string, Map<AlgorithmId, RunReport>>();
    for (const run of matching) {
      const key = `${run.searchSeed}\u0000${run.storySeed}`;
      const group = paired.get(key) ?? new Map<AlgorithmId, RunReport>();
      group.set(run.algorithm, run);
      paired.set(key, group);
    }
    const exclusive = Object.fromEntries(config.algorithms.map((algorithm) => [algorithm, 0]));
    const patterns: Record<string, number> = {};
    let pairedRuns = 0;
    let unionDiscoveries = 0;
    for (const group of paired.values()) {
      if (!config.algorithms.every((algorithm) => group.get(algorithm)?.status === "completed")) continue;
      pairedRuns += 1;
      for (const bug of bugs) {
        const finders = config.algorithms.filter((algorithm) => group.get(algorithm)!.discoveredBugs.some((discovery) => discovery.bugId === bug.id));
        const pattern = finders.length === 0 ? "none" : finders.join("+");
        patterns[pattern] = (patterns[pattern] ?? 0) + 1;
        if (finders.length > 0) unionDiscoveries += 1;
        if (finders.length === 1) exclusive[finders[0]!] = (exclusive[finders[0]!] ?? 0) + 1;
      }
    }
    cells.push({
      storyId,
      budget,
      algorithms: [...config.algorithms],
      pairedRuns,
      bugOpportunities: pairedRuns * bugs.length,
      unionDiscoveries,
      exclusiveDiscoveries: exclusive,
      discoveryPatternCounts: patterns,
    });
  }
  return cells;
}

function resourceCells(runs: RunReport[], config: MutantExperimentConfig): MutantResourceCell[] {
  const cells: MutantResourceCell[] = [];
  for (const storyId of config.storyIds) for (const budget of config.budgets) for (const algorithm of config.algorithms) {
    const matching = runs.filter((run) => run.fixtureId === fixtureId(storyId) && run.budget.limit === budget && run.algorithm === algorithm);
    const measured = matching.filter((run) => run.resources !== null);
    const adapterMeasured = matching.filter((run) => run.adapterResources != null);
    cells.push({
      storyId,
      algorithm,
      budget,
      runs: matching.length,
      completed: matching.filter((run) => run.status === "completed").length,
      resourceStopped: matching.filter((run) => run.status === "resource-stopped").length,
      meanTransitions: mean(matching.map((run) => run.counts.transitions)),
      meanPeakHeapBytes: measured.length === 0 ? null : mean(measured.map((run) => run.resources!.process.peak.heapUsedBytes)),
      meanAdapterPeakTrackedHeapBytes: adapterMeasured.length === 0 ? null : mean(adapterMeasured.map((run) => run.adapterResources!.peakTrackedHeapBytes)),
      meanPeakCheckpointBytes: measured.length === 0 ? null : mean(measured.map((run) => run.resources!.snapshots.peakCheckpointBytes)),
    });
  }
  return cells;
}

function validateConfig(config: MutantExperimentConfig): void {
  if (config.schemaVersion !== SCHEMA_VERSION) throw new RangeError(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (config.storyIds.length === 0 || new Set(config.storyIds).size !== config.storyIds.length) throw new RangeError("storyIds must be non-empty and unique");
  if (config.algorithms.length === 0 || new Set(config.algorithms).size !== config.algorithms.length) throw new RangeError("algorithms must be non-empty and unique");
  const algorithms = new Set<AlgorithmId>(["random", "systematic", "coverage", "swarm-novelty", "swarm-colony", "swarm", "inkcheck"]);
  for (const algorithm of config.algorithms) if (!algorithms.has(algorithm)) throw new RangeError(`unknown algorithm: ${algorithm}`);
  if (config.searchSeeds.length === 0 || config.searchSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)) throw new RangeError("searchSeeds must contain non-negative safe integers");
  if (config.budgets.length === 0 || config.budgets.some((budget) => !Number.isSafeInteger(budget) || budget < 1)) throw new RangeError("budgets must contain positive safe integers");
  if (config.budgetMode !== undefined && config.budgetMode !== "work" && config.budgetMode !== "wall-time") throw new RangeError("budgetMode must be work or wall-time");
  if (config.budgetMode === "wall-time" && (!Number.isSafeInteger(config.workBudgetCeiling) || (config.workBudgetCeiling ?? 0) < 1)) {
    throw new RangeError("wall-time mode requires a positive workBudgetCeiling");
  }
  if (config.budgetMode === "wall-time" && config.resources?.maxTimeMs !== undefined) {
    throw new RangeError("wall-time mode cannot also set resources.maxTimeMs");
  }
  if (!Number.isSafeInteger(config.storySeed) || config.storySeed < 1) throw new RangeError("storySeed must be a positive safe integer");
  const available = new Set(listAuthoredPlantedStories().map((story) => story.id));
  for (const storyId of config.storyIds) if (!available.has(storyId)) throw new RangeError(`unknown authored-planted story: ${storyId}`);
}

export function mutantRunRequest(
  config: MutantExperimentConfig,
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

export function runMutantExperiment(config: MutantExperimentConfig, onRun?: (report: RunReport, completed: number, total: number) => void): MutantExperimentResult {
  validateConfig(config);
  const runs: RunReport[] = [];
  const total = config.storyIds.length * config.budgets.length * config.searchSeeds.length * config.algorithms.length;
  for (const storyId of config.storyIds) {
    const fixture = loadAuthoredPlantedFixture(storyId);
    for (const budget of config.budgets) for (const searchSeed of config.searchSeeds) for (const algorithm of config.algorithms) {
      const report = runBenchmark(mutantRunRequest(config, fixture, algorithm, searchSeed, budget));
      runs.push(report);
      onRun?.(report, runs.length, total);
    }
  }
  return { runs, summary: summarizeMutantRuns(runs, config) };
}

export function summarizeMutantRuns(runs: RunReport[], config: MutantExperimentConfig, generatedAt = new Date().toISOString()): MutantExperimentSummary {
  validateConfig(config);
  return {
    schemaVersion: SCHEMA_VERSION,
    benchmarkTier: "authored-planted",
    generatedAt,
    config,
    totalRuns: runs.length,
    successfulRuns: runs.filter((run) => run.status === "completed").length,
    bugYield: bugYieldCells(runs, config),
    perBug: perBugCells(runs, config),
    complementarity: complementarityCells(runs, config),
    resources: resourceCells(runs, config),
    interpretation: config.budgetMode === "wall-time"
      ? "Each bug is a disclosed mutation of a pinned authored story. Planned wall-time expiry is a completed cell; memory stops and prematurely reached work ceilings remain incomplete and visible in raw data and the resource table."
      : "Each bug is a disclosed mutation of a pinned authored story. Fixed-work yield excludes incomplete cells; resource-stopped runs remain in raw data and the resource table.",
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function renderMutantMarkdown(summary: MutantExperimentSummary): string {
  const lines = [
    "# InkBench authored-planted summary",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    `Runs: ${summary.successfulRuns}/${summary.totalRuns} completed. Fixed-budget estimates exclude incomplete cells; resource outcomes remain visible below.`,
    "",
    "> This tier measures disclosed defects in deterministic derivatives of pinned authored stories. A run receives credit per distinct oracle, not merely for finding any defect.",
    "",
    "## Bug yield",
    "",
    "| Story | Algorithm | Budget | Completed | Mean bugs | Median bugs | Max bugs | Mean fraction | P(any) | P(all) | Median first discovery |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const cell of summary.bugYield) {
    lines.push(`| ${cell.storyId} | ${cell.algorithm} | ${cell.budget} | ${cell.completed}/${cell.runs} | ${format(cell.meanBugsDiscovered)} | ${cell.medianBugsDiscovered ?? "n/a"} | ${cell.maxBugsDiscovered} | ${percent(cell.meanBugFraction)} | ${percent(cell.probabilityAny)} | ${percent(cell.probabilityAll)} | ${cell.medianTransitionsToFirst ?? "n/a"} |`);
  }
  lines.push("", "## Per-bug competence map", "");
  for (const storyId of summary.config.storyIds) {
    for (const budget of summary.config.budgets) {
      lines.push(`### ${storyId} — budget ${budget}`, "", `| Bug | Family | Fault type | ${summary.config.algorithms.join(" | ")} |`, `| --- | --- | --- | ${summary.config.algorithms.map(() => "---:").join(" | ")} |`);
      const bugs = summary.perBug.filter((cell) => cell.storyId === storyId && cell.budget === budget && cell.algorithm === summary.config.algorithms[0]);
      for (const bug of bugs) {
        const values = summary.config.algorithms.map((algorithm) => summary.perBug.find((cell) => cell.storyId === bug.storyId && cell.bugId === bug.bugId && cell.budget === budget && cell.algorithm === algorithm));
        lines.push(`| ${bug.bugId} | ${bug.family} | ${bug.faultType} | ${values.map((cell) => cell ? `${percent(cell.probability)} (${cell.discoveries}/${cell.runs})` : "n/a").join(" | ")} |`);
      }
      lines.push("");
    }
  }
  lines.push("## Complementarity", "", "Exclusive discoveries count paired (search seed, bug) opportunities found by exactly one strategy.", "", "| Story | Budget | Paired runs | Union/bug opportunities | Exclusive discoveries | Patterns |", "| --- | ---: | ---: | ---: | --- | --- |");
  for (const cell of summary.complementarity) {
    const exclusive = Object.entries(cell.exclusiveDiscoveries).filter(([, count]) => count > 0).map(([algorithm, count]) => `${algorithm}: ${count}`).join(", ") || "none";
    const patterns = Object.entries(cell.discoveryPatternCounts).sort().map(([pattern, count]) => `${pattern}: ${count}`).join(", ") || "none";
    lines.push(`| ${cell.storyId} | ${cell.budget} | ${cell.pairedRuns} | ${cell.unionDiscoveries}/${cell.bugOpportunities} | ${exclusive} | ${patterns} |`);
  }
  lines.push("", "## Resource envelope", "", "| Story | Algorithm | Budget | Completed | Resource-stopped | Mean transitions | Harness peak heap MiB | Adapter tracked heap MiB | Peak checkpoints MiB |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const cell of summary.resources) {
    lines.push(`| ${cell.storyId} | ${cell.algorithm} | ${cell.budget} | ${cell.completed}/${cell.runs} | ${cell.resourceStopped} | ${format(cell.meanTransitions)} | ${cell.meanPeakHeapBytes === null ? "n/a" : format(cell.meanPeakHeapBytes / 2 ** 20)} | ${cell.meanAdapterPeakTrackedHeapBytes === null ? "n/a" : format(cell.meanAdapterPeakTrackedHeapBytes / 2 ** 20)} | ${cell.meanPeakCheckpointBytes === null ? "n/a" : format(cell.meanPeakCheckpointBytes / 2 ** 20)} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function csv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function writeMutantExperiment(outputDirectory: string, result: MutantExperimentResult): void {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileAtomic(join(outputDirectory, "config.json"), `${JSON.stringify(result.summary.config, null, 2)}\n`);
  writeFileAtomic(join(outputDirectory, "corpus-manifest.json"), `${JSON.stringify(getAuthoredPlantedCorpusManifest(), null, 2)}\n`);
  if (result.cellFiles) writeNdjsonAtomicFromJsonFiles(join(outputDirectory, "runs.ndjson"), result.cellFiles);
  else writeFileAtomic(join(outputDirectory, "runs.ndjson"), `${result.runs.map((run) => JSON.stringify(run)).join("\n")}\n`);
  const headers = ["runId", "storyId", "algorithm", "searchSeed", "storySeed", "primaryBudgetUnit", "primaryBudget", "workBudgetUnit", "workBudgetLimit", "requestedParallelism", "effectiveParallelism", "parallelismMode", "status", "stopReason", "discoveryTimingBasis", "transitions", "bugsDiscovered", "bugFraction", "bugIds", "wallMs", "peakHeapBytes", "peakCheckpointBytes", "adapterPeakTrackedHeapBytes", "adapterHeapEnvelopeBytes"];
  const rows = result.runs.map((run) => [
    run.runId,
    run.fixtureId.replace(/^authored-planted-/, ""),
    run.algorithm,
    run.searchSeed,
    run.storySeed,
    run.budget.unit,
    run.budget.limit,
    run.workBudget?.unit ?? "",
    run.workBudget?.limit ?? "",
    run.parallelism.requested ?? "",
    run.parallelism.effective ?? "",
    run.parallelism.mode,
    run.status,
    run.stopReason,
    run.discoveryTimingBasis,
    run.counts.transitions,
    run.discoveredBugs.length,
    run.plantedBugIds.length === 0 ? 0 : run.discoveredBugs.length / run.plantedBugIds.length,
    run.discoveredBugs.map((bug) => bug.bugId).join(";"),
    run.timing.wallMs,
    run.resources?.process.peak.heapUsedBytes ?? "",
    run.resources?.snapshots.peakCheckpointBytes ?? "",
    run.adapterResources?.peakTrackedHeapBytes ?? "",
    run.adapterResources?.heapEnvelopeBytes ?? "",
  ]);
  writeFileAtomic(join(outputDirectory, "runs.csv"), `${[headers, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`);
  writeFileAtomic(join(outputDirectory, "summary.json"), `${JSON.stringify(result.summary, null, 2)}\n`);
  writeFileAtomic(join(outputDirectory, "summary.md"), renderMutantMarkdown(result.summary));
}
