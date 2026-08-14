import { Compiler, CompilerOptions, Story } from "inkjs/full";
import { hash, stableJson, variableValueTokens } from "./hash.js";
import { parseInkJson } from "./ink-json.js";
import { ResourceGuards } from "./resource-guards.js";
import type {
  BenchmarkFixture,
  BugDiscovery,
  ChoiceObservation,
  CoverageCounts,
  CoverageDelta,
  CoverageItems,
  Observation,
  ResourceStopReason,
  ResourceUsage,
  RuntimeFinding,
  SnapshotMemoryUsage,
  TransitionResult,
} from "./types.js";

interface SnapshotRecord {
  snapshotId: string;
  stateJson: string;
  observation: Observation;
  bytes: number;
  references: number;
  permanent: boolean;
}

export interface ControllerOptions {
  guards?: ResourceGuards;
  onTransition?: (result: TransitionResult) => void;
  /** Adapter replay can disable global coverage indexes to avoid charging search-output verification as a search frontier. */
  trackCoverage?: boolean;
}

const ZERO_COVERAGE: CoverageCounts = {
  locations: 0,
  choiceConfigurations: 0,
  choices: 0,
  edges: 0,
  semanticStates: 0,
  rawStates: 0,
  variableValues: 0,
  variableTransitions: 0,
};

class CoverageTracker {
  private readonly locations = new Set<string>();
  private readonly configurations = new Set<string>();
  private readonly choices = new Set<string>();
  private readonly edges = new Set<string>();
  private readonly semanticStates = new Set<string>();
  private readonly rawStates = new Set<string>();
  private readonly variableValues = new Set<string>();
  private readonly variableTransitions = new Set<string>();

  observeRoot(observation: Observation): void {
    this.observeState(observation);
  }

  observeTransition(before: Observation, choice: ChoiceObservation, after: Observation): CoverageDelta {
    const prior = this.counts();
    this.observeState(after);
    this.edges.add(`${before.location}|${choice.id}|${after.location}`);
    const names = new Set([...Object.keys(before.variables), ...Object.keys(after.variables)]);
    for (const name of names) {
      const oldValue = stableJson(before.variables[name]);
      const newValue = stableJson(after.variables[name]);
      if (oldValue !== newValue) this.variableTransitions.add(`${name}:${oldValue}->${newValue}`);
    }
    const next = this.counts();
    const delta: CoverageDelta = {
      locations: next.locations - prior.locations,
      choiceConfigurations: next.choiceConfigurations - prior.choiceConfigurations,
      choices: next.choices - prior.choices,
      edges: next.edges - prior.edges,
      semanticStates: next.semanticStates - prior.semanticStates,
      rawStates: next.rawStates - prior.rawStates,
      variableValues: next.variableValues - prior.variableValues,
      variableTransitions: next.variableTransitions - prior.variableTransitions,
      total: 0,
    };
    delta.total = Object.entries(delta)
      .filter(([key]) => key !== "total")
      .reduce((sum, [, value]) => sum + value, 0);
    return delta;
  }

  counts(): CoverageCounts {
    return {
      locations: this.locations.size,
      choiceConfigurations: this.configurations.size,
      choices: this.choices.size,
      edges: this.edges.size,
      semanticStates: this.semanticStates.size,
      rawStates: this.rawStates.size,
      variableValues: this.variableValues.size,
      variableTransitions: this.variableTransitions.size,
    };
  }

  items(): CoverageItems {
    return {
      locations: [...this.locations].sort(),
      choices: [...this.choices].sort(),
      edges: [...this.edges].sort(),
      semanticStates: [...this.semanticStates].sort(),
    };
  }

  memoryBytes(): number {
    const sets = [
      this.locations,
      this.configurations,
      this.choices,
      this.edges,
      this.semanticStates,
      this.rawStates,
      this.variableValues,
      this.variableTransitions,
    ];
    return sets.reduce((total, values) => total + [...values].reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0), 0);
  }

  private observeState(observation: Observation): void {
    this.locations.add(observation.location);
    this.configurations.add(hash(observation.choices.map((choice) => choice.id)));
    for (const choice of observation.choices) this.choices.add(`${observation.location}|${choice.id}`);
    this.semanticStates.add(observation.semanticKey);
    this.rawStates.add(observation.rawStateKey);
    for (const token of variableValueTokens(observation.variables)) this.variableValues.add(token);
  }
}

