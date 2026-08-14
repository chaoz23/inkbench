export const SCHEMA_VERSION = 1 as const;
export const RUN_REPORT_SCHEMA_VERSION = 4 as const;
export const PROGRESS_SCHEMA_VERSION = 2 as const;
export const INKBENCH_VERSION = "0.1.0" as const;
export const RUN_CONTRACT_VERSION = "marathon-v4" as const;

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

export type AuthoredStoryFamily =
  | "function-and-loop-heavy"
  | "choice-dense-authored-story"
  | "stitch-heavy-random-authored-story";

export type BenchmarkFamily = BugFamily | AuthoredStoryFamily;
export type BenchmarkTier = "generated-planted" | "authored-planted" | "authored-project";

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

export type AuthoredFaultType =
  | "duplicate-choice"
  | "inventory-alias"
  | "missing-choice"
  | "numeric-sign-corruption"
  | "unrelated-side-effect"
  | "stale-state-reset"
  | "cross-state-contamination"
  | "choice-effect-inversion"
  | "history-erasure"
  | "wrong-divert"
  | "condition-bypass"
  | "impossible-inventory-state"
  | "premature-state-commit"
  | "write-after-write-loss"
  | "revisit-side-effect"
  | "loop-off-by-one"
  | "irrelevant-state-coupling"
  | "compound-state-corruption"
  | "delayed-missing-choice";

export interface BugSourceSite {
  file: string;
  knot: string;
  upstreamLine: number;
}

export interface AuthoredPlantedBug extends PlantedBug {
  faultType: AuthoredFaultType;
  trigger: string;
  effect: string;
  site: BugSourceSite;
  dimensions: DifficultyCoordinates;
}

export interface FixtureManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  generatorVersion: "0.2.0";
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
  tier: "generated-planted";
  source: string;
  manifest: FixtureManifest;
}

export interface SourceBundle {
  entrypoint: string;
  files: Record<string, string>;
}

export interface CorpusSourceMetadata {
  name: string;
  author: string;
  license: "MIT" | "CC-BY-4.0";
  repository: string;
  commit: string;
  licenseFile: string;
  entrypoint: string;
  randomness: "none" | "seeded-runtime";
  structuralMeasures: Record<string, number>;
}

export interface AuthoredFixtureManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  generatorVersion: "authored-corpus-v1";
  fixtureId: string;
  family: AuthoredStoryFamily;
  seed: 0;
  difficulty: 1;
  dimensions: DifficultyCoordinates;
  parameters: Record<string, number | string | boolean | number[] | string[]>;
  locations: string[];
  bugs: PlantedBug[];
  source: CorpusSourceMetadata;
  compiler: {
    name: "inklecate";
    version: string;
    artifactSha256: string;
    arguments: string[];
  };
}

export interface AuthoredFixture {
  tier: "authored-project";
  source: string;
  sourceBundle: SourceBundle;
  compiledStory: string;
  manifest: AuthoredFixtureManifest;
}

export interface AuthoredPlantedFixtureManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  generatorVersion: "authored-planted-v1";
  fixtureId: string;
  family: AuthoredStoryFamily;
  seed: 0;
  difficulty: number;
  dimensions: DifficultyCoordinates;
  parameters: Record<string, number | string | boolean | number[] | string[]>;
  locations: string[];
  bugs: AuthoredPlantedBug[];
  mutationSet: string;
  source: CorpusSourceMetadata;
  compiler: {
    name: "inklecate";
    version: string;
    artifactSha256: string;
    arguments: string[];
  };
}

export interface AuthoredPlantedFixture {
  tier: "authored-planted";
  source: string;
  sourceBundle: SourceBundle;
  compiledStory: string;
  manifest: AuthoredPlantedFixtureManifest;
}

export type BenchmarkFixture = GeneratedFixture | AuthoredPlantedFixture | AuthoredFixture;

export interface ChoiceObservation {
  index: number;
  text: string;
  sourcePath: string;
  targetPath: string;
  id: string;
}

