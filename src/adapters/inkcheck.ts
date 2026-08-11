import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { hash } from "../core/hash.js";
import { SCHEMA_VERSION, type BugDiscovery, type RunReport, type RunRequest } from "../core/types.js";

interface InkCheckEnding {
  choiceIndices?: number[];
  path?: string[];
  firstDiscoveredAtState?: number;
  variables?: Record<string, unknown>;
}

interface InkCheckReport {
  inkcheckVersion?: string;
  explore?: {
    statesExplored?: number;
    endingsFound?: InkCheckEnding[];
    limits?: { maxStates?: number };
  };
}

function unavailable(request: RunRequest, runId: string, wallMs: number, message: string): RunReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    fixtureId: request.fixture.manifest.fixtureId,
    fixtureGeneratorVersion: request.fixture.manifest.generatorVersion,
    fixtureSourceSha256: hash(request.fixture.source, 64),
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
    discoveredBugs: [],
    plantedBugIds: request.fixture.manifest.bugs.map((bug) => bug.id),
    timing: { wallMs, cpuMs: null },
    runtime: { engine: "inkcheck", engineVersion: "unavailable", node: process.version, platform: `${process.platform}-${process.arch}` },
    status: "adapter-unavailable",
    error: message,
    notes: ["Install InkCheck or pass --inkcheck-command. Missing adapter metrics are null, not zero."],
  };
}

export function runInkCheckAdapter(request: RunRequest): RunReport {
  const runId = hash({
    fixtureId: request.fixture.manifest.fixtureId,
    generatorVersion: request.fixture.manifest.generatorVersion,
    fixtureSourceSha256: hash(request.fixture.source, 64),
    algorithm: "inkcheck",
    searchSeed: request.searchSeed,
    storySeed: request.storySeed,
    budget: request.budget,
  });
  const started = performance.now();
  const scratch = mkdtempSync(join(tmpdir(), "inkbench-inkcheck-"));
  try {
    const storyPath = join(scratch, `${request.fixture.manifest.fixtureId}.ink`);
    writeFileSync(storyPath, request.fixture.source, "utf8");
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
      schemaVersion: SCHEMA_VERSION,
      runId,
      fixtureId: request.fixture.manifest.fixtureId,
      fixtureGeneratorVersion: request.fixture.manifest.generatorVersion,
      fixtureSourceSha256: hash(request.fixture.source, 64),
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
      discoveredBugs: discoveries,
      plantedBugIds: request.fixture.manifest.bugs.map((bug) => bug.id),
      timing: { wallMs, cpuMs: null },
      runtime: {
        engine: "inkcheck",
        engineVersion: parsed.inkcheckVersion ?? "unknown",
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      },
      status: child.status === 0 || child.status === 1 ? "completed" : "runtime-error",
      error: child.status === 0 || child.status === 1 ? null : child.stderr.trim().slice(0, 1_000),
      notes: [
        `Invoked real InkCheck CLI via ${basename(configured)} with its native state budget.`,
        "InkCheck states and InkBench choice transitions are adjacent but not identical work units; compare wall time and detection, and keep unit labels visible.",
        "InkCheck does not expose the full InkBench empirical edge/state metric set, so coverage is null.",
      ],
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
