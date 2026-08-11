import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendLineDurable, writeFileAtomic, writeJsonAtomic } from "../core/atomic.js";
import { benchmarkRunId } from "../core/identity.js";
import { runBenchmarkIsolated, type IsolatedRunOptions } from "../core/isolated.js";
import type { AlgorithmId, RunReport } from "../core/types.js";
import { loadAuthoredFixture } from "./load.js";
import { authoredRunRequest, summarizeAuthoredRuns, type AuthoredComplementarityCell, type AuthoredExperimentConfig, type AuthoredExperimentResult } from "./experiment.js";

export interface IsolatedAuthoredExperimentOptions extends Omit<IsolatedRunOptions, "latestProgressPath"> {
  outputDirectory: string;
  resume?: boolean;
  /** Keep item-level coverage in the returned in-memory runs. Cell files always retain it. */
  retainCoverageItems?: boolean;
  onRun?: (report: RunReport, completed: number, total: number, resumed: boolean) => void;
}

function exclusiveCount(own: Set<string>, others: Set<string>[]): number {
  let count = 0;
  for (const item of own) if (!others.some((set) => set.has(item))) count += 1;
  return count;
}

function streamingComplementarity(cellFiles: string[], config: AuthoredExperimentConfig): AuthoredComplementarityCell[] {
  interface Accumulator {
    algorithms: Set<AlgorithmId>;
    pairedRuns: number;
    unionLocations: number;
    unionEdges: number;
    exclusiveLocations: Record<string, number>;
    exclusiveEdges: Record<string, number>;
  }
  const accumulators = new Map<string, Accumulator>();
  const comparableByCell = new Map<string, Set<AlgorithmId>>();
  for (const storyId of config.storyIds) for (const budget of config.budgets) {
    accumulators.set(`${storyId}\u0000${budget}`, {
      algorithms: new Set(),
      pairedRuns: 0,
      unionLocations: 0,
      unionEdges: 0,
      exclusiveLocations: {},
      exclusiveEdges: {},
    });
    comparableByCell.set(`${storyId}\u0000${budget}`, new Set());
  }
  // Match the in-memory summary's cell-wide definition of comparability while
  // retaining only algorithm ids, not item-level coverage, in the parent.
  for (const file of cellFiles) {
    const report = JSON.parse(readFileSync(file, "utf8")) as RunReport;
    if (report.coverageItems !== null) {
      const storyId = report.fixtureId.replace(/^authored-/, "");
      comparableByCell.get(`${storyId}\u0000${report.budget.limit}`)?.add(report.algorithm);
    }
  }

  let groupKey: string | null = null;
  let group: RunReport[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    const first = group[0]!;
    const storyId = first.fixtureId.replace(/^authored-/, "");
    const cellKey = `${storyId}\u0000${first.budget.limit}`;
    const accumulator = accumulators.get(cellKey)!;
    const comparable = config.algorithms.filter((algorithm) => comparableByCell.get(cellKey)!.has(algorithm));
    for (const algorithm of comparable) accumulator.algorithms.add(algorithm);
    const selected = comparable.map((algorithm) => group.find((run) => run.algorithm === algorithm));
    if (comparable.length < 2 || selected.some((run) => run?.status !== "completed" || run.coverageItems === null)) return;
    const locationSets = selected.map((run) => new Set(run!.coverageItems!.locations));
    const edgeSets = selected.map((run) => new Set(run!.coverageItems!.edges));
    accumulator.unionLocations += new Set(locationSets.flatMap((set) => [...set])).size;
    accumulator.unionEdges += new Set(edgeSets.flatMap((set) => [...set])).size;
    for (let index = 0; index < comparable.length; index += 1) {
      const algorithm = comparable[index]!;
      accumulator.exclusiveLocations[algorithm] = (accumulator.exclusiveLocations[algorithm] ?? 0)
        + exclusiveCount(locationSets[index]!, locationSets.filter((_, other) => other !== index));
      accumulator.exclusiveEdges[algorithm] = (accumulator.exclusiveEdges[algorithm] ?? 0)
        + exclusiveCount(edgeSets[index]!, edgeSets.filter((_, other) => other !== index));
    }
    accumulator.pairedRuns += 1;
  };

  for (const file of cellFiles) {
    const report = JSON.parse(readFileSync(file, "utf8")) as RunReport;
    const nextKey = `${report.fixtureId}\u0000${report.budget.limit}\u0000${report.searchSeed}\u0000${report.storySeed}`;
    if (groupKey !== null && nextKey !== groupKey) {
      flush();
      group = [];
    }
    groupKey = nextKey;
    group.push(report);
  }
  flush();

  const meanRecord = (algorithms: AlgorithmId[], record: Record<string, number>, divisor: number): Record<string, number> => Object.fromEntries(
    algorithms.map((algorithm) => [algorithm, divisor > 0 ? (record[algorithm] ?? 0) / divisor : 0]),
  );
  const cells: AuthoredComplementarityCell[] = [];
  for (const storyId of config.storyIds) for (const budget of config.budgets) {
    const accumulator = accumulators.get(`${storyId}\u0000${budget}`)!;
    const algorithms = config.algorithms.filter((algorithm) => accumulator.algorithms.has(algorithm));
    cells.push({
      storyId,
      budget,
      algorithms,
      pairedRuns: accumulator.pairedRuns,
      meanUnionLocations: accumulator.pairedRuns > 0 ? accumulator.unionLocations / accumulator.pairedRuns : 0,
      meanUnionEdges: accumulator.pairedRuns > 0 ? accumulator.unionEdges / accumulator.pairedRuns : 0,
      meanExclusiveLocations: meanRecord(algorithms, accumulator.exclusiveLocations, accumulator.pairedRuns),
      meanExclusiveEdges: meanRecord(algorithms, accumulator.exclusiveEdges, accumulator.pairedRuns),
    });
  }
  return cells;
}

