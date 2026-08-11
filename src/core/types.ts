export const SCHEMA_VERSION = 1 as const;

export type BugFamily =
  | "shallow-obvious"
  | "deep-corridor"
  | "rare-prefix"
  | "combination-lock"
  | "loop-count"
  | "revisit-after-mutation"
  | "novelty-honeypot"
  | "false-novelty"
  | "delayed-consequence"
  | "order-dependent"
  | "compound-needle";

export const BUG_FAMILIES: readonly BugFamily[] = [
  "shallow-obvious",
  "deep-corridor",
  "rare-prefix",
  "combination-lock",
  "loop-count",
  "revisit-after-mutation",
  "novelty-honeypot",
  "false-novelty",
  "delayed-consequence",
  "order-dependent",
  "compound-needle",
];

export type InProcessAlgorithmId = "random" | "systematic" | "coverage" | "swarm";
export type AlgorithmId = InProcessAlgorithmId | "inkcheck";

export interface DifficultyCoordinates {
  depth: number;
  width: number;
  stateDimensionality: number;
  rarity: number;
  delay: number;
  revisit: number;
  deception: number;
  order: number;
}

export interface VariableOracle {
  kind: "variable-equals";
  variable: string;
  value: boolean | number | string;
}

export interface PlantedBug {
  id: string;
  family: BugFamily;
  description: string;
  oracle: VariableOracle;
}

export interface FixtureManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  generatorVersion: "0.1.0";
  fixtureId: string;
  family: BugFamily;
  seed: number;
  difficulty: number;
  dimensions: DifficultyCoordinates;
  parameters: Record<string, number | string | boolean | number[] | string[]>;
  locations: string[];
  bugs: PlantedBug[];
}

export interface GeneratedFixture {
  source: string;
  manifest: FixtureManifest;
}

export interface ChoiceObservation {
  index: number;
  text: string;
  sourcePath: string;
  targetPath: string;
  id: string;
}

export interface RuntimeEvent {
  kind: "bug" | "runtime-error" | "runtime-warning" | "terminal";
  value: string;
}

export interface Observation {
  snapshotId: string;
  location: string;
  text: string;
  tags: string[];
  choices: ChoiceObservation[];
  variables: Record<string, unknown>;
  visitCounts: Record<string, number>;
  depth: number;
  choicePath: number[];
  choiceTextPath: string[];
  terminal: boolean;
  errors: string[];
  warnings: string[];
  events: RuntimeEvent[];
  semanticKey: string;
  rawStateKey: string;
}

export interface CoverageCounts {
  locations: number;
  choiceConfigurations: number;
  choices: number;
  edges: number;
  semanticStates: number;
  rawStates: number;
  variableValues: number;
  variableTransitions: number;
}

export interface CoverageDelta extends CoverageCounts {
  total: number;
}

export interface TransitionResult {
  before: Observation;
  choice: ChoiceObservation;
  after: Observation;
  coverageDelta: CoverageDelta;
  transition: number;
  newlyDiscoveredBugIds: string[];
}

export interface BugDiscovery {
  bugId: string;
  transition: number;
  elapsedMs: number;
  cpuMs: number | null;
  choicePath: number[];
  choiceTextPath: string[];
  location: string;
}

export interface BudgetSpec {
  unit: "choice-transitions" | "inkcheck-states";
  limit: number;
}

export interface RunTiming {
  wallMs: number;
  cpuMs: number | null;
}

export interface RunCounts {
  transitions: number;
  launches: number;
  rootLaunches: number;
  episodesCompleted: number;
}

export interface RunReport {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  fixtureId: string;
  fixtureGeneratorVersion: string;
  fixtureSourceSha256: string;
  family: BugFamily;
  algorithm: AlgorithmId;
  algorithmVersion: string;
  fixtureSeed: number;
  searchSeed: number;
  storySeed: number;
  difficulty: number;
  dimensions: DifficultyCoordinates;
  budget: BudgetSpec;
  counts: RunCounts;
  coverage: CoverageCounts | null;
  discoveredBugs: BugDiscovery[];
  plantedBugIds: string[];
  timing: RunTiming;
  runtime: {
    engine: string;
    engineVersion: string;
    node: string;
    platform: string;
  };
  status: "completed" | "adapter-unavailable" | "compile-error" | "runtime-error";
  error: string | null;
  notes: string[];
}

export interface RunRequest {
  fixture: GeneratedFixture;
  algorithm: AlgorithmId;
  searchSeed: number;
  storySeed: number;
  budget: number;
  inkcheckCommand?: string;
}

export interface ExperimentConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  families: BugFamily[];
  algorithms: AlgorithmId[];
  fixtureSeeds: number[];
  searchSeeds: number[];
  budgets: number[];
  difficulty: number;
  storySeed: number;
  inkcheckCommand?: string;
}

export interface ProbabilityCell {
  family: BugFamily;
  algorithm: AlgorithmId;
  budget: number;
  runs: number;
  discoveries: number;
  probability: number;
  medianTransitionsToDiscovery: number | null;
  meanWallMs: number;
  meanCpuMs: number | null;
}

export interface SurvivalPoint {
  family: BugFamily;
  algorithm: AlgorithmId;
  budget: number;
  transition: number;
  atRisk: number;
  discoveries: number;
  survival: number;
}

export interface ComplementarityCell {
  family: BugFamily;
  budget: number;
  algorithms: AlgorithmId[];
  runsCompared: number;
  discoveryPatternCounts: Record<string, number>;
  exclusiveDiscoveries: Record<string, number>;
  unionDiscoveries: number;
}

export interface ExperimentSummary {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  config: ExperimentConfig;
  totalRuns: number;
  successfulRuns: number;
  probability: ProbabilityCell[];
  survival: SurvivalPoint[];
  complementarity: ComplementarityCell[];
}
