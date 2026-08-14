import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Story } from "inkjs/full";
import { fixtureSourceHash } from "../core/hash.js";
import { benchmarkRunId, executionFingerprint, resolveCommandPath } from "../core/identity.js";
import { parseInkJson } from "../core/ink-json.js";
import { compiledFixtureStory } from "../core/runtime.js";
import { INKBENCH_VERSION, RUN_CONTRACT_VERSION, RUN_REPORT_SCHEMA_VERSION, type BugDiscovery, type ResourceStopReason, type ResourceUsage, type RunReport, type RunRequest } from "../core/types.js";

interface InkCheckEnding {
  choiceIndices?: number[];
  path?: string[];
  firstDiscoveredAtState?: number;
  elapsedMs?: number;
  variables?: Record<string, unknown>;
}

interface InkCheckReport {
  inkcheckVersion?: string;
  elapsedMs?: number;
  effectiveConfiguration?: { concurrency?: number; concurrencyMode?: string };
  compile?: { success?: boolean };
  resources?: { peakMemoryBytes?: number; memoryCapBytes?: number; memorySearchLimitBytes?: number };
  explore?: {
    statesExplored?: number;
    endingsFound?: InkCheckEnding[];
    limits?: { maxStates?: number };
    exhaustive?: boolean;
    execution?: { mode?: string; effectiveConcurrency?: number; requestedConcurrency?: number };
    truncatedBy?: {
      maxStates?: boolean;
      memory?: boolean;
      time?: boolean;
    };
  };
}

interface InkCheckStreamEvent {
  schemaVersion?: number;
  type?: "run_start" | "ending" | "runtime_error" | "benchmark_signal" | "run_end";
  inkcheckVersion?: string;
  signal?: number;
  elapsedMs?: number;
  firstDiscoveredAtState?: number;
  choiceIndices?: number[];
  effectiveConfiguration?: InkCheckReport["effectiveConfiguration"];
  compile?: InkCheckReport["compile"];
  resources?: InkCheckReport["resources"];
  explore?: Omit<NonNullable<InkCheckReport["explore"]>, "endingsFound"> & {
    endingsFound?: number;
    runtimeErrors?: number;
  };
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove private oracle state. Signal mode is reserved for disclosed authored-mutation transport. */
export function oracleNeutralInkSource(source: string, request: RunRequest, declareSignalMode = true, emitSignals = true): string {
  const variables = request.fixture.manifest.bugs.map((bug) => escaped(bug.oracle.variable));
  if (variables.length === 0) return source;
  const names = variables.join("|");
  const declaration = new RegExp(`^\\s*VAR\\s+(?:${names})\\b`);
  const assignment = new RegExp(`^(\\s*)~\\s*(${names})\\s*=\\s*(.*?)\\s*$`);
  const markerTag = /^\s*#\s*INKBENCH_BUG:/;
  const signalByVariable = new Map(request.fixture.manifest.bugs.map((bug, index) => [bug.oracle.variable, { index, value: bug.oracle.value }]));
  const neutral = source.split("\n").map((line) => {
    if (declaration.test(line) || markerTag.test(line)) return "";
    const assigned = assignment.exec(line);
    if (!assigned) return line;
    const signal = signalByVariable.get(assigned[2]!);
    const rhs = assigned[3]!.replace(/\/\/.*$/, "").trim();
    const expected = signal?.value === true ? "true" : signal?.value === false ? "false" : String(signal?.value);
    return signal && rhs.toLowerCase() === expected.toLowerCase() && emitSignals
      ? `${assigned[1]}# INKBENCH_SIGNAL:${signal.index}`
      : "";
  }).join("\n");
  return declareSignalMode && emitSignals ? `# INKBENCH_SIGNAL_MODE\n${neutral}` : neutral;
}

interface ReplayResult {
  discoveries: BugDiscovery[];
  paths: number;
  transitions: number;
  divergences: number;
}

class OrderedEndingReplayer {
  private readonly story: Story;
  private readonly states: string[];
  private previousPath: number[] = [];
  private previousTextPath: string[] = [];
  private readonly discoveries = new Map<string, BugDiscovery>();
  paths = 0;
  transitions = 0;
  divergences = 0;