function readCompleted(path: string, expectedRunId: string): RunReport | null {
  if (!existsSync(path)) return null;
  try {
    const report = JSON.parse(readFileSync(path, "utf8")) as RunReport;
    return report.runId === expectedRunId ? report : null;
  } catch {
    return null;
  }
}

function persistPartial(outputDirectory: string, config: AuthoredExperimentConfig, runs: RunReport[], total: number): void {
  writeJsonAtomic(join(outputDirectory, "matrix-state.json"), {
    schemaVersion: 1,
    benchmarkTier: "authored-project",
    status: runs.length === total ? "complete" : "running",
    completedCells: runs.length,
    totalCells: total,
    config,
    runIds: runs.map((run) => run.runId),
  });
}

export async function runAuthoredExperimentIsolated(
  config: AuthoredExperimentConfig,
  options: IsolatedAuthoredExperimentOptions,
): Promise<AuthoredExperimentResult> {
  const runs: RunReport[] = [];
  const cellFiles: string[] = [];
  const total = config.storyIds.length * config.searchSeeds.length * config.algorithms.length * config.budgets.length;
  const cellsDirectory = join(options.outputDirectory, "cells");
  const progressDirectory = join(options.outputDirectory, "progress");
  mkdirSync(cellsDirectory, { recursive: true });
  mkdirSync(progressDirectory, { recursive: true });
  writeJsonAtomic(join(options.outputDirectory, "config.json"), config);
  const partialRunsPath = join(options.outputDirectory, "runs.partial.ndjson");
  if (!options.resume || !existsSync(partialRunsPath)) writeFileAtomic(partialRunsPath, "");

  for (const storyId of config.storyIds) {
    const fixture = loadAuthoredFixture(storyId);
    for (const budget of config.budgets) for (const searchSeed of config.searchSeeds) for (const algorithm of config.algorithms) {
      const request = authoredRunRequest(config, fixture, algorithm, searchSeed, budget);
      const runId = benchmarkRunId(request);
      const cellPath = join(cellsDirectory, `${runId}.json`);
      const saved = options.resume ? readCompleted(cellPath, runId) : null;
      if (saved) {
        cellFiles.push(cellPath);
        runs.push(options.retainCoverageItems === false ? { ...saved, coverageItems: null } : saved);
        persistPartial(options.outputDirectory, config, runs, total);
        options.onRun?.(saved, runs.length, total, true);
        continue;
      }
      const report = await runBenchmarkIsolated(request, {
        ...(options.heapLimitMb === undefined ? {} : { heapLimitMb: options.heapLimitMb }),
        ...(options.hardTimeoutMs === undefined ? {} : { hardTimeoutMs: options.hardTimeoutMs }),
        latestProgressPath: join(progressDirectory, `${runId}.json`),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      });
      writeJsonAtomic(cellPath, report);
      cellFiles.push(cellPath);
      const retainedReport = options.retainCoverageItems === false ? { ...report, coverageItems: null } : report;
      runs.push(retainedReport);
      appendLineDurable(partialRunsPath, JSON.stringify(retainedReport));
      persistPartial(options.outputDirectory, config, runs, total);
      options.onRun?.(report, runs.length, total, false);
    }
  }
  const summary = summarizeAuthoredRuns(runs, config);
  if (options.retainCoverageItems === false) summary.complementarity = streamingComplementarity(cellFiles, config);
  return { runs, summary, cellFiles };
}
