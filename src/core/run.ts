import { fixtureSourceHash } from "./hash.js";
import { benchmarkRunId } from "./identity.js";
import { ResourceGuards } from "./resource-guards.js";
import { InstrumentedController } from "./runtime.js";
import {
  PROGRESS_SCHEMA_VERSION,
  RUN_REPORT_SCHEMA_VERSION,
  INKBENCH_VERSION,
  RUN_CONTRACT_VERSION,
  type InProcessAlgorithmId,
  type ResourceStopReason,
  type RunProgressEvent,
  type RunReport,
  type RunRequest,
} from "./types.js";
import { runInkCheckAdapter } from "../adapters/inkcheck.js";
import { getSearcher } from "../searchers/index.js";

function isInProcess(id: RunRequest["algorithm"]): id is InProcessAlgorithmId {
  return id !== "inkcheck";
}

export function runBenchmark(request: RunRequest): RunReport {
  if (!Number.isSafeInteger(request.searchSeed)) throw new RangeError("search seed must be a safe integer");
  if (!Number.isSafeInteger(request.budget) || request.budget < 1) throw new RangeError("budget must be a positive integer");
  if (request.algorithm === "inkcheck") return runInkCheckAdapter(request);
  if (!isInProcess(request.algorithm)) throw new RangeError(`unknown algorithm: ${request.algorithm}`);

  const searcher = getSearcher(request.algorithm);
  const runId = benchmarkRunId(request);
  const wallStart = performance.now();
  const cpuStart = process.cpuUsage();
  const guards = new ResourceGuards(request.resources);
  let controller: InstrumentedController | undefined;
  let sequence = 0;
  let lastProgressTransition = 0;
  let lastProgressAt = Date.now();
  let progressError: string | null = null;

  const emit = (type: RunProgressEvent["type"], stopReason: ResourceStopReason | null = null): void => {
    if (!request.onProgress) return;
    const transitions = controller?.transitions ?? 0;
    const event: RunProgressEvent = {
      schemaVersion: PROGRESS_SCHEMA_VERSION,
      sequence: ++sequence,
      type,
      runId,
      fixtureId: request.fixture.manifest.fixtureId,
      algorithm: request.algorithm,
      elapsedMs: performance.now() - wallStart,
      transitions,
      transitionBudget: request.budget,
      budgetFraction: Math.min(1, transitions / request.budget),
      coverage: controller?.coverage ?? null,
      discoveredBugIds: controller?.bugDiscoveries.map((discovery) => discovery.bugId) ?? [],
      runtimeFindings: controller?.runtimeFindings.length ?? 0,
      processMemory: guards.sample(),
      snapshotMemory: controller?.snapshotMemory ?? null,
      stopReason,
    };
    try {
      request.onProgress(event);
    } catch (error) {
      progressError ??= error instanceof Error ? error.message : String(error);
    }
  };

  emit("run_start");
  try {
    controller = new InstrumentedController(request.fixture, request.budget, request.storySeed, {
      guards,
      onTransition: (result) => {
        const now = Date.now();
        if (result.newlyDiscoveredBugIds.length > 0) emit("discovery");
        if (
          controller!.transitions - lastProgressTransition >= guards.progressIntervalTransitions
          || now - lastProgressAt >= guards.progressIntervalMs
        ) {
          lastProgressTransition = controller!.transitions;
          lastProgressAt = now;
          emit("progress");
        }
      },
    });
    const outcome = searcher.run(controller, request.searchSeed);
    const stopReason = controller.resourceStopReason
      ?? (controller.transitions >= request.budget ? "budget" : "search-exhausted");
    const cpu = process.cpuUsage(cpuStart);
    const report: RunReport = {
      schemaVersion: RUN_REPORT_SCHEMA_VERSION,
      runId,
      fixtureId: request.fixture.manifest.fixtureId,
      fixtureGeneratorVersion: request.fixture.manifest.generatorVersion,
      fixtureSourceSha256: fixtureSourceHash(request.fixture),
      benchmarkTier: request.fixture.tier,
      family: request.fixture.manifest.family,
      algorithm: request.algorithm,
      algorithmVersion: searcher.version,
      fixtureSeed: request.fixture.manifest.seed,
      searchSeed: request.searchSeed,
      storySeed: request.storySeed,
      difficulty: request.fixture.manifest.difficulty,
      dimensions: request.fixture.manifest.dimensions,
      budget: { unit: "choice-transitions", limit: request.budget },
      counts: {
        transitions: controller.transitions,
        launches: controller.launches,
        rootLaunches: controller.rootLaunches,
        episodesCompleted: controller.episodesCompleted,
      },
      coverage: controller.coverage,
      coverageItems: controller.coverageItems,
      discoveredBugs: controller.bugDiscoveries,
      runtimeFindings: controller.runtimeFindings,
      plantedBugIds: request.fixture.manifest.bugs.map((bug) => bug.id),
      timing: {
        wallMs: performance.now() - wallStart,
        cpuMs: (cpu.user + cpu.system) / 1_000,
      },
      stopReason,
      resources: controller.resourceUsage(stopReason),
      runtime: { harnessVersion: INKBENCH_VERSION, runContractVersion: RUN_CONTRACT_VERSION, engine: "inkjs", engineVersion: "2.4.0", node: process.version, platform: `${process.platform}-${process.arch}` },
      status: stopReason === "memory" || stopReason === "time" ? "resource-stopped" : "completed",
      error: null,
      notes: [
        ...(request.fixture.tier === "authored-project"
          ? [...outcome.notes, `Loaded pinned ${request.fixture.manifest.compiler.name} ${request.fixture.manifest.compiler.version} compiled artifact ${request.fixture.manifest.compiler.artifactSha256}.`]
          : outcome.notes),
        ...(progressError ? [`Progress observer failed without changing search behavior: ${progressError}`] : []),
      ],
    };
    emit("run_end", stopReason);
    return report;
  } catch (error) {
    guards.stop("error");
    const cpu = process.cpuUsage(cpuStart);
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    const compileError = message.includes("compil");
    const report: RunReport = {
      schemaVersion: RUN_REPORT_SCHEMA_VERSION,
      runId,
      fixtureId: request.fixture.manifest.fixtureId,
      fixtureGeneratorVersion: request.fixture.manifest.generatorVersion,
      fixtureSourceSha256: fixtureSourceHash(request.fixture),
      benchmarkTier: request.fixture.tier,
      family: request.fixture.manifest.family,
      algorithm: request.algorithm,
      algorithmVersion: searcher.version,
      fixtureSeed: request.fixture.manifest.seed,
      searchSeed: request.searchSeed,
      storySeed: request.storySeed,
      difficulty: request.fixture.manifest.difficulty,
      dimensions: request.fixture.manifest.dimensions,
      budget: { unit: "choice-transitions", limit: request.budget },
      counts: {
        transitions: controller?.transitions ?? 0,
        launches: controller?.launches ?? 0,
        rootLaunches: controller?.rootLaunches ?? 0,
        episodesCompleted: controller?.episodesCompleted ?? 0,
      },
      coverage: controller?.coverage ?? null,
      coverageItems: controller?.coverageItems ?? null,
      discoveredBugs: controller?.bugDiscoveries ?? [],
      runtimeFindings: controller?.runtimeFindings ?? [],
      plantedBugIds: request.fixture.manifest.bugs.map((bug) => bug.id),
      timing: { wallMs: performance.now() - wallStart, cpuMs: (cpu.user + cpu.system) / 1_000 },
      stopReason: "error",
      resources: controller?.resourceUsage("error") ?? null,
      runtime: { harnessVersion: INKBENCH_VERSION, runContractVersion: RUN_CONTRACT_VERSION, engine: "inkjs", engineVersion: "2.4.0", node: process.version, platform: `${process.platform}-${process.arch}` },
      status: compileError ? "compile-error" : "runtime-error",
      error: message,
      notes: request.fixture.tier === "authored-project"
        ? [`Authored source was pinned at upstream commit ${request.fixture.manifest.source.commit}; compiled artifact ${request.fixture.manifest.compiler.artifactSha256}.`]
        : [],
    };
    emit("run_end", "error");
    return report;
  }
}
