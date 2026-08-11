import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Story } from "inkjs/full";
import { fixtureSourceHash } from "../core/hash.js";
import { benchmarkRunId } from "../core/identity.js";
import { parseInkJson } from "../core/ink-json.js";
import { compiledFixtureStory } from "../core/runtime.js";
import { INKBENCH_VERSION, RUN_CONTRACT_VERSION, RUN_REPORT_SCHEMA_VERSION, type AdapterResourceUsage, type BugDiscovery, type ResourceStopReason, type RunReport, type RunRequest } from "../core/types.js";

interface InkCheckEnding {
  choiceIndices?: number[];
  path?: string[];
  firstDiscoveredAtState?: number;
  variables?: Record<string, unknown>;
}

interface InkCheckReport {
  inkcheckVersion?: string;
  effectiveConfiguration?: { concurrency?: number; concurrencyMode?: string };
  compile?: { success?: boolean };
  explore?: {
    statesExplored?: number;
    endingsFound?: InkCheckEnding[];
    limits?: { maxStates?: number };
    exhaustive?: boolean;
    execution?: {
      mode?: string;
      effectiveConcurrency?: number;
      requestedConcurrency?: number;
      resources?: {
        stateBudget?: number;
        heapEnvelopeBytes?: number;
        parentReserveBytes?: number;
        perWorkerHeapLimitBytes?: number;
        totalWorkerHeapLimitBytes?: number;
        peakTrackedHeapBytes?: number;
        aggregateMemoryStopped?: boolean;
        deadlineMs?: number;
      };
    };
    truncatedBy?: {
      maxStates?: boolean;
      memory?: boolean;
      time?: boolean;
    };
  };
}

function adapterResources(report: InkCheckReport): AdapterResourceUsage | null {
  const resources = report.explore?.execution?.resources;
  if (!resources) return null;
  const numeric = [
    resources.stateBudget,
    resources.heapEnvelopeBytes,
    resources.parentReserveBytes,
    resources.perWorkerHeapLimitBytes,
    resources.totalWorkerHeapLimitBytes,
    resources.peakTrackedHeapBytes,
  ];
  if (numeric.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)
    || typeof resources.aggregateMemoryStopped !== "boolean"
    || (resources.deadlineMs !== undefined && (typeof resources.deadlineMs !== "number" || !Number.isFinite(resources.deadlineMs)))) {
    return null;
  }
  return {
    source: "inkcheck",
    stateBudget: resources.stateBudget!,
    heapEnvelopeBytes: resources.heapEnvelopeBytes!,
    parentReserveBytes: resources.parentReserveBytes!,
    perWorkerHeapLimitBytes: resources.perWorkerHeapLimitBytes!,
    totalWorkerHeapLimitBytes: resources.totalWorkerHeapLimitBytes!,
    peakTrackedHeapBytes: resources.peakTrackedHeapBytes!,
    aggregateMemoryStopped: resources.aggregateMemoryStopped,
    deadlineMs: resources.deadlineMs ?? null,
  };
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove private scoring markers while retaining line count and all story behavior. */
export function oracleNeutralInkSource(source: string, request: RunRequest, declareSink = true): string {
  const variables = request.fixture.manifest.bugs.map((bug) => escaped(bug.oracle.variable));
  if (variables.length === 0) return source;
  const names = variables.join("|");
  const declaration = new RegExp(`^\\s*VAR\\s+(?:${names})\\b`);
  const assignment = new RegExp(`^(\\s*)~\\s*(?:${names})\\s*=`);
  const markerTag = /^\s*#\s*INKBENCH_BUG:/;
  const neutral = source.split("\n").map((line) => {
    if (declaration.test(line) || markerTag.test(line)) return "// InkBench oracle marker removed from search input";
    const assigned = assignment.exec(line);
    return assigned ? `${assigned[1]}~ inkbench_oracle_sink = inkbench_oracle_sink` : line;
  }).join("\n");
  return declareSink ? `VAR inkbench_oracle_sink = false\n${neutral}` : neutral;
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
          transition: 0,
          elapsedMs: 0,
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

function parseInkCheckReport(path: string, request: RunRequest): { parsed: InkCheckReport; replay: ReplayResult } {
  const replayer = new OrderedEndingReplayer(request);
  const sanitized: string[] = [];
  let inEndings = false;
  let endingLines: string[] | null = null;
  let streamed = false;
  for (const line of readLines(path)) {
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
  if (streamed) return { parsed: JSON.parse(sanitized.join("\n")) as InkCheckReport, replay: replayer.result() };
  const bytes = statSync(path).size;
  if (bytes > 16 * 1024 * 1024) throw new RangeError("InkCheck emitted an unrecognized large JSON report layout");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as InkCheckReport;
  for (const ending of parsed.explore?.endingsFound ?? []) replayer.replay(ending);
  return { parsed, replay: replayer.result() };
}

function scratchPath(root: string, requested: string): string {
  const target = resolve(root, requested);
  const fromRoot = relative(root, target);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`unsafe fixture source path: ${requested}`);
  }
  return target;
}