  constructor(private readonly request: RunRequest) {
    this.story = new Story(parseInkJson(compiledFixtureStory(request.fixture)));
    this.story.state.storySeed = request.storySeed;
    this.story.state.previousRandom = 0;
    while (this.story.canContinue) this.story.Continue();
    this.states = [this.story.state.ToJson()];
  }

  replay(ending: InkCheckEnding): void {
    const path = ending.choiceIndices;
    if (!Array.isArray(path)) return;
    this.paths += 1;
    if (this.discoveries.size === this.request.fixture.manifest.bugs.length) return;
    let common = 0;
    while (common < path.length && common < this.previousPath.length && path[common] === this.previousPath[common]) common += 1;
    this.story.state.LoadJsonObj(parseInkJson(this.states[common]!));
    this.story.state.onDidLoadState?.();
    this.story.ResetErrors();
    this.states.length = common + 1;
    const choiceTextPath = this.previousTextPath.slice(0, common);
    let traversed = common;
    for (let depth = common; depth < path.length; depth += 1) {
      const choiceIndex = path[depth]!;
      const choice = this.story.currentChoices[choiceIndex];
      const expectedText = ending.path?.[depth];
      if (!Number.isSafeInteger(choiceIndex) || choiceIndex < 0 || !choice || (expectedText !== undefined && choice.text !== expectedText)) {
        this.divergences += 1;
        break;
      }
      choiceTextPath.push(choice.text);
      this.story.ChooseChoiceIndex(choiceIndex);
      while (this.story.canContinue) this.story.Continue();
      this.transitions += 1;
      traversed = depth + 1;
      this.states.push(this.story.state.ToJson());
      for (const bug of this.request.fixture.manifest.bugs) {
        if (this.discoveries.has(bug.id)) continue;
        const value = (this.story.variablesState as unknown as { $(name: string): unknown }).$(bug.oracle.variable);
        if (value !== bug.oracle.value) continue;
        this.discoveries.set(bug.id, {
          bugId: bug.id,
          transition: ending.firstDiscoveredAtState ?? 0,
          elapsedMs: ending.elapsedMs ?? 0,
          cpuMs: null,
          choicePath: path.slice(0, depth + 1),
          choiceTextPath: [...choiceTextPath],
          location: this.story.state.currentPathString ?? "replay",
        });
      }
    }
    this.previousPath = path.slice(0, traversed);
    this.previousTextPath = choiceTextPath.slice(0, traversed);
  }

  result(): ReplayResult {
    return { discoveries: [...this.discoveries.values()], paths: this.paths, transitions: this.transitions, divergences: this.divergences };
  }
}

function *readLines(path: string): Generator<string> {
  const descriptor = openSync(path, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let pending = "";
  try {
    while (true) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      pending += decoder.write(buffer.subarray(0, bytes));
      while (true) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        yield pending.slice(0, newline);
        pending = pending.slice(newline + 1);
      }
    }
    pending += decoder.end();
    if (pending.length > 0) yield pending;
  } finally {
    closeSync(descriptor);
  }
}

