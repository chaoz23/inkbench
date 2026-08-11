import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BugFamily, ExperimentConfig, ExperimentSummary, RunReport } from "../core/types.js";
import { generateFixture } from "../fixtures/generate.js";
import { runBenchmark } from "../core/run.js";
import { renderMarkdown, summarizeRuns } from "./summarize.js";

export interface ExperimentResult {
  runs: RunReport[];
  summary: ExperimentSummary;
}

export function runExperiment(config: ExperimentConfig, onRun?: (report: RunReport, completed: number, total: number) => void): ExperimentResult {
  const runs: RunReport[] = [];
  const total = config.families.length * config.fixtureSeeds.length * config.searchSeeds.length * config.algorithms.length * config.budgets.length;
  for (const family of config.families) for (const fixtureSeed of config.fixtureSeeds) {
    const fixture = generateFixture(family, fixtureSeed, config.difficulty);
    for (const budget of config.budgets) for (const searchSeed of config.searchSeeds) for (const algorithm of config.algorithms) {
      const report = runBenchmark({
        fixture,
        algorithm,
        searchSeed,
        storySeed: config.storySeed,
        budget,
        ...(config.inkcheckCommand ? { inkcheckCommand: config.inkcheckCommand } : {}),
      });
      runs.push(report);
      onRun?.(report, runs.length, total);
    }
  }
  return { runs, summary: summarizeRuns(runs, config) };
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
    writeFileSync(join(fixtureDirectory, `${run.fixtureId}.ink`), fixture.source, "utf8");
    writeFileSync(join(fixtureDirectory, `${run.fixtureId}.manifest.json`), `${JSON.stringify(fixture.manifest, null, 2)}\n`, "utf8");
  }
  writeFileSync(join(outputDirectory, "config.json"), `${JSON.stringify(result.summary.config, null, 2)}\n`, "utf8");
  writeFileSync(join(outputDirectory, "runs.ndjson"), `${result.runs.map((run) => JSON.stringify(run)).join("\n")}\n`, "utf8");
  const headers = ["runId", "fixtureId", "fixtureGeneratorVersion", "fixtureSourceSha256", "benchmarkTier", "family", "algorithm", "fixtureSeed", "searchSeed", "storySeed", "difficulty", "budgetUnit", "budget", "status", "discovered", "firstDiscovery", "runtimeFindings", "transitions", "launches", "wallMs", "cpuMs", "locations", "choices", "edges", "semanticStates", "rawStates"];
  const rows = result.runs.map((run) => [
    run.runId, run.fixtureId, run.fixtureGeneratorVersion, run.fixtureSourceSha256, run.benchmarkTier, run.family, run.algorithm, run.fixtureSeed, run.searchSeed, run.storySeed, run.difficulty,
    run.budget.unit, run.budget.limit, run.status, run.discoveredBugs.length, run.discoveredBugs[0]?.transition ?? "", run.runtimeFindings.length,
    run.counts.transitions, run.counts.launches, run.timing.wallMs, run.timing.cpuMs ?? "", run.coverage?.locations ?? "",
    run.coverage?.choices ?? "", run.coverage?.edges ?? "", run.coverage?.semanticStates ?? "", run.coverage?.rawStates ?? "",
  ]);
  writeFileSync(join(outputDirectory, "runs.csv"), `${[headers, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`, "utf8");
  writeFileSync(join(outputDirectory, "summary.json"), `${JSON.stringify(result.summary, null, 2)}\n`, "utf8");
  writeFileSync(join(outputDirectory, "summary.md"), renderMarkdown(result.summary), "utf8");
}
