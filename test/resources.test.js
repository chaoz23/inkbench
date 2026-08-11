import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  generateFixture,
  InstrumentedController,
  oracleNeutralInkSource,
  oracleNeutralRawStateKey,
  runBenchmark,
  runBenchmarkIsolated,
  runAuthoredExperimentIsolated,
  runExperimentIsolated,
  writeAuthoredExperiment,
  writeExperiment,
} from "../dist/index.js";

test("planted oracles are private scoring data, not search observations", () => {
  const original = generateFixture("shallow-obvious", 1, 1);
  const fixture = {
    ...original,
    source: `VAR ib_bug = 0
-> start
=== start ===
+ [Trigger]
  ~ ib_bug = 1
  -> shared
+ [Safe]
  -> shared
=== shared ===
Done.
-> END
`,
    manifest: { ...original.manifest, locations: ["start", "shared"] },
  };
  const bugController = new InstrumentedController(fixture, 1, 1);
  bugController.launch();
  const bugObservation = bugController.step(0).after;
  const safeController = new InstrumentedController(fixture, 1, 1);
  safeController.launch();
  const safeObservation = safeController.step(1).after;
  assert.equal(bugController.bugDiscoveries.length, 1);
  assert.ok(!bugObservation.events.some((event) => event.kind === "bug"));
  assert.equal(bugObservation.semanticKey, safeObservation.semanticKey);
  assert.equal(
    oracleNeutralRawStateKey('{"variablesState":{"ib_bug":1,"x":2}}', ["ib_bug"]),
    oracleNeutralRawStateKey('{"variablesState":{"ib_bug":0,"x":2}}', ["ib_bug"]),
  );
  const neutral = oracleNeutralInkSource(fixture.source, {
    fixture,
    algorithm: "inkcheck",
    searchSeed: 1,
    storySeed: 1,
    budget: 10,
  });
  assert.ok(!neutral.includes("ib_bug"));
  assert.match(neutral, /inkbench_oracle_sink = inkbench_oracle_sink/);
});

test("snapshot ownership charges retained frontiers instead of retaining every transition", () => {
  const fixture = generateFixture("compound-needle", 1, 2);
  const random = runBenchmark({ fixture, algorithm: "random", searchSeed: 1, storySeed: 1, budget: 500 });
  const systematic = runBenchmark({ fixture, algorithm: "systematic", searchSeed: 1, storySeed: 1, budget: 500 });
  assert.equal(random.stopReason, "budget");
  assert.equal(random.resources.stopReason, "budget");
  assert.equal(random.resources.snapshots.created, 501);
  assert.equal(random.resources.snapshots.current, 2);
  assert.ok(random.resources.snapshots.peak <= 3);
  assert.equal(random.resources.snapshots.peakCheckpointBytes, 0);
  assert.ok(systematic.resources.snapshots.peakCheckpointBytes > 0);
  assert.ok(systematic.resources.snapshots.peak < systematic.resources.snapshots.created);
});