function parseInkCheckReport(path: string, request: RunRequest): {
  parsed: InkCheckReport;
  replay: ReplayResult;
  transport: "bounded-stream" | "full-json";
} {
  const replayer = new OrderedEndingReplayer(request);
  const lines = readLines(path);
  const first = lines.next();
  if (first.done) throw new SyntaxError("InkCheck report was empty");
  let firstEvent: InkCheckStreamEvent | undefined;
  try {
    firstEvent = JSON.parse(first.value) as InkCheckStreamEvent;
  } catch {
    firstEvent = undefined;
  }
  if (firstEvent?.type === "run_start") {
    let terminal: InkCheckStreamEvent | undefined;
    const consume = (event: InkCheckStreamEvent) => {
      if (event.schemaVersion !== 1) throw new SyntaxError(`unsupported InkCheck stream schema ${event.schemaVersion ?? "missing"}`);
      if (event.type === "ending") {
        replayer.replay({
          ...(event.choiceIndices === undefined ? {} : { choiceIndices: event.choiceIndices }),
          ...(event.firstDiscoveredAtState === undefined ? {} : { firstDiscoveredAtState: event.firstDiscoveredAtState }),
          ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
        });
      } else if (event.type === "benchmark_signal") {
        if (!Number.isSafeInteger(event.signal) || event.signal! < 0 || event.signal! >= request.fixture.manifest.bugs.length) {
          throw new SyntaxError(`invalid InkBench signal ${String(event.signal)}`);
        }
        replayer.replay({
          ...(event.choiceIndices === undefined ? {} : { choiceIndices: event.choiceIndices }),
          ...(event.firstDiscoveredAtState === undefined ? {} : { firstDiscoveredAtState: event.firstDiscoveredAtState }),
          ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
        });
      } else if (event.type === "run_end") {
        terminal = event;
      }
    };
    consume(firstEvent);
    for (const line of lines) {
      if (!line.trim()) continue;
      consume(JSON.parse(line) as InkCheckStreamEvent);
    }
    if (!terminal) throw new SyntaxError("InkCheck evidence stream ended without run_end");
    const final = terminal as InkCheckStreamEvent;
    const explore = final.explore;
    const parsed: InkCheckReport = {};
    const inkcheckVersion = final.inkcheckVersion ?? firstEvent.inkcheckVersion;
    const effectiveConfiguration = final.effectiveConfiguration ?? firstEvent.effectiveConfiguration;
    if (inkcheckVersion !== undefined) parsed.inkcheckVersion = inkcheckVersion;
    if (effectiveConfiguration !== undefined) parsed.effectiveConfiguration = effectiveConfiguration;
    if (final.compile !== undefined) parsed.compile = final.compile;
    if (final.elapsedMs !== undefined) parsed.elapsedMs = final.elapsedMs;
    if (final.resources !== undefined) parsed.resources = final.resources;
    if (explore) {
      parsed.explore = {
        ...(explore.statesExplored === undefined ? {} : { statesExplored: explore.statesExplored }),
        endingsFound: [],
        ...(explore.limits === undefined ? {} : { limits: explore.limits }),
        ...(explore.exhaustive === undefined ? {} : { exhaustive: explore.exhaustive }),
        ...(explore.execution === undefined ? {} : { execution: explore.execution }),
        ...(explore.truncatedBy === undefined ? {} : { truncatedBy: explore.truncatedBy }),
      };
    }
    return {
      parsed,
      replay: replayer.result(),
      transport: "bounded-stream",
    };
  }
  const sanitized: string[] = [];
  let inEndings = false;
  let endingLines: string[] | null = null;
  let streamed = false;
  const legacyLines = (function *(): Generator<string> {
    yield first.value;
    yield *lines;
  })();
  for (const line of legacyLines) {
    if (!inEndings && /^    "endingsFound": \[$/.test(line)) {
      sanitized.push('    "endingsFound": [],');
      inEndings = true;
      streamed = true;
      continue;
    }
    if (inEndings) {
      if (endingLines === null && /^    \],?$/.test(line)) {
        inEndings = false;
        continue;
      }
      if (endingLines === null && /^      \{$/.test(line)) endingLines = [line];
      else if (endingLines !== null) endingLines.push(line);
      if (endingLines !== null && /^      \},?$/.test(line)) {
        const serialized = endingLines.join("\n").replace(/,\s*$/, "");
        replayer.replay(JSON.parse(serialized) as InkCheckEnding);
        endingLines = null;
      }
      continue;
    }
    sanitized.push(line);
  }
  if (inEndings || endingLines !== null) throw new SyntaxError("InkCheck report ended inside endingsFound");
  if (streamed) return { parsed: JSON.parse(sanitized.join("\n")) as InkCheckReport, replay: replayer.result(), transport: "full-json" };
  const bytes = statSync(path).size;
  if (bytes > 16 * 1024 * 1024) throw new RangeError("InkCheck emitted an unrecognized large JSON report layout");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as InkCheckReport;
  for (const ending of parsed.explore?.endingsFound ?? []) replayer.replay(ending);
  return { parsed, replay: replayer.result(), transport: "full-json" };
}

function scratchPath(root: string, requested: string): string {
  const target = resolve(root, requested);
  const fromRoot = relative(root, target);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`unsafe fixture source path: ${requested}`);
  }
  return target;
}

