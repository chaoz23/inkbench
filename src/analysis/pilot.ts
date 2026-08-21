export interface SequentialPilotPlan {
  schemaVersion: 1;
  fixtureSeeds: number[];
  minimumRuns: number;
  maximumRuns: number;
  stageSize: number;
  targetWilsonHalfWidth: number;
}

export interface SequentialPilotDecision {
  schemaVersion: 1;
  runsObserved: number;
  observedFixtureSeeds: number[];
  successes: number;
  interval95: { lower: number; upper: number };
  halfWidth: number;
  atStageBoundary: boolean;
  decision: "continue" | "stop-precision" | "stop-maximum";
  nextStageRuns: number | null;
  nextStageFixtureSeeds: number[];
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

export function validateSequentialPilotPlan(plan: SequentialPilotPlan): void {
  if (plan.schemaVersion !== 1) throw new RangeError("pilot schemaVersion must be 1");
  if (plan.fixtureSeeds.length !== plan.maximumRuns || new Set(plan.fixtureSeeds).size !== plan.fixtureSeeds.length) throw new RangeError("fixtureSeeds must preregister exactly maximumRuns unique seeds");
  if (plan.fixtureSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 1)) throw new RangeError("fixtureSeeds must be positive safe integers");
  for (const field of ["minimumRuns", "maximumRuns", "stageSize"] as const) if (!Number.isSafeInteger(plan[field]) || plan[field] < 1) throw new RangeError(`${field} must be positive`);
  if (plan.minimumRuns > plan.maximumRuns) throw new RangeError("minimumRuns cannot exceed maximumRuns");
  if (plan.minimumRuns % plan.stageSize !== 0 || plan.maximumRuns % plan.stageSize !== 0) throw new RangeError("minimumRuns and maximumRuns must be stage boundaries");
  if (!(plan.targetWilsonHalfWidth > 0 && plan.targetWilsonHalfWidth < 0.5)) throw new RangeError("targetWilsonHalfWidth must be between 0 and 0.5");
}

export function evaluateSequentialPilot(plan: SequentialPilotPlan, outcomes: boolean[]): SequentialPilotDecision {
  validateSequentialPilotPlan(plan);
  if (outcomes.length > plan.maximumRuns) throw new RangeError("pilot outcomes exceed preregistered maximumRuns");
  const successes = outcomes.filter(Boolean).length;
  const interval95 = wilson95(successes, outcomes.length);
  const halfWidth = (interval95.upper - interval95.lower) / 2;
  const atStageBoundary = outcomes.length > 0 && outcomes.length % plan.stageSize === 0;
  const decision = outcomes.length >= plan.maximumRuns
    ? "stop-maximum"
    : atStageBoundary && outcomes.length >= plan.minimumRuns && halfWidth <= plan.targetWilsonHalfWidth
      ? "stop-precision"
      : "continue";
  return {
    schemaVersion: 1,
    runsObserved: outcomes.length,
    observedFixtureSeeds: plan.fixtureSeeds.slice(0, outcomes.length),
    successes,
    interval95,
    halfWidth,
    atStageBoundary,
    decision,
    nextStageRuns: decision === "continue" ? Math.min(plan.maximumRuns, Math.max(plan.minimumRuns, Math.ceil((outcomes.length + 1) / plan.stageSize) * plan.stageSize)) : null,
    nextStageFixtureSeeds: decision === "continue"
      ? plan.fixtureSeeds.slice(outcomes.length, Math.min(plan.maximumRuns, Math.max(plan.minimumRuns, Math.ceil((outcomes.length + 1) / plan.stageSize) * plan.stageSize)))
      : [],
  };
}