test("authored-project matrices use the same isolated resource contract", async () => {
  const directory = mkdtempSync(join(tmpdir(), "inkbench-authored-matrix-"));
  try {
    const result = await runAuthoredExperimentIsolated({
      schemaVersion: 1,
      storyIds: ["dog-ink-adventure"],
      algorithms: ["random", "coverage"],
      searchSeeds: [1],
      budgets: [20],
      storySeed: 1,
      resources: { maxMemoryMb: 128, progressIntervalTransitions: 5 },
    }, { outputDirectory: directory, resume: true, retainCoverageItems: false });
    assert.equal(result.runs.length, 2);
    assert.equal(result.runs[0].schemaVersion, 3);
    assert.equal(result.runs[0].benchmarkTier, "authored-project");
    assert.equal(result.runs[0].stopReason, "budget");
    assert.equal(result.runs[0].resources.stopReason, "budget");
    assert.equal(result.runs[0].coverageItems, null);
    assert.equal(result.summary.coverage[0].resourceStopped, 0);
    assert.ok(result.summary.coverage[0].meanPeakHeapBytes > 0);
    assert.equal(result.summary.complementarity[0].pairedRuns, 1);
    writeAuthoredExperiment(directory, result);
    const raw = readFileSync(join(directory, "runs.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(raw.every((report) => report.coverageItems !== null));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resource guards return partial evidence before an unsafe heap boundary", () => {
  const fixture = generateFixture("deep-corridor", 1, 2);
  const events = [];
  const report = runBenchmark({
    fixture,
    algorithm: "swarm",
    searchSeed: 1,
    storySeed: 1,
    budget: 10_000,
    resources: { maxMemoryMb: 1, progressIntervalTransitions: 1 },
    onProgress: (event) => events.push(event),
  });
  assert.equal(report.status, "resource-stopped");
  assert.equal(report.stopReason, "memory");
  assert.equal(report.resources.stopReason, "memory");
  assert.equal(report.counts.transitions, 0);
  assert.deepEqual(events.map((event) => event.type), ["run_start", "run_end"]);
  assert.equal(events.at(-1).stopReason, "memory");
});

test("planned wall-time expiry is completed evidence with a separate native work ceiling", () => {
  const events = [];
  const report = runBenchmark({
    fixture: generateFixture("compound-needle", 1, 4),
    algorithm: "random",
    searchSeed: 1,
    storySeed: 1,
    budget: 100_000_000,
    timeBudgetMs: 1,
    resources: { maxMemoryMb: 128, progressIntervalTransitions: 1 },
    onProgress: (event) => events.push(event),
  });
  assert.equal(report.status, "completed");
  assert.equal(report.stopReason, "time");
  assert.deepEqual(report.budget, { unit: "wall-ms", limit: 1 });
  assert.deepEqual(report.workBudget, { unit: "choice-transitions", limit: 100_000_000 });
  assert.deepEqual(report.parallelism, { requested: 1, effective: 1, mode: "single-process" });
  assert.equal(report.discoveryTimingBasis, "global-work");
  assert.equal(events[0].schemaVersion, 2);
  assert.deepEqual(events[0].budget, report.budget);
  assert.equal(events.at(-1).budgetFraction, 1);
});

test("InkCheck adapter forwards resource guards and preserves external stop reasons", () => {
  const directory = mkdtempSync(join(tmpdir(), "inkbench-inkcheck-adapter-"));
  const command = join(directory, "mock-inkcheck.js");
  try {
    writeFileSync(command, `
const args = process.argv.slice(2);
const expected = [["--max-states", "123"], ["--max-memory", "96"], ["--max-time", "2"]];
for (const [flag, value] of expected) {
  const index = args.indexOf(flag);
  if (index < 0 || args[index + 1] !== value) process.exit(2);
}
if (!args.includes("--progress=off")) process.exit(2);
process.stdout.write(JSON.stringify({
  inkcheckVersion: "test",
  compile: { success: true },
  explore: {
    statesExplored: 77,
    endingsFound: [{ choiceIndices: [2], path: ["Obvious option 3"], firstDiscoveredAtState: 5 }],
    exhaustive: false,
    truncatedBy: { maxStates: false, memory: true, time: false },
    execution: {
      mode: "concurrent",
      effectiveConcurrency: 1,
      resources: {
        stateBudget: 123,
        heapEnvelopeBytes: 100663296,
        parentReserveBytes: 16777216,
        perWorkerHeapLimitBytes: 83886080,
        totalWorkerHeapLimitBytes: 83886080,
        peakTrackedHeapBytes: 50331648,
        aggregateMemoryStopped: true,
        deadlineMs: 2000
      }
    }
  }
}, null, 2));
`, "utf8");
    const report = runBenchmark({
      fixture: generateFixture("shallow-obvious", 1, 1),
      algorithm: "inkcheck",
      searchSeed: 1,
      storySeed: 1,
      budget: 123,
      inkcheckCommand: command,
      resources: { maxMemoryMb: 96, maxTimeMs: 2_500 },
    });
    assert.equal(report.status, "resource-stopped");
    assert.equal(report.stopReason, "memory");
    assert.equal(report.counts.transitions, 77);
    assert.equal(report.discoveredBugs.length, 1);
    assert.equal(report.discoveryTimingBasis, "final-only");
    assert.equal(report.parallelism.requested, 1);
    assert.match(report.notes.join("\n"), /Stream-parsed 1 ending paths/);
    assert.equal(report.resources, null);
    assert.deepEqual(report.adapterResources, {
      source: "inkcheck",
      stateBudget: 123,
      heapEnvelopeBytes: 100663296,
      parentReserveBytes: 16777216,
      perWorkerHeapLimitBytes: 83886080,
      totalWorkerHeapLimitBytes: 83886080,
      peakTrackedHeapBytes: 50331648,
      aggregateMemoryStopped: true,
      deadlineMs: 2000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("isolated workers preserve deterministic search evidence and stream progress", async () => {
  const fixture = generateFixture("rare-prefix", 1, 2);
  const request = {
    fixture,
    algorithm: "swarm",
    searchSeed: 1,
    storySeed: 1,
    budget: 500,
    resources: { maxMemoryMb: 128, progressIntervalTransitions: 100 },
  };
  const direct = runBenchmark(request);
  const events = [];
  const directory = mkdtempSync(join(tmpdir(), "inkbench-progress-"));
  const latest = join(directory, "latest.json");
  try {
    const isolated = await runBenchmarkIsolated(request, {
      heapLimitMb: 160,
      latestProgressPath: latest,
      onProgress: (event) => events.push(event),
    });
    assert.deepEqual(isolated.counts, direct.counts);
    assert.deepEqual(isolated.coverage, direct.coverage);
    assert.deepEqual(
      isolated.discoveredBugs.map(({ elapsedMs: _elapsed, cpuMs: _cpu, ...rest }) => rest),
      direct.discoveredBugs.map(({ elapsedMs: _elapsed, cpuMs: _cpu, ...rest }) => rest),
    );
    assert.equal(events[0].type, "run_start");
    assert.equal(events.at(-1).type, "run_end");
    assert.ok(events.every((event, index) => index === 0 || event.transitions >= events[index - 1].transitions));
    assert.equal(JSON.parse(readFileSync(latest, "utf8")).type, "run_end");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("isolated experiment matrices persist cells atomically and resume completed work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "inkbench-matrix-"));
  const config = {
    schemaVersion: 1,
    families: ["shallow-obvious"],
    algorithms: ["random"],
    fixtureSeeds: [1],
    searchSeeds: [1],
    budgets: [20],
    difficulty: 1,
    storySeed: 1,
    resources: { maxMemoryMb: 128, progressIntervalTransitions: 5 },
  };
  try {
    const firstStates = [];
    const first = await runExperimentIsolated(config, {
      outputDirectory: directory,
      resume: true,
      retainCoverageItems: false,
      onRun: (_report, _completed, _total, resumed) => firstStates.push(resumed),
    });
    const secondStates = [];
    const second = await runExperimentIsolated(config, {
      outputDirectory: directory,
      resume: true,
      retainCoverageItems: false,
      onRun: (_report, _completed, _total, resumed) => secondStates.push(resumed),
    });
    assert.deepEqual(firstStates, [false]);
    assert.deepEqual(secondStates, [true]);
    assert.deepEqual(second.runs, first.runs);
    assert.equal(second.runs[0].coverageItems, null);
    assert.equal(JSON.parse(readFileSync(join(directory, "matrix-state.json"), "utf8")).status, "complete");
    assert.ok(existsSync(join(directory, "cells", `${first.runs[0].runId}.json`)));
    assert.equal(readFileSync(join(directory, "runs.partial.ndjson"), "utf8").trim().split("\n").length, 1);
    writeExperiment(directory, second);
    assert.notEqual(JSON.parse(readFileSync(join(directory, "runs.ndjson"), "utf8")).coverageItems, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
