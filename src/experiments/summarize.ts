import { SCHEMA_VERSION, type AlgorithmId, type ComplementarityCell, type ExperimentConfig, type ExperimentSummary, type ProbabilityCell, type ResourceCell, type RunReport, type SurvivalPoint, type SurvivalTimePoint } from "../core/types.js";
import { assertSummarizableRuns } from "../core/validation.js";
import { auditFixtureEquivalence } from "../fixtures/equivalence.js";
import { summarizeTerminalOutcomes } from "../analysis/outcomes.js";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function observedRun(run: RunReport): boolean {
  return run.status === "completed" || run.status === "resource-stopped";
}

function wilson95(successes: number, total: number): { lower: number; upper: number } {
  if (total === 0) return { lower: 0, upper: 1 };
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function groupKey(run: RunReport): string {
  return `${run.family}\u0000${run.algorithm}\u0000${run.budget.limit}`;
}

function probabilityCells(runs: RunReport[]): ProbabilityCell[] {
  const groups = new Map<string, RunReport[]>();
  for (const run of runs.filter(observedRun)) {
    const values = groups.get(groupKey(run)) ?? [];
    values.push(run);
    groups.set(groupKey(run), values);
  }
  return [...groups.values()].map((values) => {
    const first = values[0]!;
    const discovered = values.filter((run) => run.discoveredBugs.length > 0);
    const completed = values.filter((run) => run.status === "completed");
    const completedDiscovered = completed.filter((run) => run.discoveredBugs.length > 0);
    const unresolvedStops = values.filter((run) => run.status === "resource-stopped" && run.discoveredBugs.length === 0).length;
    const cpuValues = values.flatMap((run) => run.timing.cpuMs === null ? [] : [run.timing.cpuMs]);
    return {
      family: first.family,
      algorithm: first.algorithm,
      budget: first.budget.limit,
      runs: values.length,
      completedRuns: completed.length,
      resourceStoppedRuns: values.filter((run) => run.status === "resource-stopped").length,
      discoveries: discovered.length,
      probability: discovered.length / values.length,
      interval95: wilson95(discovered.length, values.length),
      resourceStopSensitivity: {
        lower: discovered.length / values.length,
        upper: (discovered.length + unresolvedStops) / values.length,
      },
      completedDiscoveries: completedDiscovered.length,
      completedProbability: completed.length === 0 ? null : completedDiscovered.length / completed.length,
      medianTransitionsToDiscovery: median(discovered
        .filter((run) => run.discoveryTimingBasis === "global-work")
        .map((run) => run.discoveredBugs[0]!.transition)),
      medianElapsedMsToDiscovery: median(discovered
        .filter((run) => run.discoveryTimingBasis !== "final-only")
        .map((run) => run.discoveredBugs[0]!.elapsedMs)),
      meanWallMs: mean(values.map((run) => run.timing.wallMs)),
      meanCpuMs: cpuValues.length === 0 ? null : mean(cpuValues),
    };
  }).sort((left, right) => left.budget - right.budget || left.family.localeCompare(right.family) || left.algorithm.localeCompare(right.algorithm));
}

function survivalTimeCells(runs: RunReport[]): SurvivalTimePoint[] {
  const groups = new Map<string, RunReport[]>();
  for (const run of runs.filter((candidate) => observedRun(candidate) && candidate.discoveryTimingBasis !== "final-only")) {
    const values = groups.get(groupKey(run)) ?? [];
    values.push(run);
    groups.set(groupKey(run), values);
  }
  const points: SurvivalTimePoint[] = [];
  for (const values of groups.values()) {
    const first = values[0]!;
    const eventTimes = values.flatMap((run) => run.discoveredBugs[0] ? [run.discoveredBugs[0].elapsedMs] : []);
    const censorTimes = values.flatMap((run) => run.discoveredBugs[0] ? [] : [run.timing.wallMs]);
    const timeline = [...new Set([...eventTimes, ...censorTimes])].sort((a, b) => a - b);
    let survival = 1;
    points.push({ family: first.family, algorithm: first.algorithm, budget: first.budget.limit, elapsedMs: 0, atRisk: values.length, discoveries: 0, censored: 0, resourceStops: 0, survival });
    for (const elapsedMs of timeline) {
      const atRisk = values.filter((run) => {
        const event = run.discoveredBugs[0]?.elapsedMs;
        return event === undefined ? run.timing.wallMs >= elapsedMs : event >= elapsedMs;
      }).length;
      const discoveries = values.filter((run) => run.discoveredBugs[0]?.elapsedMs === elapsedMs).length;
      const censored = values.filter((run) => run.discoveredBugs[0] === undefined && run.timing.wallMs === elapsedMs).length;
      const resourceStops = values.filter((run) => run.status === "resource-stopped" && run.discoveredBugs[0] === undefined && run.timing.wallMs === elapsedMs).length;
      if (atRisk > 0) survival *= 1 - discoveries / atRisk;
      points.push({ family: first.family, algorithm: first.algorithm, budget: first.budget.limit, elapsedMs, atRisk, discoveries, censored, resourceStops, survival });
    }
  }
  return points.sort((left, right) => left.budget - right.budget || left.family.localeCompare(right.family) || left.algorithm.localeCompare(right.algorithm) || left.elapsedMs - right.elapsedMs);
}

function survivalCells(runs: RunReport[]): SurvivalPoint[] {
  const groups = new Map<string, RunReport[]>();
  for (const run of runs.filter((candidate) => observedRun(candidate) && candidate.discoveryTimingBasis === "global-work")) {
    const values = groups.get(groupKey(run)) ?? [];
    values.push(run);
    groups.set(groupKey(run), values);
  }
  const points: SurvivalPoint[] = [];
  for (const values of groups.values()) {
    const first = values[0]!;
    const eventTimes = values.flatMap((run) => run.discoveredBugs.length > 0 ? [run.discoveredBugs[0]!.transition] : []);
    const censorTimes = values.flatMap((run) => run.discoveredBugs.length > 0 ? [] : [run.counts.transitions]);
    const timeline = [...new Set([...eventTimes, ...censorTimes])].sort((a, b) => a - b);
    let survival = 1;
    points.push({ family: first.family, algorithm: first.algorithm, budget: first.budget.limit, transition: 0, atRisk: values.length, discoveries: 0, censored: 0, resourceStops: 0, survival });
    for (const transition of timeline) {
      const atRisk = values.filter((run) => {
        const event = run.discoveredBugs[0]?.transition;
        return event === undefined ? run.counts.transitions >= transition : event >= transition;
      }).length;
      const discoveries = values.filter((run) => run.discoveredBugs[0]?.transition === transition).length;
      const censored = values.filter((run) => run.discoveredBugs[0] === undefined && run.counts.transitions === transition).length;
      const resourceStops = values.filter((run) => run.status === "resource-stopped" && run.discoveredBugs[0] === undefined && run.counts.transitions === transition).length;
      if (atRisk > 0) survival *= 1 - discoveries / atRisk;
      points.push({ family: first.family, algorithm: first.algorithm, budget: first.budget.limit, transition, atRisk, discoveries, censored, resourceStops, survival });
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
    let fullyCompletedRuns = 0;
    let resourceAffectedRuns = 0;
    let union = 0;
    for (const cell of paired.values()) {
      if (!config.algorithms.every((algorithm) => {
        const run = cell.get(algorithm);
        return run !== undefined && observedRun(run);
      })) continue;
      compared += 1;
      const selected = config.algorithms.map((algorithm) => cell.get(algorithm)!);
      if (selected.every((run) => run.status === "completed")) fullyCompletedRuns += 1;
      else resourceAffectedRuns += 1;
      const canUseCommonHorizon = selected.every((run) => run.discoveryTimingBasis !== "final-only");
      const commonHorizon = Math.min(...selected.map((run) => run.timing.wallMs));
      const finders = config.algorithms.filter((algorithm) => {
        const run = cell.get(algorithm)!;
        return canUseCommonHorizon
          ? run.discoveredBugs.some((discovery) => discovery.elapsedMs <= commonHorizon)
          : run.discoveredBugs.length > 0;
      });
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
      fullyCompletedRuns,
      resourceAffectedRuns,
      discoveryPatternCounts: patterns,
      exclusiveDiscoveries: exclusive,
      unionDiscoveries: union,
    });
  }
  return results;
}

function resourceCells(runs: RunReport[]): ResourceCell[] {
  const groups = new Map<string, RunReport[]>();
  for (const run of runs) {
    const values = groups.get(groupKey(run)) ?? [];
    values.push(run);
    groups.set(groupKey(run), values);
  }
  return [...groups.values()].map((values) => {
    const first = values[0]!;
    const measured = values.filter((run) => run.resources !== null);
    const optionalMean = (select: (run: RunReport) => number | null | undefined): number | null => {
      const selected = measured.flatMap((run) => {
        const value = select(run);
        return typeof value === "number" ? [value] : [];
      });
      return selected.length === 0 ? null : mean(selected);
    };
    return {
      family: first.family,
      algorithm: first.algorithm,
      budget: first.budget.limit,
      runs: values.length,
      completed: values.filter((run) => run.status === "completed").length,
      resourceStopped: values.filter((run) => run.status === "resource-stopped").length,
      memoryStopped: values.filter((run) => run.stopReason === "memory").length,
      timeStopped: values.filter((run) => run.stopReason === "time").length,
      discoveriesBeforeStop: values.filter((run) => run.discoveredBugs.length > 0).length,
      meanTransitions: mean(values.map((run) => run.counts.transitions)),
      meanWallMs: mean(values.map((run) => run.timing.wallMs)),
      meanPeakHeapBytes: optionalMean((run) => run.resources!.process.peak?.heapUsedBytes),
      meanPeakRssBytes: optionalMean((run) => run.resources!.process.peak?.rssBytes),
      meanPeakSnapshotBytes: optionalMean((run) => run.resources!.snapshots?.peakBytes),
      meanPeakCheckpointBytes: optionalMean((run) => run.resources!.snapshots?.peakCheckpointBytes),
    };
  }).sort((left, right) => left.budget - right.budget || left.family.localeCompare(right.family) || left.algorithm.localeCompare(right.algorithm));
}

export function summarizeRuns(runs: RunReport[], config: ExperimentConfig, generatedAt = new Date().toISOString()): ExperimentSummary {
  assertSummarizableRuns(runs);
  const replication = config.families.map((family) => {
    const audit = auditFixtureEquivalence(family, config.fixtureSeeds, config.difficulty);
    return {
      family,
      fixtureSeeds: config.fixtureSeeds.length,
      uniqueTopologies: audit.uniqueTopologies,
      searchSeeds: config.searchSeeds.length,
      effectiveIndependentFixtureSamples: audit.uniqueTopologies,
      interpretation: `${audit.uniqueTopologies} structural skeleton(s) across ${config.fixtureSeeds.length} fixture seed(s); ${config.searchSeeds.length} search trajectories per fixture are repeated trajectories, not independent projects.`,
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    config,
    totalRuns: runs.length,
    successfulRuns: runs.filter((run) => run.status === "completed").length,
    terminalOutcomes: summarizeTerminalOutcomes(runs),
    replication,
    probability: probabilityCells(runs),
    survival: survivalCells(runs),
    survivalTime: survivalTimeCells(runs),
    complementarity: complementarityCells(runs, config),
    resources: resourceCells(runs),
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
    `Runs: ${summary.successfulRuns}/${summary.totalRuns} completed. Observed-anytime probabilities include valid resource-stopped cells and exclude unavailable/failed adapter cells.`,
    "",
    "> State and edge counts are empirical discoveries, not proof-relative coverage percentages. InkCheck uses its native state budget while in-process strategies use choice transitions; keep unit labels visible.",
    "",
  ];
  for (const budget of summary.config.budgets) {
    lines.push(`## Observed-anytime Competence map at budget ${budget}`, "");
    lines.push(`| Family | ${summary.config.algorithms.join(" | ")} |`, `| --- | ${summary.config.algorithms.map(() => "---:").join(" | ")} |`);
    for (const family of summary.config.families) {
      const cells = summary.config.algorithms.map((algorithm) => summary.probability.find((cell) => cell.family === family && cell.algorithm === algorithm && cell.budget === budget));
      lines.push(`| ${family} | ${cells.map((cell) => cell
        ? `${percent(cell.probability)} (${cell.discoveries}/${cell.runs}; 95% ${percent(cell.interval95.lower)}–${percent(cell.interval95.upper)}; stop sensitivity ${percent(cell.resourceStopSensitivity.lower)}–${percent(cell.resourceStopSensitivity.upper)}); completed-only ${cell.completedProbability === null ? "n/a" : `${percent(cell.completedProbability)} (${cell.completedDiscoveries}/${cell.completedRuns})`}`
        : "n/a").join(" | ")} |`);
    }
    lines.push("", "### Median transitions to discovery", "");
    lines.push(`| Family | ${summary.config.algorithms.join(" | ")} |`, `| --- | ${summary.config.algorithms.map(() => "---:").join(" | ")} |`);
    for (const family of summary.config.families) {
      const cells = summary.config.algorithms.map((algorithm) => summary.probability.find((cell) => cell.family === family && cell.algorithm === algorithm && cell.budget === budget));
      lines.push(`| ${family} | ${cells.map((cell) => cell?.medianTransitionsToDiscovery ?? "—").join(" | ")} |`);
    }
    lines.push("", "### Common-horizon complementarity", "", "| Family | Paired cells | Fully completed | Resource-affected | Union discoveries | Exclusive discoveries | Patterns |", "| --- | ---: | ---: | ---: | ---: | --- | --- |");
    for (const cell of summary.complementarity.filter((candidate) => candidate.budget === budget)) {
      const exclusive = Object.entries(cell.exclusiveDiscoveries).filter(([, value]) => value > 0).map(([algorithm, value]) => `${algorithm}: ${value}`).join(", ") || "none";
      const patterns = Object.entries(cell.discoveryPatternCounts).sort().map(([pattern, value]) => `${pattern}: ${value}`).join(", ") || "none";
      lines.push(`| ${cell.family} | ${cell.runsCompared} | ${cell.fullyCompletedRuns} | ${cell.resourceAffectedRuns} | ${cell.unionDiscoveries} | ${exclusive} | ${patterns} |`);
    }
    lines.push("");
  }
  lines.push(
    "## Replication audit",
    "",
    "Fixture seeds and search trajectories are reported separately. Structural skeleton counts are conservative audit signatures, not proof that two Ink programs are graph-isomorphic.",
    "",
    "| Family | Fixture seeds | Unique structural skeletons | Search seeds | Interpretation |",
    "| --- | ---: | ---: | ---: | --- |",
  );
  for (const cell of summary.replication) {
    lines.push(`| ${cell.family} | ${cell.fixtureSeeds} | ${cell.uniqueTopologies} | ${cell.searchSeeds} | ${cell.interpretation} |`);
  }
  lines.push(
    "",
    "## Resource envelope",
    "",
    "Resource-stopped cells remain observed partial evidence. They are included in observed-anytime yield, but they do not count as completed fixed-grant trials. Peak snapshot bytes include Ink save JSON plus observations; checkpoint bytes are the subset explicitly retained by a search policy.",
    "",
    "| Family | Algorithm | Budget | Completed | Resource-stopped | Mean transitions | Mean peak heap MiB | Mean peak checkpoints MiB |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const cell of summary.resources) {
    const heap = cell.meanPeakHeapBytes === null ? "n/a" : (cell.meanPeakHeapBytes / 2 ** 20).toFixed(1);
    const checkpoints = cell.meanPeakCheckpointBytes === null ? "n/a" : (cell.meanPeakCheckpointBytes / 2 ** 20).toFixed(1);
    lines.push(`| ${cell.family} | ${cell.algorithm} | ${cell.budget} | ${cell.completed}/${cell.runs} | ${cell.resourceStopped} | ${cell.meanTransitions.toFixed(1)} | ${heap} | ${checkpoints} |`);
  }
  lines.push(
    "",
    "## Survival data",
    "",
    "Observed time-to-first-discovery points are stored in `summary.json` under `survival` (native work) and `survivalTime` (elapsed milliseconds). Resource stops appear at their actual censor times and carry an explicit count. Because resource stopping can depend on the search trajectory, these curves are descriptive rather than an assumption of independent censoring. Final-only timing is excluded.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