function cleanInkValue(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("^")) return value.slice(1);
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

function extractVariables(story: Story): Record<string, unknown> {
  const state = story.variablesState as unknown as {
    _defaultGlobalVariables?: Map<string, unknown>;
    $(name: string): unknown;
  };
  const out: Record<string, unknown> = {};
  for (const name of state._defaultGlobalVariables?.keys() ?? []) {
    out[name] = cleanInkValue(state.$(name));
  }
  return out;
}

export function oracleNeutralRawStateKey(rawState: string, oracleVariables: Iterable<string>): string {
  const neutralRawState = parseInkJson(rawState) as { variablesState?: Record<string, unknown> };
  for (const variable of oracleVariables) delete neutralRawState.variablesState?.[variable];
  return hash(neutralRawState);
}

export function compiledFixtureStory(fixture: BenchmarkFixture): string {
  if (fixture.tier !== "generated-planted") return fixture.compiledStory;
  const errors: string[] = [];
  const warnings: string[] = [];
  const options = new CompilerOptions(null, [], true, (message: string, type: number) => {
    if (type === 2) errors.push(message);
    else warnings.push(message);
  });
  const compiler = new Compiler(fixture.source, options);
  const story = compiler.Compile();
  const json = story.ToJson();
  if (errors.length > 0) throw new Error(`Ink compilation failed:\n${errors.join("\n")}`);
  if (typeof json !== "string") throw new Error("Ink compiler returned no JSON story");
  return json;
}

export class InstrumentedController {
  readonly fixture: BenchmarkFixture;
  readonly budget: number;
  readonly storySeed: number;
  readonly storyJson: string;

  private readonly story: Story;
  private readonly snapshots = new Map<string, SnapshotRecord>();
  private readonly coverageTracker = new CoverageTracker();
  private readonly discoveries = new Map<string, BugDiscovery>();
  private readonly findings = new Map<string, RuntimeFinding>();
  private readonly oracleHits = new Map<string, string[]>();
  private readonly guards: ResourceGuards;
  private readonly oracleVariables: Set<string>;
  private readonly onTransition: ((result: TransitionResult) => void) | undefined;
  private readonly trackCoverage: boolean;
  private active: SnapshotRecord | null = null;
  private nextSnapshot = 0;
  private snapshotBytes = 0;
  private peakSnapshotBytes = 0;
  private checkpointBytes = 0;
  private peakCheckpointBytes = 0;
  private peakSnapshots = 0;
  private snapshotsCreated = 0;
  private snapshotsReleased = 0;
  private explicitReferences = 0;
  private peakCoverageBytes = 0;
  private nextGuardTransition = 0;
  private operationErrors: string[] = [];
  private operationWarnings: string[] = [];
  private readonly searchWallStart: number;
  private readonly searchCpuStart: NodeJS.CpuUsage;

  transitions = 0;
  launches = 0;
  rootLaunches = 0;
  episodesCompleted = 0;
  readonly rootSnapshotId: string;

  constructor(fixture: BenchmarkFixture, budget: number, storySeed: number, options: ControllerOptions = {}) {
    if (!Number.isSafeInteger(budget) || budget < 1) throw new RangeError("budget must be a positive integer");
    if (!Number.isSafeInteger(storySeed) || storySeed < 1) throw new RangeError("story seed must be a positive integer");
    this.fixture = fixture;
    this.budget = budget;
    this.storySeed = storySeed;
    this.guards = options.guards ?? new ResourceGuards();
    this.oracleVariables = new Set(fixture.manifest.bugs.map((bug) => bug.oracle.variable));
    this.onTransition = options.onTransition;
    this.trackCoverage = options.trackCoverage ?? true;
    this.storyJson = compiledFixtureStory(fixture);
    this.story = new Story(parseInkJson(this.storyJson));
    this.story.onError = (message: string, type: number) => {
      if (type === 2) this.operationErrors.push(message);
      else this.operationWarnings.push(message);
    };
    this.story.state.storySeed = storySeed;
    this.story.state.previousRandom = 0;
    this.searchWallStart = performance.now();
    this.searchCpuStart = process.cpuUsage();
    const root = this.advanceAndCapture([], [], undefined);
    this.rootSnapshotId = root.snapshotId;
    const rootRecord = this.snapshots.get(root.snapshotId)!;
    rootRecord.permanent = true;
    if (this.trackCoverage) {
      this.coverageTracker.observeRoot(root);
      this.observeCoverageMemory();
    }
    this.recordFindings(root, 0);
    this.checkResourceBoundary(true);
  }