function failedAdapterRun(
  request: RunRequest,
  runId: string,
  wallMs: number,
  message: string,
  status: "adapter-unavailable" | "runtime-error",
): RunReport {
  const fingerprint = executionFingerprint(request);
  const primaryBudget = request.timeBudgetMs === undefined
    ? { unit: "inkcheck-states" as const, limit: request.budget }
    : { unit: "wall-ms" as const, limit: request.timeBudgetMs };
  return {
    schemaVersion: RUN_REPORT_SCHEMA_VERSION,
    runId,
    fixtureId: request.fixture.manifest.fixtureId,
    fixtureGeneratorVersion: request.fixture.manifest.generatorVersion,
    fixtureSourceSha256: fixtureSourceHash(request.fixture),
    benchmarkTier: request.fixture.tier,
    family: request.fixture.manifest.family,
    algorithm: "inkcheck",
    algorithmVersion: status === "adapter-unavailable" ? "unavailable" : "unknown",
    executionFingerprint: fingerprint,
    observability: {
      informationRegime: "full-source",
      instrumentationRegime: request.fixture.tier === "authored-planted" ? "external-private-signal" : "external-native",
      commonCoverageCharged: false,
    },
    fixtureSeed: request.fixture.manifest.seed,
    searchSeed: request.searchSeed,
    storySeed: request.storySeed,
    difficulty: request.fixture.manifest.difficulty,
    dimensions: request.fixture.manifest.dimensions,
    budget: primaryBudget,
    workBudget: { unit: "inkcheck-states", limit: request.budget },
    counts: { transitions: 0, launches: 0, rootLaunches: 0, episodesCompleted: 0 },
    coverage: null,
    coverageItems: null,
    discoveredBugs: [],
    runtimeFindings: [],
    plantedBugIds: request.fixture.manifest.bugs.map((bug) => bug.id),
    discoveryTimingBasis: "final-only",
    timing: {
      wallMs,
      cpuMs: null,
      discoveryTimeOrigin: "final-report",
      phases: { setupMs: null, searchMs: null, scoringMs: null, finalizationMs: null },
    },
    parallelism: { requested: request.inkcheckOptions === undefined ? 1 : request.inkcheckOptions.concurrency ?? "auto", effective: null, mode: status === "adapter-unavailable" ? "unavailable" : "external-process-failed" },
    stopReason: "error",
    resources: null,
    runtime: { harnessVersion: INKBENCH_VERSION, runContractVersion: RUN_CONTRACT_VERSION, engine: "inkcheck", engineVersion: status === "adapter-unavailable" ? "unavailable" : "unknown", node: process.version, platform: `${process.platform}-${process.arch}` },
    status,
    error: message,
    notes: status === "adapter-unavailable"
      ? ["Install InkCheck or pass --inkcheck-command. Missing adapter metrics are null, not zero."]
      : ["InkCheck started but did not produce a parseable final report. This is explicit external-process failure evidence, not a zero-discovery result."],
  };
}

function inkcheckResourceUsage(parsed: InkCheckReport, request: RunRequest, stopReason: ResourceStopReason): ResourceUsage | null {
  const peakHeap = parsed.resources?.peakMemoryBytes ?? null;
  const configuredCap = request.resources?.maxMemoryMb === undefined ? null : request.resources.maxMemoryMb * 1024 * 1024;
  const memoryCapBytes = parsed.resources?.memoryCapBytes ?? configuredCap;
  const searchMemoryLimitBytes = parsed.resources?.memorySearchLimitBytes ?? memoryCapBytes;
  if (peakHeap === null && memoryCapBytes === null && searchMemoryLimitBytes === null) return null;
  return {
    provenance: "external-adapter",
    limits: {
      memoryCapBytes,
      searchMemoryLimitBytes,
      timeCapMs: request.timeBudgetMs ?? request.resources?.maxTimeMs ?? null,
    },
    stopReason,
    process: {
      peak: peakHeap === null ? null : {
        heapUsedBytes: peakHeap,
        rssBytes: null,
        externalBytes: null,
        arrayBuffersBytes: null,
      },
      final: null,
    },
    snapshots: null,
    coverageIndexBytes: null,
    peakCoverageIndexBytes: null,
  };
}

function childNodeOptions(memoryCapMb: number | undefined): { env?: NodeJS.ProcessEnv; heapLimitMb?: number } {
  if (memoryCapMb === undefined) return {};
  // Match the isolated InkBench worker envelope: the cooperative watermark is
  // 80% of V8 old space, leaving room to serialize a final partial report.
  const heapLimitMb = Math.ceil(memoryCapMb / 0.8);
  const inherited = process.env.NODE_OPTIONS ?? "";
  const withoutOldSpace = inherited
    .replace(/(?:^|\s)--max-old-space-size(?:=\S+|\s+\S+)/g, " ")
    .trim();
  return {
    heapLimitMb,
    env: {
      ...process.env,
      NODE_OPTIONS: [withoutOldSpace, `--max-old-space-size=${heapLimitMb}`].filter(Boolean).join(" "),
    },
  };
}

