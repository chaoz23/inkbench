import { SCHEMA_VERSION, type AlgorithmId, type ComplementarityCell, type ExperimentConfig, type ExperimentSummary, type ProbabilityCell, type RunReport, type SurvivalPoint } from "../core/types.js";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupKey(run: RunReport): string {
  return `${run.family}\u0000${run.algorithm}\u0000${run.budget.limit}`;
}

function probabilityCells(runs: RunReport[]): ProbabilityCell[] {
  const groups = new Map<string, RunReport[]>();
  for (const run of runs.filter((candidate) => candidate.status === "completed")) {
    const values = groups.get(groupKey(run)) ?? [];
    values.push(run);
    groups.set(groupKey(run), values);
  }
  return [...groups.values()].map((values) => {
    const first = values[0]!;
    const discovered = values.filter((run) => run.discoveredBugs.length > 0);
    const cpuValues = values.flatMap((run) => run.timing.cpuMs === null ? [] : [run.timing.cpuMs]);
    return {
      family: first.family,
      algorithm: first.algorithm,
      budget: first.budget.limit,
      runs: values.length,
      discoveries: discovered.length,
      probability: discovered.length / values.length,
      medianTransitionsToDiscovery: median(discovered.map((run) => run.discoveredBugs[0]!.transition)),
      meanWallMs: mean(values.map((run) => run.timing.wallMs)),
      meanCpuMs: cpuValues.length === 0 ? null : mean(cpuValues),
    };
  }).sort((left, right) => left.budget - right.budget || left.family.localeCompare(right.family) || left.algorithm.localeCompare(right.algorithm));
}

function survivalCells(runs: RunReport[]): SurvivalPoint[] {
  const groups = new Map<string, RunReport[]>();
  for (const run of runs.filter((candidate) => candidate.status === "completed")) {
    const values = groups.get(groupKey(run)) ?? [];
    values.push(run);
    groups.set(groupKey(run), values);
  }
  const points: SurvivalPoint[] = [];
  for (const values of groups.values()) {
    const first = values[0]!;
    const eventTimes = [...new Set(values.flatMap((run) => run.discoveredBugs.length > 0 ? [run.discoveredBugs[0]!.transition] : []))].sort((a, b) => a - b);
    let survival = 1;
    points.push({ family: first.family, algorithm: first.algorithm, budget: first.budget.limit, transition: 0, atRisk: values.length, discoveries: 0, survival });
    for (const transition of eventTimes) {
      const atRisk = values.filter((run) => {
        const event = run.discoveredBugs[0]?.transition;
        return event === undefined ? run.counts.transitions >= transition : event >= transition;
      }).length;
      const discoveries = values.filter((run) => run.discoveredBugs[0]?.transition === transition).length;
      if (atRisk > 0) survival *= 1 - discoveries / atRisk;
      points.push({ family: first.family, algorithm: first.algorithm, budget: first.budget.limit, transition, atRisk, discoveries, survival });
    }
    const censorAt = Math.max(...values.map((run) => run.counts.transitions));
    if (eventTimes.at(-1) !== censorAt) {
      const atRisk = values.filter((run) => (run.discoveredBugs[0]?.transition ?? run.counts.transitions + 1) > censorAt).length;
      points.push({ family: first.family, algorithm: first.algorithm, budget: first.budget.limit, transition: censorAt, atRisk, discoveries: 0, survival });
    }
  }
  return points.sort((left, right) => left.budget - right.budget || left.family.localeCompare(right.family) || left.algorithm.localeCompare(right.algorithm) || left.transition - right.transition);
}