  get remaining(): number {
    return this.budget - this.transitions;
  }

  get exhausted(): boolean {
    return this.remaining <= 0 || this.checkResourceBoundary(false) !== null;
  }

  get resourceStopReason(): ResourceStopReason | null {
    return this.guards.stopReason;
  }

  get coverage(): CoverageCounts {
    return this.coverageTracker.counts();
  }

  get coverageItems(): CoverageItems {
    return this.coverageTracker.items();
  }

  get bugDiscoveries(): BugDiscovery[] {
    return [...this.discoveries.values()].sort((left, right) => left.transition - right.transition || left.bugId.localeCompare(right.bugId));
  }

  get runtimeFindings(): RuntimeFinding[] {
    return [...this.findings.values()].sort((left, right) => left.transition - right.transition || left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value));
  }

  get snapshotMemory(): SnapshotMemoryUsage {
    return {
      created: this.snapshotsCreated,
      released: this.snapshotsReleased,
      current: this.snapshots.size,
      peak: this.peakSnapshots,
      explicitReferences: this.explicitReferences,
      currentBytes: this.snapshotBytes,
      peakBytes: this.peakSnapshotBytes,
      checkpointBytes: this.checkpointBytes,
      peakCheckpointBytes: this.peakCheckpointBytes,
    };
  }

  get coverageIndexBytes(): number {
    return this.coverageTracker.memoryBytes();
  }

  resourceUsage(stopReason: ResourceStopReason): ResourceUsage {
    const finalCoverageBytes = this.coverageIndexBytes;
    this.peakCoverageBytes = Math.max(this.peakCoverageBytes, finalCoverageBytes);
    return {
      provenance: "inkbench-worker",
      limits: {
        memoryCapBytes: this.guards.memoryCapBytes,
        searchMemoryLimitBytes: this.guards.memoryCapBytes,
        timeCapMs: this.guards.timeCapMs,
      },
      stopReason,
      process: {
        peak: this.guards.peak,
        final: this.guards.final,
      },
      snapshots: this.snapshotMemory,
      coverageIndexBytes: finalCoverageBytes,
      peakCoverageIndexBytes: this.peakCoverageBytes,
    };
  }

  retain(snapshotId: string): void {
    const record = this.snapshots.get(snapshotId);
    if (!record) throw new RangeError(`unknown snapshot: ${snapshotId}`);
    if (record.references === 0 && !record.permanent) {
      this.checkpointBytes += record.bytes;
      this.peakCheckpointBytes = Math.max(this.peakCheckpointBytes, this.checkpointBytes);
    }
    record.references += 1;
    this.explicitReferences += 1;
  }

  release(snapshotId: string): void {
    const record = this.snapshots.get(snapshotId);
    if (!record) throw new RangeError(`unknown snapshot: ${snapshotId}`);
    if (record.references < 1) throw new RangeError(`snapshot is not explicitly retained: ${snapshotId}`);
    record.references -= 1;
    this.explicitReferences -= 1;
    if (record.references === 0 && !record.permanent) this.checkpointBytes -= record.bytes;
    this.releaseIfUnused(record);
  }

  launch(snapshotId = this.rootSnapshotId): Observation {
    const record = this.snapshots.get(snapshotId);
    if (!record) throw new RangeError(`unknown snapshot: ${snapshotId}`);
    this.story.state.LoadJsonObj(parseInkJson(record.stateJson));
    this.story.state.onDidLoadState?.();
    this.story.ResetErrors();
    this.setActive(record);
    this.launches += 1;
    if (snapshotId === this.rootSnapshotId) this.rootLaunches += 1;
    return record.observation;
  }

  step(choiceIndex: number): TransitionResult {
    if (this.exhausted) throw new RangeError("transition budget exhausted");
    if (!this.active) throw new Error("launch a snapshot before taking a choice");
    const before = this.active.observation;
    const choice = before.choices[choiceIndex];
    if (!choice) throw new RangeError(`choice ${choiceIndex} is unavailable at ${before.location}`);
    this.operationErrors = [];
    this.operationWarnings = [];
    this.story.ResetErrors();
    try {
      this.story.ChooseChoiceIndex(choiceIndex);
    } catch (error) {
      this.operationErrors.push(error instanceof Error ? error.message : String(error));
    }
    this.transitions += 1;
    const after = this.advanceAndCapture(
      [...before.choicePath, choiceIndex],
      [...before.choiceTextPath, choice.text],
      choice.targetPath,
    );
    this.setActive(this.snapshots.get(after.snapshotId)!);
    const coverageDelta = this.trackCoverage
      ? this.coverageTracker.observeTransition(before, choice, after)
      : { ...ZERO_COVERAGE, total: 0 };
    if (this.trackCoverage) this.observeCoverageMemory();
    this.recordFindings(after, this.transitions);
    for (const bugId of this.oracleHits.get(after.snapshotId) ?? []) {
      if (this.discoveries.has(bugId)) continue;
      const elapsedMs = performance.now() - this.searchWallStart;
      const cpu = process.cpuUsage(this.searchCpuStart);
      const discovery: BugDiscovery = {
        bugId,
        transition: this.transitions,
        elapsedMs,
        cpuMs: (cpu.user + cpu.system) / 1_000,
        choicePath: [...after.choicePath],
        choiceTextPath: [...after.choiceTextPath],
        location: after.location,
      };
      this.discoveries.set(bugId, discovery);
    }
    if (after.terminal) this.episodesCompleted += 1;
    const result = { before, choice, after, coverageDelta, transition: this.transitions };
    this.checkResourceBoundary(false);
    this.onTransition?.(result);
    return result;
  }

  private setActive(record: SnapshotRecord): void {
    const previous = this.active;
    this.active = record;
    if (previous && previous.snapshotId !== record.snapshotId) this.releaseIfUnused(previous);
  }

  private releaseIfUnused(record: SnapshotRecord): void {
    if (record.permanent || record.references > 0 || this.active?.snapshotId === record.snapshotId) return;
    if (!this.snapshots.delete(record.snapshotId)) return;
    this.oracleHits.delete(record.snapshotId);
    this.snapshotBytes -= record.bytes;
    this.snapshotsReleased += 1;
  }

  private observeCoverageMemory(): void {
    this.peakCoverageBytes = Math.max(this.peakCoverageBytes, this.coverageTracker.memoryBytes());
  }

  private checkResourceBoundary(force: boolean): ResourceStopReason | null {
    if (this.guards.stopReason) return this.guards.stopReason;
    if (!force && this.transitions < this.nextGuardTransition) return null;
    this.nextGuardTransition = this.transitions + 64;
    return this.guards.check();
  }

  private recordFindings(observation: Observation, transition: number): void {
    for (const event of observation.events) {
      if (event.kind !== "runtime-error" && event.kind !== "runtime-warning") continue;
      const key = hash({ kind: event.kind, value: event.value });
      if (this.findings.has(key)) continue;
      this.findings.set(key, {
        kind: event.kind,
        value: event.value,
        transition,
        choicePath: [...observation.choicePath],
        choiceTextPath: [...observation.choiceTextPath],
        location: observation.location,
      });
    }
  }

  private advanceAndCapture(choicePath: number[], choiceTextPath: string[], fallbackPath: string | undefined): Observation {
    const text: string[] = [];
    const tags: string[] = [];
    try {
      while (this.story.canContinue) {
        text.push(this.story.Continue() ?? "");
        for (const tag of this.story.currentTags ?? []) tags.push(tag);
      }
    } catch (error) {
      this.operationErrors.push(error instanceof Error ? error.message : String(error));
    }
    const allVariables = extractVariables(this.story);
    const variables = Object.fromEntries(Object.entries(allVariables).filter(([name]) => !this.oracleVariables.has(name)));
    const visitCounts = Object.fromEntries(this.fixture.manifest.locations.map((location) => {
      try {
        return [location, this.story.state.VisitCountAtPathString(location) ?? 0];
      } catch {
        return [location, 0];
      }
    }));
    const rawChoices = this.story.currentChoices as Array<{
      text: string;
      sourcePath: string;
      pathStringOnChoice: string;
    }>;
    const candidatePaths = [
      this.story.state.currentPathString,
      ...rawChoices.flatMap((choice) => [choice.sourcePath, choice.pathStringOnChoice]),
      fallbackPath,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    const isTerminalState = !this.story.canContinue && rawChoices.length === 0;
    const terminalLocation = isTerminalState
      ? Object.entries(visitCounts).filter(([, count]) => count > 0).at(-1)?.[0]
      : undefined;
    const location = terminalLocation ?? this.findLocation(candidatePaths, visitCounts, fallbackPath);
    const choices: ChoiceObservation[] = rawChoices.map((choice, index) => {
      const sourcePath = choice.sourcePath || `${location}.${index}`;
      const targetPath = choice.pathStringOnChoice || "";
      return {
        index,
        text: choice.text,
        sourcePath,
        targetPath,
        id: hash({ sourcePath, index, text: choice.text }),
      };
    });
    const terminal = isTerminalState;
    const oracleHits: string[] = [];
    for (const bug of this.fixture.manifest.bugs) {
      if (bug.oracle.kind === "variable-equals" && allVariables[bug.oracle.variable] === bug.oracle.value) {
        oracleHits.push(bug.id);
      }
    }
    const events: Observation["events"] = [];
    for (const error of this.operationErrors) events.push({ kind: "runtime-error", value: error });
    for (const warning of this.operationWarnings) events.push({ kind: "runtime-warning", value: warning });
    if (terminal) events.push({ kind: "terminal", value: location });
    const rawState = this.story.state.ToJson();
    const rawStateKey = oracleNeutralRawStateKey(rawState, this.oracleVariables);
    const semanticKey = hash({
      location,
      choices: choices.map((choice) => choice.id),
      variables,
      visitCounts,
      terminal,
      errors: this.operationErrors,
    });
    const snapshotId = `snapshot-${this.nextSnapshot++}`;
    const observation: Observation = {
      snapshotId,
      location,
      text: text.join(""),
      tags,
      choices,
      variables,
      visitCounts,
      depth: choicePath.length,
      choicePath,
      choiceTextPath,
      terminal,
      errors: [...this.operationErrors],
      warnings: [...this.operationWarnings],
      events,
      semanticKey,
      rawStateKey,
    };
    const bytes = Buffer.byteLength(rawState, "utf8") + Buffer.byteLength(JSON.stringify(observation), "utf8");
    this.snapshots.set(snapshotId, {
      snapshotId,
      stateJson: rawState,
      observation,
      bytes,
      references: 0,
      permanent: false,
    });
    this.oracleHits.set(snapshotId, oracleHits);
    this.snapshotBytes += bytes;
    this.peakSnapshotBytes = Math.max(this.peakSnapshotBytes, this.snapshotBytes);
    this.peakSnapshots = Math.max(this.peakSnapshots, this.snapshots.size);
    this.snapshotsCreated += 1;
    return observation;
  }

  private findLocation(paths: string[], visitCounts: Record<string, number>, fallbackPath: string | undefined): string {
    const sorted = [...this.fixture.manifest.locations].sort((left, right) => right.length - left.length);
    for (const path of paths) {
      const match = sorted.find((location) => path === location || path.startsWith(`${location}.`));
      if (match) return match;
    }
    if (fallbackPath) {
      const match = sorted.find((location) => fallbackPath === location || fallbackPath.startsWith(`${location}.`));
      if (match) return match;
    }
    const visited = Object.entries(visitCounts).filter(([, count]) => count > 0);
    return visited.at(-1)?.[0] ?? "<root>";
  }
}

export function emptyCoverage(): CoverageCounts {
  return { ...ZERO_COVERAGE };
}
