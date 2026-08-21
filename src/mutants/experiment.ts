import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic, writeNdjsonAtomicFromJsonFiles } from "../core/atomic.js";
import { benchmarkRunId } from "../core/identity.js";
import { runBenchmark } from "../core/run.js";
import { SCHEMA_VERSION, type AlgorithmId, type AuthoredFaultType, type BugFamily, type InkCheckOptions, type ResourceLimits, type RunReport, type RunRequest, type TerminalOutcomeCounts } from "../core/types.js";
import { summarizeTerminalOutcomes } from "../analysis/outcomes.js";
import { assertSummarizableRuns } from "../core/validation.js";
import { scheduleAlgorithmBlocks } from "../experiments/schedule.js";
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
  cellOrder?: "configured" | "counterbalanced";
  scheduleSeed?: number;
  fixturePartition?: "development" | "validation" | "evaluation";
  /** How repeated cells for deterministic algorithms should be interpreted. */
  deterministicReplication?: "single" | "environment";
}

export interface BugYieldCell {
  storyId: string;
  algorithm: AlgorithmId;
  budget: number;
  runs: number;
  completed: number;
  resourceStopped: number;
  plantedBugs: number;
  meanBugsDiscovered: number;
  medianBugsDiscovered: number | null;
  maxBugsDiscovered: number;
  meanBugFraction: number;
  probabilityAny: number;
  probabilityAnyInterval95: [number, number];
  probabilityAnyResourceStopSensitivity: { lower: number; upper: number };
  completedProbabilityAny: number | null;
  probabilityAll: number;
  probabilityAllInterval95: [number, number];
  probabilityAllResourceStopSensitivity: { lower: number; upper: number };
  completedProbabilityAll: number | null;
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
  completed: number;
  resourceStopped: number;
  discoveries: number;
  probability: number;
  interval95: [number, number];
  resourceStopSensitivity: { lower: number; upper: number };
  medianTransitionsToDiscovery: number | null;
  medianElapsedMsToDiscovery: number | null;
}

export interface MutantComplementarityCell {
  storyId: string;
  budget: number;
  algorithms: AlgorithmId[];
  pairedRuns: number;
  fullyCompletedRuns: number;
  resourceAffectedRuns: number;
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
  meanPeakCheckpointBytes: number | null;
}