function complementarityCells(runs: RunReport[], config: ExperimentConfig): ComplementarityCell[] {
  const results: ComplementarityCell[] = [];
  for (const family of config.families) for (const budget of config.budgets) {
    const relevant = runs.filter((run) => run.family === family && run.budget.limit === budget);
    const paired = new Map<string, Map<AlgorithmId, RunReport>>();
    for (const run of relevant) {
      const key = `${run.fixtureSeed}\u0000${run.searchSeed}\u0000${run.storySeed}`;
      const cell = paired.get(key) ?? new Map<AlgorithmId, RunReport>();
      cell.set(run.algorithm, run);
      paired.set(key, cell);
    }
    const patterns: Record<string, number> = {};
    const exclusive = Object.fromEntries(config.algorithms.map((algorithm) => [algorithm, 0]));
    let compared = 0;
    let union = 0;
    for (const cell of paired.values()) {
      if (!config.algorithms.every((algorithm) => cell.get(algorithm)?.status === "completed")) continue;
      compared += 1;
      const finders = config.algorithms.filter((algorithm) => (cell.get(algorithm)?.discoveredBugs.length ?? 0) > 0);
      const pattern = finders.length === 0 ? "none" : finders.join("+");
      patterns[pattern] = (patterns[pattern] ?? 0) + 1;
      if (finders.length > 0) union += 1;
      if (finders.length === 1) exclusive[finders[0]!] = (exclusive[finders[0]!] ?? 0) + 1;
    }
    results.push({
      family,
      budget,
      algorithms: [...config.algorithms],
      runsCompared: compared,
      discoveryPatternCounts: patterns,
      exclusiveDiscoveries: exclusive,
      unionDiscoveries: union,
    });
  }
  return results;
}

export function summarizeRuns(runs: RunReport[], config: ExperimentConfig, generatedAt = new Date().toISOString()): ExperimentSummary {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    config,
    totalRuns: runs.length,
    successfulRuns: runs.filter((run) => run.status === "completed").length,
    probability: probabilityCells(runs),
    survival: survivalCells(runs),
    complementarity: complementarityCells(runs, config),
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderMarkdown(summary: ExperimentSummary): string {
  const lines = [
    "# InkBench experiment summary",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    `Runs: ${summary.successfulRuns}/${summary.totalRuns} completed. Discovery probabilities exclude unavailable/failed adapter cells; raw records retain them.`,
    "",
    "> State and edge counts are empirical discoveries, not proof-relative coverage percentages. InkCheck uses its native state budget while in-process strategies use choice transitions; keep unit labels visible.",
    "",
  ];
  for (const budget of summary.config.budgets) {
    lines.push(`## Competence map at budget ${budget}`, "");
    lines.push(`| Family | ${summary.config.algorithms.join(" | ")} |`, `| --- | ${summary.config.algorithms.map(() => "---:").join(" | ")} |`);
    for (const family of summary.config.families) {
      const cells = summary.config.algorithms.map((algorithm) => summary.probability.find((cell) => cell.family === family && cell.algorithm === algorithm && cell.budget === budget));
      lines.push(`| ${family} | ${cells.map((cell) => cell ? `${percent(cell.probability)} (${cell.discoveries}/${cell.runs})` : "n/a").join(" | ")} |`);
    }
    lines.push("", "### Median transitions to discovery", "");
    lines.push(`| Family | ${summary.config.algorithms.join(" | ")} |`, `| --- | ${summary.config.algorithms.map(() => "---:").join(" | ")} |`);
    for (const family of summary.config.families) {
      const cells = summary.config.algorithms.map((algorithm) => summary.probability.find((cell) => cell.family === family && cell.algorithm === algorithm && cell.budget === budget));
      lines.push(`| ${family} | ${cells.map((cell) => cell?.medianTransitionsToDiscovery ?? "—").join(" | ")} |`);
    }
    lines.push("", "### Complementarity", "", "| Family | Paired cells | Union discoveries | Exclusive discoveries | Patterns |", "| --- | ---: | ---: | --- | --- |");
    for (const cell of summary.complementarity.filter((candidate) => candidate.budget === budget)) {
      const exclusive = Object.entries(cell.exclusiveDiscoveries).filter(([, value]) => value > 0).map(([algorithm, value]) => `${algorithm}: ${value}`).join(", ") || "none";
      const patterns = Object.entries(cell.discoveryPatternCounts).sort().map(([pattern, value]) => `${pattern}: ${value}`).join(", ") || "none";
      lines.push(`| ${cell.family} | ${cell.runsCompared} | ${cell.unionDiscoveries} | ${exclusive} | ${patterns} |`);
    }
    lines.push("");
  }
  lines.push(
    "## Survival data",
    "",
    "Kaplan–Meier-style right-censored points are stored in `summary.json` under `survival`. Plot survival as the fraction of planted bugs still undiscovered; lower and earlier is better.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