export interface RuntimeEvent {
  kind: "runtime-error" | "runtime-warning" | "terminal";
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

export interface CoverageItems {
  locations: string[];
  choices: string[];
  edges: string[];
  semanticStates: string[];
}

export interface TransitionResult {
  before: Observation;
  choice: ChoiceObservation;
  after: Observation;
  coverageDelta: CoverageDelta;
  transition: number;
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

export interface RuntimeFinding {
  kind: "runtime-error" | "runtime-warning";
  value: string;
  transition: number;
  choicePath: number[];
  choiceTextPath: string[];
  location: string;
}

export interface BudgetSpec {
  unit: "choice-transitions" | "inkcheck-states" | "wall-ms";
  limit: number;
}

export interface InkCheckOptions {
  search?: "portfolio" | "shared" | "shared-variable";
  /** InkCheck defaults to true. The scientific arm disables it so all work is discovery work. */
  minRepro?: boolean;
  /** InkCheck defaults to 100. InkBench previously forced 1,000. */
  maxDepth?: number;
  /** Apply InkCheck's story-shape profile. */
  auto?: boolean;
  /** Fixed worker ceiling for the one-core scientific arm, or InkCheck's workload-aware auto mode. */
  concurrency?: "auto" | number;
}

export interface RunTiming {
  wallMs: number;
  cpuMs: number | null;
  /** Clock used by BugDiscovery.elapsedMs. */
  discoveryTimeOrigin: "search-active" | "tool-global" | "final-report";
  phases: {
    setupMs: number | null;
    searchMs: number | null;
    scoringMs: number | null;
    finalizationMs: number | null;
  };
}

export type ResourceStopReason = "budget" | "work-ceiling" | "search-exhausted" | "memory" | "time" | "cancelled" | "error";

export interface ResourceLimits {
  /** Soft process-heap watermark. Defaults to 85% of V8's heap ceiling. */
  maxMemoryMb?: number;
  /** Optional wall-clock guard for the search itself. */
  maxTimeMs?: number;
  /** Work cadence for progress snapshots. Defaults to 10,000 transitions. */
  progressIntervalTransitions?: number;
  /** Time cadence for progress snapshots. Defaults to one second. */
  progressIntervalMs?: number;
}

export interface ProcessMemoryUsage {
  heapUsedBytes: number;
  rssBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
}

export interface SnapshotMemoryUsage {
  created: number;
  released: number;
  current: number;
  peak: number;
  explicitReferences: number;
  currentBytes: number;
  peakBytes: number;
  checkpointBytes: number;
  peakCheckpointBytes: number;
}

export interface ResourceUsage {
  provenance: "inkbench-worker" | "external-adapter";
  limits: {
    memoryCapBytes: number | null;
    searchMemoryLimitBytes: number | null;
    timeCapMs: number | null;
  };
  stopReason: ResourceStopReason;
  process: {
    peak: {
      heapUsedBytes: number | null;
      rssBytes: number | null;
      externalBytes: number | null;
      arrayBuffersBytes: number | null;
    } | null;
    final: {
      heapUsedBytes: number | null;
      rssBytes: number | null;
      externalBytes: number | null;
      arrayBuffersBytes: number | null;
    } | null;
  };
  snapshots: SnapshotMemoryUsage | null;
  coverageIndexBytes: number | null;
  peakCoverageIndexBytes: number | null;
}

export interface ExecutionFingerprint {
  schemaVersion: 1;
  digest: string;
  harnessArtifactSha256: string;
  packageLockSha256: string | null;
  algorithmVersion: string;
  algorithmArtifactSha256: string | null;
  externalCommandSha256: string | null;
  node: string;
  v8: string;
  platform: string;
  inkRuntimeVersion: string;
  compilerArtifactSha256: string | null;
}

export interface ObservabilityContract {
  informationRegime: "runtime-observation" | "compiled-artifact" | "full-source";
  instrumentationRegime: "inkbench-common" | "external-native" | "external-private-signal";
  commonCoverageCharged: boolean;
}

export interface RunProgressEvent {
  schemaVersion: typeof PROGRESS_SCHEMA_VERSION;
  sequence: number;
  type: "run_start" | "progress" | "discovery" | "run_end";
  runId: string;
  fixtureId: string;
  algorithm: AlgorithmId;
  elapsedMs: number;
  transitions: number;
  transitionBudget: number;
  budget: BudgetSpec;
  budgetFraction: number;
  coverage: CoverageCounts | null;
  discoveredBugIds: string[];
  runtimeFindings: number;
  processMemory: ProcessMemoryUsage;
  snapshotMemory: SnapshotMemoryUsage | null;
  stopReason: ResourceStopReason | null;
}

export interface RunCounts {
  transitions: number;
  launches: number;
  rootLaunches: number;
  episodesCompleted: number;
}

export interface RunReport {
  schemaVersion: typeof RUN_REPORT_SCHEMA_VERSION;
  runId: string;
  fixtureId: string;
  fixtureGeneratorVersion: string;
  fixtureSourceSha256: string;
  benchmarkTier: BenchmarkTier;
  family: BenchmarkFamily;
  algorithm: AlgorithmId;
  algorithmVersion: string;
  executionFingerprint: ExecutionFingerprint;
  observability: ObservabilityContract;
  fixtureSeed: number;
  searchSeed: number;
  storySeed: number;
  difficulty: number;
  dimensions: DifficultyCoordinates;
  /** The controlled independent variable for this run. */
  budget: BudgetSpec;
  /** Native search work ceiling; null only if a future adapter cannot express one. */
  workBudget: BudgetSpec | null;
  counts: RunCounts;
  coverage: CoverageCounts | null;
  coverageItems: CoverageItems | null;
  discoveredBugs: BugDiscovery[];
  runtimeFindings: RuntimeFinding[];
  plantedBugIds: string[];
  /** Whether discovery positions are globally comparable by work, wall time, or only known at final report. */
  discoveryTimingBasis: "global-work" | "global-wall" | "final-only";
  timing: RunTiming;
  parallelism: {
    requested: number | "auto" | null;
    effective: number | null;
    mode: string;
  };
  /** Why work ended, independent of whether a strategy exposes resource telemetry. */
  stopReason: ResourceStopReason;
  resources: ResourceUsage | null;
  runtime: {
    harnessVersion: string;
    runContractVersion: string;
    engine: string;
    engineVersion: string;
    node: string;
    platform: string;
  };
  status: "completed" | "resource-stopped" | "adapter-unavailable" | "compile-error" | "runtime-error";
  error: string | null;
  notes: string[];
}

export interface RunRequest {
  fixture: BenchmarkFixture;
  algorithm: AlgorithmId;
  searchSeed: number;
  storySeed: number;
  /** Native work ceiling. For timed runs this should be deliberately non-binding. */
  budget: number;
  /** Planned primary wall-time grant. Reaching it is a completed run, not a resource failure. */
  timeBudgetMs?: number;
  inkcheckCommand?: string;
  inkcheckOptions?: InkCheckOptions;
  resources?: ResourceLimits;
  onProgress?: (event: RunProgressEvent) => void;
}

export interface ExperimentConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  families: BugFamily[];
  algorithms: AlgorithmId[];
  fixtureSeeds: number[];
  searchSeeds: number[];
  budgets: number[];
  budgetMode?: "work" | "wall-time";
  workBudgetCeiling?: number;
  difficulty: number;
  storySeed: number;
  /** Deterministic serial execution policy. Marathon presets must use counterbalanced. */
  cellOrder?: "configured" | "counterbalanced";
  scheduleSeed?: number;
  fixturePartition?: "development" | "validation" | "evaluation";
  inkcheckCommand?: string;
  inkcheckOptions?: InkCheckOptions;
  resources?: ResourceLimits;
}

export interface ProbabilityCell {
  family: BenchmarkFamily;
  algorithm: AlgorithmId;
  budget: number;
  runs: number;
  completedRuns: number;
  resourceStoppedRuns: number;
  discoveries: number;
  /** Observed-anytime discovery probability over valid launched cells. */
  probability: number;
  interval95: { lower: number; upper: number };
  completedDiscoveries: number;
  completedProbability: number | null;
  medianTransitionsToDiscovery: number | null;
  medianElapsedMsToDiscovery: number | null;
  meanWallMs: number;
  meanCpuMs: number | null;
}

export interface SurvivalPoint {
  family: BenchmarkFamily;
  algorithm: AlgorithmId;
  budget: number;
  transition: number;
  atRisk: number;
  discoveries: number;
  censored: number;
  resourceStops: number;
  survival: number;
}

export interface SurvivalTimePoint {
  family: BenchmarkFamily;
  algorithm: AlgorithmId;
  budget: number;
  elapsedMs: number;
  atRisk: number;
  discoveries: number;
  censored: number;
  resourceStops: number;
  survival: number;
}

export interface ComplementarityCell {
  family: BugFamily;
  budget: number;
  algorithms: AlgorithmId[];
  runsCompared: number;
  fullyCompletedRuns: number;
  resourceAffectedRuns: number;
  discoveryPatternCounts: Record<string, number>;
  exclusiveDiscoveries: Record<string, number>;
  unionDiscoveries: number;
}

export interface ResourceCell {
  family: BenchmarkFamily;
  algorithm: AlgorithmId;
  budget: number;
  runs: number;
  completed: number;
  resourceStopped: number;
  memoryStopped: number;
  timeStopped: number;
  discoveriesBeforeStop: number;
  meanTransitions: number;
  meanWallMs: number;
  meanPeakHeapBytes: number | null;
  meanPeakRssBytes: number | null;
  meanPeakSnapshotBytes: number | null;
  meanPeakCheckpointBytes: number | null;
}

export interface ExperimentSummary {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  config: ExperimentConfig;
  totalRuns: number;
  successfulRuns: number;
  probability: ProbabilityCell[];
  survival: SurvivalPoint[];
  survivalTime: SurvivalTimePoint[];
  complementarity: ComplementarityCell[];
  resources: ResourceCell[];
}