export interface MutantExperimentSummary {
  schemaVersion: typeof SCHEMA_VERSION;
  benchmarkTier: "authored-planted";
  generatedAt: string;
  config: MutantExperimentConfig;
  totalRuns: number;
  successfulRuns: number;
  terminalOutcomes: TerminalOutcomeCounts;
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

export interface PlannedMutantCell {
  request: RunRequest;
  runId: string;
  storyId: string;
  block: number;
  position: number;
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

function wilson95(successes: number, trials: number): [number, number] {
  if (trials === 0) return [0, 1];
  const z = 1.959963984540054;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function observedRun(run: RunReport): boolean {
  return run.status === "completed" || run.status === "resource-stopped";
}

function fixtureId(storyId: string): string {
  return `authored-planted-${storyId}`;
}

function bugYieldCells(runs: RunReport[], config: MutantExperimentConfig): BugYieldCell[] {
  const cells: BugYieldCell[] = [];
  for (const storyId of config.storyIds) for (const budget of config.budgets) for (const algorithm of config.algorithms) {
    const matching = runs.filter((run) => run.fixtureId === fixtureId(storyId) && run.budget.limit === budget && run.algorithm === algorithm);
    const completed = matching.filter((run) => run.status === "completed");
    const observed = matching.filter(observedRun);
    const resourceStopped = observed.filter((run) => run.status === "resource-stopped");
    const plantedBugs = matching[0]?.plantedBugIds.length ?? loadAuthoredPlantedFixture(storyId).manifest.bugs.length;
    const counts = observed.map((run) => run.discoveredBugs.length);
    const any = observed.filter((run) => run.discoveredBugs.length > 0).length;
    const all = observed.filter((run) => run.discoveredBugs.length === plantedBugs).length;
    const firstTimes = observed.flatMap((run) => run.discoveryTimingBasis === "global-work" && run.discoveredBugs[0] ? [run.discoveredBugs[0].transition] : []);
    cells.push({
      storyId,
      algorithm,
      budget,
      runs: observed.length,
      completed: completed.length,
      resourceStopped: resourceStopped.length,
      plantedBugs,
      meanBugsDiscovered: mean(counts),
      medianBugsDiscovered: median(counts),
      maxBugsDiscovered: counts.length === 0 ? 0 : Math.max(...counts),
      meanBugFraction: plantedBugs === 0 ? 0 : mean(counts) / plantedBugs,
      probabilityAny: observed.length === 0 ? 0 : any / observed.length,
      probabilityAnyInterval95: wilson95(any, observed.length),
      probabilityAnyResourceStopSensitivity: {
        lower: observed.length === 0 ? 0 : any / observed.length,
        upper: observed.length === 0 ? 1 : (any + resourceStopped.filter((run) => run.discoveredBugs.length === 0).length) / observed.length,
      },
      completedProbabilityAny: completed.length === 0 ? null : completed.filter((run) => run.discoveredBugs.length > 0).length / completed.length,
      probabilityAll: observed.length === 0 ? 0 : all / observed.length,
      probabilityAllInterval95: wilson95(all, observed.length),
      probabilityAllResourceStopSensitivity: {
        lower: observed.length === 0 ? 0 : all / observed.length,
        upper: observed.length === 0 ? 1 : (all + resourceStopped.filter((run) => run.discoveredBugs.length < plantedBugs).length) / observed.length,
      },
      completedProbabilityAll: completed.length === 0 ? null : completed.filter((run) => run.discoveredBugs.length === plantedBugs).length / completed.length,
      medianTransitionsToFirst: median(firstTimes),
      meanWallMs: mean(observed.map((run) => run.timing.wallMs)),
    });
  }
  return cells;
}

function perBugCells(runs: RunReport[], config: MutantExperimentConfig): PerBugCell[] {
  const cells: PerBugCell[] = [];
  for (const storyId of config.storyIds) {
    const bugs = loadAuthoredPlantedFixture(storyId).manifest.bugs;
    for (const budget of config.budgets) for (const algorithm of config.algorithms) {
      const observed = runs.filter((run) => run.fixtureId === fixtureId(storyId) && run.budget.limit === budget && run.algorithm === algorithm && observedRun(run));
      const completed = observed.filter((run) => run.status === "completed");
      const resourceStopped = observed.filter((run) => run.status === "resource-stopped");
      for (const bug of bugs) {
        const discoveries = observed.flatMap((run) => {
          const found = run.discoveredBugs.find((candidate) => candidate.bugId === bug.id);
          return found ? [{ run, found }] : [];
        });
        cells.push({
          storyId,
          bugId: bug.id,
          family: bug.family,
          faultType: bug.faultType,
          algorithm,
          budget,
          runs: observed.length,
          completed: completed.length,
          resourceStopped: resourceStopped.length,
          discoveries: discoveries.length,
          probability: observed.length === 0 ? 0 : discoveries.length / observed.length,
          interval95: wilson95(discoveries.length, observed.length),
          resourceStopSensitivity: {
            lower: observed.length === 0 ? 0 : discoveries.length / observed.length,
            upper: observed.length === 0 ? 1 : (discoveries.length + resourceStopped.filter((run) => !run.discoveredBugs.some((candidate) => candidate.bugId === bug.id)).length) / observed.length,
          },
          medianTransitionsToDiscovery: median(discoveries.flatMap(({ run, found }) => run.discoveryTimingBasis === "global-work" ? [found.transition] : [])),
          medianElapsedMsToDiscovery: median(discoveries.flatMap(({ run, found }) => run.discoveryTimingBasis === "final-only" ? [] : [found.elapsedMs])),
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
    let fullyCompletedRuns = 0;
    let resourceAffectedRuns = 0;
    let unionDiscoveries = 0;
    for (const group of paired.values()) {
      if (!config.algorithms.every((algorithm) => {
        const run = group.get(algorithm);
        return run !== undefined && observedRun(run);
      })) continue;
      pairedRuns += 1;
      const selected = config.algorithms.map((algorithm) => group.get(algorithm)!);
      if (selected.every((run) => run.status === "completed")) fullyCompletedRuns += 1;
      else resourceAffectedRuns += 1;
      const canUseCommonHorizon = selected.every((run) => run.discoveryTimingBasis !== "final-only");
      const commonHorizon = Math.min(...selected.map((run) => run.timing.wallMs));
      for (const bug of bugs) {
        const finders = config.algorithms.filter((algorithm) => group.get(algorithm)!.discoveredBugs.some((discovery) => discovery.bugId === bug.id && (!canUseCommonHorizon || discovery.elapsedMs <= commonHorizon)));
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
      fullyCompletedRuns,
      resourceAffectedRuns,
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
    cells.push({
      storyId,
      algorithm,
      budget,
      runs: matching.length,
      completed: matching.filter((run) => run.status === "completed").length,
      resourceStopped: matching.filter((run) => run.status === "resource-stopped").length,
      meanTransitions: mean(matching.map((run) => run.counts.transitions)),
      meanPeakHeapBytes: (() => {
        const values = measured.flatMap((run) => typeof run.resources!.process.peak?.heapUsedBytes === "number" ? [run.resources!.process.peak.heapUsedBytes] : []);
        return values.length === 0 ? null : mean(values);
      })(),
      meanPeakCheckpointBytes: (() => {
        const values = measured.flatMap((run) => typeof run.resources!.snapshots?.peakCheckpointBytes === "number" ? [run.resources!.snapshots.peakCheckpointBytes] : []);
        return values.length === 0 ? null : mean(values);
      })(),
    });
  }
  return cells;
}

function validateConfig(config: MutantExperimentConfig): void {
  if (config.schemaVersion !== SCHEMA_VERSION) throw new RangeError(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (config.storyIds.length === 0 || new Set(config.storyIds).size !== config.storyIds.length) throw new RangeError("storyIds must be non-empty and unique");
  if (config.algorithms.length === 0 || new Set(config.algorithms).size !== config.algorithms.length) throw new RangeError("algorithms must be non-empty and unique");
  const algorithms = new Set<AlgorithmId>(["random", "systematic", "coverage", "swarm", "inkcheck"]);
  for (const algorithm of config.algorithms) if (!algorithms.has(algorithm)) throw new RangeError(`unknown algorithm: ${algorithm}`);
  if (config.searchSeeds.length === 0 || config.searchSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)) throw new RangeError("searchSeeds must contain non-negative safe integers");
  if (config.deterministicReplication !== undefined && config.deterministicReplication !== "single" && config.deterministicReplication !== "environment") throw new RangeError("deterministicReplication must be single or environment");
  if (config.algorithms.includes("systematic") && config.searchSeeds.length > 1 && config.deterministicReplication === undefined) {
    throw new RangeError("multiple systematic search seeds require deterministicReplication=single or environment");
  }
  if (config.budgets.length === 0 || config.budgets.some((budget) => !Number.isSafeInteger(budget) || budget < 1)) throw new RangeError("budgets must contain positive safe integers");
  if (config.budgetMode !== undefined && config.budgetMode !== "work" && config.budgetMode !== "wall-time") throw new RangeError("budgetMode must be work or wall-time");
  if (config.budgetMode === "wall-time" && (!Number.isSafeInteger(config.workBudgetCeiling) || (config.workBudgetCeiling ?? 0) < 1)) {
    throw new RangeError("wall-time mode requires a positive workBudgetCeiling");
  }
  if (config.budgetMode === "wall-time" && config.resources?.maxTimeMs !== undefined) {
    throw new RangeError("wall-time mode cannot also set resources.maxTimeMs");
  }
  if (!Number.isSafeInteger(config.storySeed) || config.storySeed < 1) throw new RangeError("storySeed must be a positive safe integer");
  if (config.cellOrder !== undefined && config.cellOrder !== "configured" && config.cellOrder !== "counterbalanced") throw new RangeError("cellOrder must be configured or counterbalanced");
  if (config.scheduleSeed !== undefined && !Number.isSafeInteger(config.scheduleSeed)) throw new RangeError("scheduleSeed must be a safe integer");
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
  const plan = plannedMutantCells(config);
  for (const cell of plan) {
    const report = runBenchmark(cell.request);
    runs.push(report);
    onRun?.(report, runs.length, plan.length);
  }
  return { runs, summary: summarizeMutantRuns(runs, config) };
}

export function plannedMutantCells(config: MutantExperimentConfig): PlannedMutantCell[] {
  validateConfig(config);
  const blocks: Array<{ storyId: string; budget: number; searchSeed: number }> = [];
  for (const storyId of config.storyIds) for (const budget of config.budgets) for (const searchSeed of config.searchSeeds) {
    blocks.push({ storyId, budget, searchSeed });
  }
  const fixtures = new Map(config.storyIds.map((storyId) => [storyId, loadAuthoredPlantedFixture(storyId)]));
  return scheduleAlgorithmBlocks(blocks, config.algorithms, config.cellOrder, config.scheduleSeed)
    .filter(({ value, algorithm }) => config.deterministicReplication !== "single" || algorithm !== "systematic" || value.searchSeed === config.searchSeeds[0])
    .map(({ value, algorithm, block, position }) => {
      const request = mutantRunRequest(config, fixtures.get(value.storyId)!, algorithm, value.searchSeed, value.budget);
      return { request, runId: benchmarkRunId(request), storyId: value.storyId, block, position };
    });
}

export function summarizeMutantRuns(runs: RunReport[], config: MutantExperimentConfig, generatedAt = new Date().toISOString()): MutantExperimentSummary {
  validateConfig(config);
  assertSummarizableRuns(runs);
  return {
    schemaVersion: SCHEMA_VERSION,
    benchmarkTier: "authored-planted",
    generatedAt,
    config,
    totalRuns: runs.length,
    successfulRuns: runs.filter((run) => run.status === "completed").length,
    terminalOutcomes: summarizeTerminalOutcomes(runs),
    bugYield: bugYieldCells(runs, config),
    perBug: perBugCells(runs, config),
    complementarity: complementarityCells(runs, config),
    resources: resourceCells(runs, config),
    interpretation: config.budgetMode === "wall-time"
      ? "Each bug is a disclosed mutation of a pinned authored story. Planned wall-time expiry is a completed cell. Resource-stopped prefixes contribute to observed-anytime estimates and are labeled separately; they are not fixed-grant completers."
      : "Each bug is a disclosed mutation of a pinned authored story. Completed and resource-stopped prefixes contribute to observed-anytime estimates and are labeled separately; resource-dependent stopping can be informative.",
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
    `Runs: ${summary.successfulRuns}/${summary.totalRuns} completed. Yield below is observed-anytime evidence from completed and resource-stopped prefixes; the resource table separates them.`,
    "",
    "> This tier measures 20 disclosed defects in a deterministic derivative of The Intercept. A run receives credit per distinct oracle, not merely for finding any defect.",
    "",
    "## Bug yield",
    "",
    "| Story | Algorithm | Budget | Completed | Mean bugs | Median bugs | Max bugs | Mean fraction | Observed P(any), 95% CI | Completed-only P(any) | Observed P(all), 95% CI | Completed-only P(all) | Median first discovery |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const cell of summary.bugYield) {
    lines.push(`| ${cell.storyId} | ${cell.algorithm} | ${cell.budget} | ${cell.completed}/${cell.runs} | ${format(cell.meanBugsDiscovered)} | ${cell.medianBugsDiscovered ?? "n/a"} | ${cell.maxBugsDiscovered} | ${percent(cell.meanBugFraction)} | ${percent(cell.probabilityAny)} [${percent(cell.probabilityAnyInterval95[0])}, ${percent(cell.probabilityAnyInterval95[1])}]; stop sensitivity ${percent(cell.probabilityAnyResourceStopSensitivity.lower)}–${percent(cell.probabilityAnyResourceStopSensitivity.upper)} | ${cell.completedProbabilityAny === null ? "n/a" : percent(cell.completedProbabilityAny)} | ${percent(cell.probabilityAll)} [${percent(cell.probabilityAllInterval95[0])}, ${percent(cell.probabilityAllInterval95[1])}]; stop sensitivity ${percent(cell.probabilityAllResourceStopSensitivity.lower)}–${percent(cell.probabilityAllResourceStopSensitivity.upper)} | ${cell.completedProbabilityAll === null ? "n/a" : percent(cell.completedProbabilityAll)} | ${cell.medianTransitionsToFirst ?? "n/a"} |`);
  }
  lines.push("", "## Per-bug competence map", "");
  for (const storyId of summary.config.storyIds) {
    for (const budget of summary.config.budgets) {
      lines.push(`### ${storyId} — budget ${budget}`, "", `| Bug | Family | Fault type | ${summary.config.algorithms.join(" | ")} |`, `| --- | --- | --- | ${summary.config.algorithms.map(() => "---:").join(" | ")} |`);
      const bugs = summary.perBug.filter((cell) => cell.storyId === storyId && cell.budget === budget && cell.algorithm === summary.config.algorithms[0]);
      for (const bug of bugs) {
        const values = summary.config.algorithms.map((algorithm) => summary.perBug.find((cell) => cell.storyId === bug.storyId && cell.bugId === bug.bugId && cell.budget === budget && cell.algorithm === algorithm));
        lines.push(`| ${bug.bugId} | ${bug.family} | ${bug.faultType} | ${values.map((cell) => cell ? `${percent(cell.probability)} [${percent(cell.interval95[0])}, ${percent(cell.interval95[1])}] (${cell.discoveries}/${cell.runs}); stop sensitivity ${percent(cell.resourceStopSensitivity.lower)}–${percent(cell.resourceStopSensitivity.upper)}` : "n/a").join(" | ")} |`);
      }
      lines.push("");
    }
  }
  lines.push("## Complementarity", "", "Exclusive discoveries count paired (search seed, bug) opportunities found by exactly one strategy before the shortest observed wall-time horizon in that pair. Resource-affected pairs are labeled separately.", "", "| Story | Budget | Paired runs | Completed pairs | Resource-affected | Union/bug opportunities | Exclusive discoveries | Patterns |", "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |");
  for (const cell of summary.complementarity) {
    const exclusive = Object.entries(cell.exclusiveDiscoveries).filter(([, count]) => count > 0).map(([algorithm, count]) => `${algorithm}: ${count}`).join(", ") || "none";
    const patterns = Object.entries(cell.discoveryPatternCounts).sort().map(([pattern, count]) => `${pattern}: ${count}`).join(", ") || "none";
    lines.push(`| ${cell.storyId} | ${cell.budget} | ${cell.pairedRuns} | ${cell.fullyCompletedRuns} | ${cell.resourceAffectedRuns} | ${cell.unionDiscoveries}/${cell.bugOpportunities} | ${exclusive} | ${patterns} |`);
  }
  lines.push("", "## Resource envelope", "", "| Story | Algorithm | Budget | Completed | Resource-stopped | Mean transitions | Peak heap MiB | Peak checkpoints MiB |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const cell of summary.resources) {
    lines.push(`| ${cell.storyId} | ${cell.algorithm} | ${cell.budget} | ${cell.completed}/${cell.runs} | ${cell.resourceStopped} | ${format(cell.meanTransitions)} | ${cell.meanPeakHeapBytes === null ? "n/a" : format(cell.meanPeakHeapBytes / 2 ** 20)} | ${cell.meanPeakCheckpointBytes === null ? "n/a" : format(cell.meanPeakCheckpointBytes / 2 ** 20)} |`);
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
  const headers = ["runId", "storyId", "algorithm", "searchSeed", "storySeed", "primaryBudgetUnit", "primaryBudget", "workBudgetUnit", "workBudgetLimit", "requestedParallelism", "effectiveParallelism", "parallelismMode", "status", "stopReason", "discoveryTimingBasis", "transitions", "bugsDiscovered", "bugFraction", "bugIds", "wallMs", "peakHeapBytes", "peakCheckpointBytes"];
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
    run.resources?.process.peak?.heapUsedBytes ?? "",
    run.resources?.snapshots?.peakCheckpointBytes ?? "",
  ]);
  writeFileAtomic(join(outputDirectory, "runs.csv"), `${[headers, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`);
  writeFileAtomic(join(outputDirectory, "summary.json"), `${JSON.stringify(result.summary, null, 2)}\n`);
  writeFileAtomic(join(outputDirectory, "summary.md"), renderMutantMarkdown(result.summary));
}
