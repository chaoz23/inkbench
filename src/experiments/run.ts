import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic, writeNdjsonAtomicFromJsonFiles } from "../core/atomic.js";
import type { AlgorithmId, BenchmarkFixture, BugFamily, ExperimentConfig, ExperimentSummary, RunReport, RunRequest } from "../core/types.js";
import { generateFixture } from "../fixtures/generate.js";
import { runBenchmark } from "../core/run.js";
import { renderMarkdown, summarizeRuns } from "./summarize.js";
import { experimentSchedule } from "./schedule.js";
import { benchmarkRunId } from "../core/identity.js";

export interface ExperimentResult {
  runs: RunReport[];
  summary: ExperimentSummary;
  /** Full authoritative reports persisted by isolated matrix execution. */
  cellFiles?: string[];
}

export interface PlannedExperimentCell {
  fixture: BenchmarkFixture;
  request: RunRequest;
  runId: string;
  block: number;
  position: number;
}

export function experimentRunRequest(
  config: ExperimentConfig,
  fixture: BenchmarkFixture,
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

export function runExperiment(config: ExperimentConfig, onRun?: (report: RunReport, completed: number, total: number) => void): ExperimentResult {
  const runs: RunReport[] = [];
  const plan = plannedExperimentCells(config);
  for (const cell of plan) {
    const report = runBenchmark(cell.request);
    runs.push(report);
    onRun?.(report, runs.length, plan.length);
  }
  return { runs, summary: summarizeRuns(runs, config) };
}

export function plannedExperimentCells(config: ExperimentConfig): PlannedExperimentCell[] {
  if (config.scheduleSeed !== undefined && !Number.isSafeInteger(config.scheduleSeed)) throw new RangeError("scheduleSeed must be a safe integer");
  const fixtures = new Map<string, BenchmarkFixture>();
  return experimentSchedule(config).map((cell) => {
    const key = `${cell.family}\u0000${cell.fixtureSeed}`;
    let fixture = fixtures.get(key);
    if (!fixture) {
      fixture = generateFixture(cell.family, cell.fixtureSeed, config.difficulty);
      fixtures.set(key, fixture);
    }
    const request = experimentRunRequest(config, fixture, cell.algorithm, cell.searchSeed, cell.budget);
    return { fixture, request, runId: benchmarkRunId(request), block: cell.block, position: cell.position };
  });
}

function csv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function writeExperiment(outputDirectory: string, result: ExperimentResult): void {
  mkdirSync(outputDirectory, { recursive: true });
  const fixtureDirectory = join(outputDirectory, "fixtures");
  mkdirSync(fixtureDirectory, { recursive: true });
  const written = new Set<string>();
  for (const run of result.runs) {
    if (written.has(run.fixtureId)) continue;
    written.add(run.fixtureId);
    if (run.benchmarkTier !== "generated-planted") throw new Error("writeExperiment accepts generated-planted runs only");
    const fixture = generateFixture(run.family as BugFamily, run.fixtureSeed, run.difficulty);
    writeFileAtomic(join(fixtureDirectory, `${run.fixtureId}.ink`), fixture.source);
    writeFileAtomic(join(fixtureDirectory, `${run.fixtureId}.manifest.json`), `${JSON.stringify(fixture.manifest, null, 2)}\n`);
  }
  writeFileAtomic(join(outputDirectory, "config.json"), `${JSON.stringify(result.summary.config, null, 2)}\n`);
  if (result.cellFiles) writeNdjsonAtomicFromJsonFiles(join(outputDirectory, "runs.ndjson"), result.cellFiles);
  else writeFileAtomic(join(outputDirectory, "runs.ndjson"), `${result.runs.map((run) => JSON.stringify(run)).join("\n")}\n`);
  const headers = ["runId", "fixtureId", "fixtureGeneratorVersion", "fixtureSourceSha256", "benchmarkTier", "family", "algorithm", "fixtureSeed", "searchSeed", "storySeed", "difficulty", "primaryBudgetUnit", "primaryBudget", "workBudgetUnit", "workBudgetLimit", "requestedParallelism", "effectiveParallelism", "parallelismMode", "status", "stopReason", "discoveryTimingBasis", "discovered", "firstDiscoveryTransition", "firstDiscoveryElapsedMs", "runtimeFindings", "transitions", "launches", "wallMs", "cpuMs", "peakHeapBytes", "peakRssBytes", "peakSnapshotBytes", "peakCheckpointBytes", "locations", "choices", "edges", "semanticStates", "rawStates"];
  const rows = result.runs.map((run) => [
    run.runId, run.fixtureId, run.fixtureGeneratorVersion, run.fixtureSourceSha256, run.benchmarkTier, run.family, run.algorithm, run.fixtureSeed, run.searchSeed, run.storySeed, run.difficulty,
    run.budget.unit, run.budget.limit, run.workBudget?.unit ?? "", run.workBudget?.limit ?? "", run.parallelism.requested ?? "", run.parallelism.effective ?? "", run.parallelism.mode,
    run.status, run.stopReason, run.discoveryTimingBasis, run.discoveredBugs.length, run.discoveredBugs[0]?.transition ?? "", run.discoveredBugs[0]?.elapsedMs ?? "", run.runtimeFindings.length,
    run.counts.transitions, run.counts.launches, run.timing.wallMs, run.timing.cpuMs ?? "", run.resources?.process.peak?.heapUsedBytes ?? "",
    run.resources?.process.peak?.rssBytes ?? "", run.resources?.snapshots?.peakBytes ?? "", run.resources?.snapshots?.peakCheckpointBytes ?? "", run.coverage?.locations ?? "",
    run.coverage?.choices ?? "", run.coverage?.edges ?? "", run.coverage?.semanticStates ?? "", run.coverage?.rawStates ?? "",
  ]);
  writeFileAtomic(join(outputDirectory, "runs.csv"), `${[headers, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`);
  writeFileAtomic(join(outputDirectory, "summary.json"), `${JSON.stringify(result.summary, null, 2)}\n`);
  writeFileAtomic(join(outputDirectory, "summary.md"), renderMarkdown(result.summary));
}
