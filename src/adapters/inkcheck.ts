import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fixtureSourceHash } from "../core/hash.js";
import { benchmarkRunId } from "../core/identity.js";
import { INKBENCH_VERSION, RUN_CONTRACT_VERSION, RUN_REPORT_SCHEMA_VERSION, type BugDiscovery, type ResourceStopReason, type RunReport, type RunRequest } from "../core/types.js";

interface InkCheckEnding {
  choiceIndices?: number[];
  path?: string[];
  firstDiscoveredAtState?: number;
  variables?: Record<string, unknown>;
}

interface InkCheckReport {
  inkcheckVersion?: string;
  compile?: { success?: boolean };
  explore?: {
    statesExplored?: number;
    endingsFound?: InkCheckEnding[];
    limits?: { maxStates?: number };
    exhaustive?: boolean;
    truncatedBy?: {
      maxStates?: boolean;
      memory?: boolean;
      time?: boolean;
    };
  };
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
    budget: { unit: "inkcheck-states", limit: request.budget },
    counts: { transitions: 0, launches: 0, rootLaunches: 0, episodesCompleted: 0 },
    coverage: null,
    coverageItems: null,
    discoveredBugs: [],
    runtimeFindings: [],
    plantedBugIds: request.fixture.manifest.bugs.map((bug) => bug.id),
    timing: { wallMs, cpuMs: null },
    stopReason: "error",
    resources: null,
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
    const entrypoint = request.fixture.tier === "authored-project"
      ? request.fixture.sourceBundle.entrypoint
      : `${request.fixture.manifest.fixtureId}.ink`;
    if (request.fixture.tier === "authored-project") {
      for (const [relativePath, contents] of Object.entries(request.fixture.sourceBundle.files)) {
        const target = scratchPath(scratch, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents, "utf8");
      }
    }
    const storyPath = scratchPath(scratch, entrypoint);
    if (request.fixture.tier === "generated-planted") writeFileSync(storyPath, request.fixture.source, "utf8");
    const configured = request.inkcheckCommand ?? "inkcheck";
    const isJavaScript = configured.endsWith(".js");
    const executable = isJavaScript ? process.execPath : configured;
    const args = [
      ...(isJavaScript ? [configured] : []),
      storyPath,
      "--json",
      "--no-min-repro",
      "--max-states",
      String(request.budget),
      "--max-depth",
      "1000",
      "--seed",
      String(request.searchSeed),
      "--story-seed",
      String(request.storySeed),
      "--progress=off",
      ...(request.resources?.maxMemoryMb === undefined
        ? []
        : ["--max-memory", String(request.resources.maxMemoryMb)]),
      ...(request.resources?.maxTimeMs === undefined
        ? []
        : ["--max-time", String(Math.max(1, Math.floor(request.resources.maxTimeMs / 1_000)))]),
    ];
    const child = spawnSync(executable, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const wallMs = performance.now() - started;
    if (child.error) return unavailable(request, runId, wallMs, child.error.message);
    let parsed: InkCheckReport;
    try {
      parsed = JSON.parse(child.stdout) as InkCheckReport;
    } catch {
      const detail = child.stderr.trim() || child.stdout.trim() || `exit status ${child.status ?? "unknown"}`;
      return unavailable(request, runId, wallMs, `InkCheck returned no JSON report: ${detail.slice(0, 1_000)}`);
    }
    const endings = parsed.explore?.endingsFound ?? [];
    const truncated = parsed.explore?.truncatedBy;
    const stopReason: ResourceStopReason = truncated?.memory
      ? "memory"
      : truncated?.time
        ? "time"
        : truncated?.maxStates || (parsed.explore?.statesExplored ?? 0) >= request.budget
          ? "budget"
          : "search-exhausted";
    const resourceStopped = stopReason === "memory" || stopReason === "time";
    const compileFailed = parsed.compile?.success === false || parsed.explore === undefined;
    const processFailed = child.status !== 0 && child.status !== 1;
    const discoveries: BugDiscovery[] = [];
    for (const bug of request.fixture.manifest.bugs) {
      const ending = endings
        .filter((candidate) => candidate.variables?.[bug.oracle.variable] === bug.oracle.value)
        .sort((left, right) => (left.firstDiscoveredAtState ?? Number.MAX_SAFE_INTEGER) - (right.firstDiscoveredAtState ?? Number.MAX_SAFE_INTEGER))[0];
      if (!ending) continue;
      discoveries.push({
        bugId: bug.id,
        transition: ending.firstDiscoveredAtState ?? parsed.explore?.statesExplored ?? request.budget,
        elapsedMs: wallMs,
        cpuMs: null,
        choicePath: ending.choiceIndices ?? [],
        choiceTextPath: ending.path ?? [],
        location: "bug",
      });
    }
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
      budget: { unit: "inkcheck-states", limit: request.budget },
      counts: {
        transitions: parsed.explore?.statesExplored ?? 0,
        launches: 0,
        rootLaunches: 0,
        episodesCompleted: endings.length,
      },
      coverage: null,
      coverageItems: null,
      discoveredBugs: discoveries,
      runtimeFindings: [],
      plantedBugIds: request.fixture.manifest.bugs.map((bug) => bug.id),
      timing: { wallMs, cpuMs: null },
      stopReason: compileFailed || processFailed ? "error" : stopReason,
      resources: null,
      runtime: {
        harnessVersion: INKBENCH_VERSION,
        runContractVersion: RUN_CONTRACT_VERSION,
        engine: "inkcheck",
        engineVersion: parsed.inkcheckVersion ?? "unknown",
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      },
      status: compileFailed ? "compile-error" : processFailed ? "runtime-error" : resourceStopped ? "resource-stopped" : "completed",
      error: compileFailed || processFailed ? child.stderr.trim().slice(0, 1_000) || "InkCheck did not produce exploration evidence" : null,
      notes: [
        `Invoked real InkCheck CLI via ${basename(configured)} with its native state budget.`,
        ...(request.resources?.maxMemoryMb === undefined ? [] : [`Forwarded the ${request.resources.maxMemoryMb} MiB memory guard to InkCheck.`]),
        ...(request.resources?.maxTimeMs === undefined ? [] : [`Forwarded a ${Math.max(1, Math.floor(request.resources.maxTimeMs / 1_000))} second time guard to InkCheck.`]),
        "InkCheck states and InkBench choice transitions are adjacent but not identical work units; compare wall time and detection, and keep unit labels visible.",
        "InkCheck does not expose the full InkBench empirical edge/state metric set, so coverage is null.",
      ],
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
