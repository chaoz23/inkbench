import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendLineDurable, writeFileAtomic, writeJsonAtomic } from "../core/atomic.js";
import { benchmarkRunId } from "../core/identity.js";
import { runBenchmarkIsolated, type IsolatedRunOptions } from "../core/isolated.js";
import type { ExperimentConfig, RunReport, RunRequest } from "../core/types.js";
import { generateFixture } from "../fixtures/generate.js";
import { summarizeRuns } from "./summarize.js";
import type { ExperimentResult } from "./run.js";

export interface IsolatedExperimentOptions extends Omit<IsolatedRunOptions, "latestProgressPath"> {
  outputDirectory: string;
  resume?: boolean;
  /** Keep item-level coverage in the returned in-memory runs. Cell files always retain it. */
  retainCoverageItems?: boolean;
  onRun?: (report: RunReport, completed: number, total: number, resumed: boolean) => void;
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

function persistPartial(outputDirectory: string, config: ExperimentConfig, runs: RunReport[], total: number): void {
  writeJsonAtomic(join(outputDirectory, "matrix-state.json"), {
    schemaVersion: 1,
    status: runs.length === total ? "complete" : "running",
    completedCells: runs.length,
    totalCells: total,
    config,
    runIds: runs.map((run) => run.runId),
  });
}

export async function runExperimentIsolated(config: ExperimentConfig, options: IsolatedExperimentOptions): Promise<ExperimentResult> {
  const runs: RunReport[] = [];
  const cellFiles: string[] = [];
  const total = config.families.length * config.fixtureSeeds.length * config.searchSeeds.length * config.algorithms.length * config.budgets.length;
  const cellsDirectory = join(options.outputDirectory, "cells");
  const progressDirectory = join(options.outputDirectory, "progress");
  mkdirSync(cellsDirectory, { recursive: true });
  mkdirSync(progressDirectory, { recursive: true });
  writeJsonAtomic(join(options.outputDirectory, "config.json"), config);
  const partialRunsPath = join(options.outputDirectory, "runs.partial.ndjson");
  if (!options.resume || !existsSync(partialRunsPath)) writeFileAtomic(partialRunsPath, "");

  for (const family of config.families) for (const fixtureSeed of config.fixtureSeeds) {
    const fixture = generateFixture(family, fixtureSeed, config.difficulty);
    for (const budget of config.budgets) for (const searchSeed of config.searchSeeds) for (const algorithm of config.algorithms) {
      const request: RunRequest = {
        fixture,
        algorithm,
        searchSeed,
        storySeed: config.storySeed,
        budget,
        ...(config.inkcheckCommand ? { inkcheckCommand: config.inkcheckCommand } : {}),
        ...(config.resources ? { resources: config.resources } : {}),
      };
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
  return { runs, summary: summarizeRuns(runs, config), cellFiles };
}