export function runInkCheckAdapter(request: RunRequest): RunReport {
  const fingerprint = executionFingerprint(request);
  const runId = benchmarkRunId(request, fingerprint);
  const started = performance.now();
  const scratch = mkdtempSync(join(tmpdir(), "inkbench-inkcheck-"));
  try {
    const entrypoint = request.fixture.tier !== "generated-planted"
      ? request.fixture.sourceBundle.entrypoint
      : "story.ink";
    if (request.fixture.tier !== "generated-planted") {
      for (const [relativePath, contents] of Object.entries(request.fixture.sourceBundle.files)) {
        const target = scratchPath(scratch, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, oracleNeutralInkSource(contents, request, relativePath === entrypoint), "utf8");
      }
    }
    const storyPath = scratchPath(scratch, entrypoint);
    if (request.fixture.tier === "generated-planted") writeFileSync(storyPath, oracleNeutralInkSource(request.fixture.source, request, false, false), "utf8");
    const configured = request.inkcheckCommand ?? "inkcheck";
    const resolvedCommand = resolveCommandPath(configured);
    const adapterDefaults = request.inkcheckOptions === undefined;
    const inkcheckOptions = request.inkcheckOptions ?? { minRepro: false, maxDepth: 1_000, concurrency: 1 };
    if (inkcheckOptions.maxDepth !== undefined && (!Number.isSafeInteger(inkcheckOptions.maxDepth) || inkcheckOptions.maxDepth < 1 || inkcheckOptions.maxDepth > 1_000)) {
      throw new RangeError("InkCheck maxDepth must be an integer from 1 to 1,000");
    }
    if (inkcheckOptions.concurrency !== undefined && inkcheckOptions.concurrency !== "auto"
      && (!Number.isSafeInteger(inkcheckOptions.concurrency) || inkcheckOptions.concurrency < 1 || inkcheckOptions.concurrency > 16)) {
      throw new RangeError("InkCheck concurrency must be auto or an integer from 1 to 16");
    }
    const effectiveTimeMs = request.timeBudgetMs ?? request.resources?.maxTimeMs;
    const effectiveTimeSeconds = effectiveTimeMs === undefined
      ? undefined
      : Math.max(1, request.timeBudgetMs === undefined ? Math.floor(effectiveTimeMs / 1_000) : Math.ceil(effectiveTimeMs / 1_000));
    const primaryBudget = request.timeBudgetMs === undefined
      ? { unit: "inkcheck-states" as const, limit: request.budget }
      : { unit: "wall-ms" as const, limit: request.timeBudgetMs };
    const isJavaScript = (resolvedCommand ?? configured).endsWith(".js");
    const executable = isJavaScript ? process.execPath : resolvedCommand ?? configured;
    const args = [
      ...(isJavaScript ? [resolvedCommand ?? configured] : []),
      storyPath,
      "--json-stream",
      "--max-states",
      String(request.budget),
      ...(inkcheckOptions.maxDepth === undefined ? [] : ["--max-depth", String(inkcheckOptions.maxDepth)]),
      "--seed",
      String(request.searchSeed),
      "--story-seed",
      String(request.storySeed),
      "--progress=off",
      ...(inkcheckOptions.search === undefined ? [] : ["--search", inkcheckOptions.search]),
      ...(inkcheckOptions.minRepro === false ? ["--no-min-repro"] : []),
      ...(inkcheckOptions.auto ? ["--auto"] : []),
      ...(inkcheckOptions.concurrency === undefined ? [] : ["--concurrency", String(inkcheckOptions.concurrency)]),
      ...(request.resources?.maxMemoryMb === undefined
        ? []
        : ["--max-memory", String(request.resources.maxMemoryMb)]),
      ...(effectiveTimeSeconds === undefined
        ? []
        : ["--max-time", String(effectiveTimeSeconds)]),
    ];
    const stdoutPath = join(scratch, "inkcheck-evidence.ndjson");
    const stderrPath = join(scratch, "inkcheck-stderr.txt");
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    const childRuntime = childNodeOptions(request.resources?.maxMemoryMb);
    let child: ReturnType<typeof spawnSync>;
    try {
      child = spawnSync(executable, args, {
        stdio: ["ignore", stdoutFd, stderrFd],
        ...(childRuntime.env ? { env: childRuntime.env } : {}),
        ...(effectiveTimeMs === undefined ? {} : { timeout: effectiveTimeMs + 5_000, killSignal: "SIGKILL" as const }),
      });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
    const stderr = readFileSync(stderrPath, "utf8");
    const reportBytes = statSync(stdoutPath).size;
    const childWallMs = performance.now() - started;
    if (child.error && (child.error as NodeJS.ErrnoException).code === "ENOENT") {
      return failedAdapterRun(request, runId, childWallMs, child.error.message, "adapter-unavailable");
    }
    let parsed: InkCheckReport;
    let replay: ReplayResult;
    let transport: "bounded-stream" | "full-json";
    const scoringStarted = performance.now();
    try {
      ({ parsed, replay, transport } = parseInkCheckReport(stdoutPath, request));
    } catch (error) {
      const parseError = error instanceof Error ? error.message : String(error);
      const detail = child.error?.message || stderr.trim() || parseError || `exit status ${child.status ?? "unknown"}`;
      return failedAdapterRun(request, runId, childWallMs, `InkCheck returned no complete evidence report: ${detail.slice(0, 1_000)}`, "runtime-error");
    }
    const scoringEnded = performance.now();
    const truncated = parsed.explore?.truncatedBy;
    const stopReason: ResourceStopReason = truncated?.memory
      ? "memory"
      : truncated?.time
        ? "time"
        : truncated?.maxStates || (parsed.explore?.statesExplored ?? 0) >= request.budget
          ? request.timeBudgetMs === undefined ? "budget" : "work-ceiling"
          : "search-exhausted";
    const resourceStopped = stopReason === "memory" || stopReason === "work-ceiling" || (stopReason === "time" && request.timeBudgetMs === undefined);
    const compileFailed = parsed.compile?.success === false || parsed.explore === undefined;
    const processFailed = child.status !== 0 && child.status !== 1;
    const wallMs = performance.now() - started;
    const discoveries: BugDiscovery[] = replay.discoveries.map((discovery) => transport === "bounded-stream"
      ? { ...discovery, cpuMs: null }
      : {
          ...discovery,
          transition: parsed.explore?.statesExplored ?? request.budget,
          elapsedMs: wallMs,
          cpuMs: null,
        });
    const cliSha256 = fingerprint.externalCommandSha256 ?? undefined;
    const engineVersion = `${parsed.inkcheckVersion ?? "unknown"}${cliSha256 ? `+cli.${cliSha256.slice(0, 12)}` : ""}`;
    return {
      schemaVersion: RUN_REPORT_SCHEMA_VERSION,
      runId,
      fixtureId: request.fixture.manifest.fixtureId,
      fixtureGeneratorVersion: request.fixture.manifest.generatorVersion,
      fixtureSourceSha256: fixtureSourceHash(request.fixture),
      benchmarkTier: request.fixture.tier,
      family: request.fixture.manifest.family,
      algorithm: "inkcheck",
      algorithmVersion: engineVersion,
      executionFingerprint: fingerprint,
      observability: {
        informationRegime: "full-source",
        instrumentationRegime: request.fixture.tier === "authored-planted" ? "external-private-signal" : "external-native",
        commonCoverageCharged: false,
      },
      fixtureSeed: request.fixture.manifest.seed,
      searchSeed: request.searchSeed,
      storySeed: request.storySeed,
      difficulty: request.fixture.manifest.difficulty,
      dimensions: request.fixture.manifest.dimensions,
      budget: primaryBudget,
      workBudget: { unit: "inkcheck-states", limit: request.budget },
      counts: {
        transitions: parsed.explore?.statesExplored ?? 0,
        launches: 0,
        rootLaunches: 0,
        episodesCompleted: replay.paths,
      },
      coverage: null,
      coverageItems: null,
      discoveredBugs: discoveries,
      runtimeFindings: [],
      plantedBugIds: request.fixture.manifest.bugs.map((bug) => bug.id),
      discoveryTimingBasis: transport === "bounded-stream" ? "global-wall" : "final-only",
      timing: {
        wallMs,
        cpuMs: null,
        discoveryTimeOrigin: transport === "bounded-stream" ? "tool-global" : "final-report",
        phases: {
          setupMs: null,
          searchMs: parsed.elapsedMs ?? null,
          scoringMs: scoringEnded - scoringStarted,
          finalizationMs: null,
        },
      },
      parallelism: {
        requested: inkcheckOptions.concurrency ?? "auto",
        effective: parsed.explore?.execution?.effectiveConcurrency ?? parsed.effectiveConfiguration?.concurrency ?? null,
        mode: parsed.explore?.execution?.mode ?? parsed.effectiveConfiguration?.concurrencyMode ?? "unknown",
      },
      stopReason: compileFailed || processFailed ? "error" : stopReason,
      resources: inkcheckResourceUsage(parsed, request, stopReason),
      runtime: {
        harnessVersion: INKBENCH_VERSION,
        runContractVersion: RUN_CONTRACT_VERSION,
        engine: "inkcheck",
        engineVersion,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      },
      status: compileFailed ? "compile-error" : processFailed ? "runtime-error" : resourceStopped ? "resource-stopped" : "completed",
      error: compileFailed || processFailed ? stderr.trim().slice(0, 1_000) || "InkCheck did not produce exploration evidence" : null,
      notes: [
        `Invoked real InkCheck CLI via ${basename(configured)} with its native state budget.`,
        "Streamed InkCheck stdout/stderr to scratch files before parsing so large evidence does not hit a child-process capture buffer.",
        `InkCheck ${transport === "bounded-stream" ? "bounded NDJSON evidence stream" : "legacy full JSON report"} size was ${reportBytes} bytes.`,
        `Stream-parsed ${replay.paths} replay witnesses and replayed ${replay.transitions} unique ordered-prefix transitions (${replay.divergences} path divergences).`,
        ...(cliSha256 ? [`Pinned InkCheck CLI artifact SHA-256 ${cliSha256}.`] : []),
        ...(request.fixture.tier === "generated-planted"
          ? ["Removed planted-oracle variables, assignments, marker tags, fixture identity, and semantic target labels from InkCheck's source; scored neutral ending paths by replay against the pinned private artifact."]
          : ["Removed planted-oracle variables and assignments from InkCheck's search state; scored private signal paths by replay against the pinned instrumented artifact."]),
        ...(adapterDefaults ? ["Used InkBench's default scientific adapter profile: one-core portfolio search, no repro minimization, and max depth 1,000."] : ["Used explicitly recorded InkCheck product/search options."]),
        ...(request.resources?.maxMemoryMb === undefined ? [] : [`Forwarded the ${request.resources.maxMemoryMb} MiB memory guard to InkCheck.`]),
        ...(childRuntime.heapLimitMb === undefined ? [] : [`Launched InkCheck with a ${childRuntime.heapLimitMb} MiB V8 old-space envelope so its ${request.resources!.maxMemoryMb} MiB cooperative guard can stop before an uncatchable heap abort.`]),
        ...(request.timeBudgetMs === undefined ? [] : [`Forwarded the planned ${Math.max(1, Math.ceil(request.timeBudgetMs / 1_000))} second wall-time budget to InkCheck.`]),
        ...(request.resources?.maxTimeMs === undefined ? [] : [`Forwarded a ${Math.max(1, Math.ceil(request.resources.maxTimeMs / 1_000))} second emergency time guard to InkCheck.`]),
        ...(parsed.resources?.peakMemoryBytes === undefined ? [] : [`InkCheck reported ${(parsed.resources.peakMemoryBytes / 1_048_576).toFixed(1)} MiB peak sampled heap against a ${((parsed.resources.memorySearchLimitBytes ?? parsed.resources.memoryCapBytes ?? 0) / 1_048_576).toFixed(0)} MiB search watermark.`]),
        "InkCheck states and InkBench choice transitions are adjacent but not identical work units; compare wall time and detection, and keep unit labels visible.",
        ...(transport === "bounded-stream"
          ? ["Used InkCheck's globally elapsed evidence timestamps for wall-time survival analysis; pass-local state positions remain excluded from work-unit survival curves."]
          : ["InkCheck portfolio finding positions are pass-local, so discovery timing is final-only and must not enter survival curves."]),
        "InkCheck does not expose the full InkBench empirical edge/state metric set, so coverage is null; its native heap telemetry is retained separately with external-adapter provenance.",
      ],
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
