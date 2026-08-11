import { hash } from "./hash.js";
import { InstrumentedController } from "./runtime.js";
import { SCHEMA_VERSION, type InProcessAlgorithmId, type RunReport, type RunRequest } from "./types.js";
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
  const runId = hash({
    fixtureId: request.fixture.manifest.fixtureId,
    generatorVersion: request.fixture.manifest.generatorVersion,
    fixtureSourceSha256: hash(request.fixture.source, 64),
    algorithm: request.algorithm,
    algorithmVersion: searcher.version,
    searchSeed: request.searchSeed,
    storySeed: request.storySeed,
    budget: request.budget,
  });
  const wallStart = performance.now();
  const cpuStart = process.cpuUsage();
  let controller: InstrumentedController | undefined;
  try {
    controller = new InstrumentedController(request.fixture, request.budget, request.storySeed);
    const outcome = searcher.run(controller, request.searchSeed);
    const cpu = process.cpuUsage(cpuStart);
    return {
      schemaVersion: SCHEMA_VERSION,
      runId,
      fixtureId: request.fixture.manifest.fixtureId,
      fixtureGeneratorVersion: request.fixture.manifest.generatorVersion,
      fixtureSourceSha256: hash(request.fixture.source, 64),
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
      discoveredBugs: controller.bugDiscoveries,
      plantedBugIds: request.fixture.manifest.bugs.map((bug) => bug.id),
      timing: {
        wallMs: performance.now() - wallStart,
        cpuMs: (cpu.user + cpu.system) / 1_000,
      },
      runtime: { engine: "inkjs", engineVersion: "2.4.0", node: process.version, platform: `${process.platform}-${process.arch}` },
      status: "completed",
      error: null,
      notes: outcome.notes,
    };
  } catch (error) {
    const cpu = process.cpuUsage(cpuStart);
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    const compileError = message.includes("compil");
    return {
      schemaVersion: SCHEMA_VERSION,
      runId,
      fixtureId: request.fixture.manifest.fixtureId,
      fixtureGeneratorVersion: request.fixture.manifest.generatorVersion,
      fixtureSourceSha256: hash(request.fixture.source, 64),
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
      discoveredBugs: controller?.bugDiscoveries ?? [],
      plantedBugIds: request.fixture.manifest.bugs.map((bug) => bug.id),
      timing: { wallMs: performance.now() - wallStart, cpuMs: (cpu.user + cpu.system) / 1_000 },
      runtime: { engine: "inkjs", engineVersion: "2.4.0", node: process.version, platform: `${process.platform}-${process.arch}` },
      status: compileError ? "compile-error" : "runtime-error",
      error: message,
      notes: [],
    };
  }
}
