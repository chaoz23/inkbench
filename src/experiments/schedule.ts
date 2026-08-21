import { Prng } from "../core/prng.js";
import type { AlgorithmId, BugFamily, ExperimentConfig } from "../core/types.js";

export interface ExperimentCellSpec {
  family: BugFamily;
  fixtureSeed: number;
  budget: number;
  searchSeed: number;
  algorithm: AlgorithmId;
  block: number;
  position: number;
}

interface BlockSpec {
  family: BugFamily;
  fixtureSeed: number;
  budget: number;
  searchSeed: number;
}

function rotate<T>(values: readonly T[], offset: number): T[] {
  if (values.length === 0) return [];
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

export interface ScheduledAlgorithmCell<T> {
  value: T;
  algorithm: AlgorithmId;
  block: number;
  position: number;
}

/** Apply a frozen serial order and balanced algorithm positions to arbitrary experiment blocks. */
export function scheduleAlgorithmBlocks<T>(
  blocks: readonly T[],
  algorithms: readonly AlgorithmId[],
  policy: "configured" | "counterbalanced" = "configured",
  scheduleSeed = 0,
): ScheduledAlgorithmCell<T>[] {
  const orderedBlocks = policy === "counterbalanced" ? new Prng(scheduleSeed).shuffle([...blocks]) : [...blocks];
  return orderedBlocks.flatMap((value, block) => {
    const orderedAlgorithms = policy === "counterbalanced"
      ? rotate(algorithms, block + scheduleSeed)
      : [...algorithms];
    return orderedAlgorithms.map((algorithm, position) => ({ value, algorithm, block, position }));
  });
}

/** Build the complete serial order before execution so resume cannot rebalance after observing outcomes. */
export function experimentSchedule(config: ExperimentConfig): ExperimentCellSpec[] {
  if (config.algorithms.includes("systematic") && config.searchSeeds.length > 1 && config.deterministicReplication === undefined) {
    throw new RangeError("multiple systematic search seeds require deterministicReplication=single or environment");
  }
  const blocks: BlockSpec[] = [];
  for (const family of config.families) for (const fixtureSeed of config.fixtureSeeds) {
    for (const budget of config.budgets) for (const searchSeed of config.searchSeeds) {
      blocks.push({ family, fixtureSeed, budget, searchSeed });
    }
  }
  return scheduleAlgorithmBlocks(blocks, config.algorithms, config.cellOrder, config.scheduleSeed)
    .map(({ value, ...scheduled }) => ({ ...value, ...scheduled }))
    .filter((cell) => config.deterministicReplication !== "single" || cell.algorithm !== "systematic" || cell.searchSeed === config.searchSeeds[0]);
}