function unavailable(request: RunRequest, runId: string, wallMs: number, message: string): RunReport {
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
    algorithmVersion: "unavailable",
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
    timing: { wallMs, cpuMs: null },
    parallelism: { requested: request.inkcheckOptions === undefined ? 1 : request.inkcheckOptions.concurrency ?? "auto", effective: null, mode: "unavailable" },
    stopReason: "error",
    resources: null,
    adapterResources: null,
    runtime: { harnessVersion: INKBENCH_VERSION, runContractVersion: RUN_CONTRACT_VERSION, engine: "inkcheck", engineVersion: "unavailable", node: process.version, platform: `${process.platform}-${process.arch}` },
    status: "adapter-unavailable",
    error: message,
    notes: ["Install InkCheck or pass --inkcheck-command. Missing adapter metrics are null, not zero."],
  };
}

export function runInkCheckAdapter(request: RunRequest): RunReport {
  const runId = benchmarkRunId(request);
  const started = performance.now();
  const scratch = mkdtempSync(join(tmpdir(), "inkbench-inkcheck-"));
  try {
    const entrypoint = request.fixture.tier !== "generated-planted"
      ? request.fixture.sourceBundle.entrypoint
      : `${request.fixture.manifest.fixtureId}.ink`;
    if (request.fixture.tier !== "generated-planted") {
      for (const [relativePath, contents] of Object.entries(request.fixture.sourceBundle.files)) {
        const target = scratchPath(scratch, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, oracleNeutralInkSource(contents, request, relativePath === entrypoint), "utf8");
      }
    }
    const storyPath = scratchPath(scratch, entrypoint);
    if (request.fixture.tier === "generated-planted") writeFileSync(storyPath, oracleNeutralInkSource(request.fixture.source, request), "utf8");
    const configured = request.inkcheckCommand ?? "inkcheck";
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
    const isJavaScript = configured.endsWith(".js");
    const executable = isJavaScript ? process.execPath : configured;
    const args = [
      ...(isJavaScript ? [configured] : []),
      storyPath,
      "--json",
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
    const stdoutPath = join(scratch, "inkcheck-report.json");
    const stderrPath = join(scratch, "inkcheck-stderr.txt");
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    let child: ReturnType<typeof spawnSync>;
    try {
      child = spawnSync(executable, args, { stdio: ["ignore", stdoutFd, stderrFd] });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
    const stderr = readFileSync(stderrPath, "utf8");
    const reportBytes = statSync(stdoutPath).size;
    const childWallMs = performance.now() - started;
    if (child.error) return unavailable(request, runId, childWallMs, child.error.message);
    let parsed: InkCheckReport;
    let replay: ReplayResult;
    try {
      ({ parsed, replay } = parseInkCheckReport(stdoutPath, request));
    } catch (error) {
      const parseError = error instanceof Error ? error.message : String(error);
      const detail = stderr.trim() || parseError || `exit status ${child.status ?? "unknown"}`;
      return unavailable(request, runId, childWallMs, `InkCheck returned no JSON report: ${detail.slice(0, 1_000)}`);
    }
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
    const discoveries: BugDiscovery[] = replay.discoveries.map((discovery) => ({
      ...discovery,
      transition: parsed.explore?.statesExplored ?? request.budget,
      elapsedMs: wallMs,
      cpuMs: null,
    }));
    const externalResources = adapterResources(parsed);
    return {
      schemaVersion: RUN_REPORT_SCHEMA_VERSION,
      runId,
      fixtureId: request.fixture.manifest.fixtureId,
      fixtureGeneratorVersion: request.fixture.manifest.generatorVersion,
      fixtureSourceSha256: fixtureSourceHash(request.fixture),
      benchmarkTier: request.fixture.tier,
      family: request.fixture.manifest.family,
      algorithm: "inkcheck",
      algorithmVersion: parsed.inkcheckVersion ?? "unknown",
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
      discoveryTimingBasis: "final-only",
      timing: { wallMs, cpuMs: null },
      parallelism: {
        requested: inkcheckOptions.concurrency ?? "auto",
        effective: parsed.explore?.execution?.effectiveConcurrency ?? parsed.effectiveConfiguration?.concurrency ?? null,
        mode: parsed.explore?.execution?.mode ?? parsed.effectiveConfiguration?.concurrencyMode ?? "unknown",
      },
      stopReason: compileFailed || processFailed ? "error" : stopReason,
      resources: null,
      adapterResources: externalResources,
      runtime: {
        harnessVersion: INKBENCH_VERSION,
        runContractVersion: RUN_CONTRACT_VERSION,
        engine: "inkcheck",
        engineVersion: parsed.inkcheckVersion ?? "unknown",
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      },
      status: compileFailed ? "compile-error" : processFailed ? "runtime-error" : resourceStopped ? "resource-stopped" : "completed",
      error: compileFailed || processFailed ? stderr.trim().slice(0, 1_000) || "InkCheck did not produce exploration evidence" : null,
      notes: [
        `Invoked real InkCheck CLI via ${basename(configured)} with its native state budget.`,
        "Streamed InkCheck stdout/stderr to scratch files before parsing so large final reports do not hit a child-process capture buffer.",
        `InkCheck final JSON report size was ${reportBytes} bytes.`,
        `Stream-parsed ${replay.paths} ending paths and replayed ${replay.transitions} unique ordered-prefix transitions (${replay.divergences} path divergences).`,
        "Removed planted-oracle declarations, assignments, and marker tags from InkCheck's search input; scored returned ending paths by replay against the pinned instrumented artifact.",
        ...(adapterDefaults ? ["Used InkBench's default scientific adapter profile: one-core portfolio search, no repro minimization, and max depth 1,000."] : ["Used explicitly recorded InkCheck product/search options."]),
        ...(request.resources?.maxMemoryMb === undefined ? [] : [`Forwarded the ${request.resources.maxMemoryMb} MiB memory guard to InkCheck.`]),
        ...(request.timeBudgetMs === undefined ? [] : [`Forwarded the planned ${Math.max(1, Math.ceil(request.timeBudgetMs / 1_000))} second wall-time budget to InkCheck.`]),
        ...(request.resources?.maxTimeMs === undefined ? [] : [`Forwarded a ${Math.max(1, Math.ceil(request.resources.maxTimeMs / 1_000))} second emergency time guard to InkCheck.`]),
        "InkCheck states and InkBench choice transitions are adjacent but not identical work units; compare wall time and detection, and keep unit labels visible.",
        "InkCheck portfolio finding positions are pass-local, so discovery timing is final-only and must not enter survival curves.",
        ...(externalResources === null
          ? ["InkCheck did not expose adapter-owned resource telemetry for this execution mode."]
          : ["Recorded InkCheck's aggregate tracked-heap telemetry separately from InkBench process/snapshot accounting."]),
        "InkCheck does not expose the full InkBench empirical edge/state metric set, so coverage is null.",
      ],
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
