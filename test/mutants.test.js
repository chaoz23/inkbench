import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  InstrumentedController,
  listAuthoredPlantedStories,
  loadAuthoredFixture,
  loadAuthoredPlantedFixture,
  loadAuthoredPlantedWitnesses,
  plannedMutantCells,
  runMutantExperiment,
  runMutantExperimentIsolated,
  summarizeMutantRuns,
  writeMutantExperiment,
} from "../dist/index.js";

test("mutant deterministic replication is explicit and can collapse redundant systematic cells", () => {
  const base = {
    schemaVersion: 1,
    storyIds: ["the-intercept-20"],
    algorithms: ["random", "systematic"],
    searchSeeds: [1, 2],
    budgets: [10],
    storySeed: 1,
  };
  assert.throws(() => plannedMutantCells(base), /deterministicReplication/);
  const plan = plannedMutantCells({ ...base, deterministicReplication: "single" });
  assert.equal(plan.filter((cell) => cell.request.algorithm === "random").length, 2);
  assert.equal(plan.filter((cell) => cell.request.algorithm === "systematic").length, 1);
});

test("the Intercept derivative is isolated from the clean authored corpus", () => {
  const clean = loadAuthoredFixture("the-intercept");
  const stories = listAuthoredPlantedStories();
  assert.deepEqual(stories.map((story) => story.id), ["the-intercept-20", "heresy2-30"]);
  const fixture = loadAuthoredPlantedFixture("the-intercept-20");
  assert.equal(clean.tier, "authored-project");
  assert.equal(clean.manifest.bugs.length, 0);
  assert.equal(fixture.tier, "authored-planted");
  assert.equal(fixture.manifest.bugs.length, 20);
  assert.equal(new Set(fixture.manifest.bugs.map((bug) => bug.faultType)).size, 19);
  assert.equal(new Set(fixture.manifest.bugs.map((bug) => bug.site.knot)).size, 16);
  assert.equal(new Set(fixture.manifest.bugs.map((bug) => bug.site.file)).size, 4);
  assert.equal(Object.keys(fixture.sourceBundle.files).length, 5);
  assert.equal(JSON.parse(fixture.compiledStory).inkVersion, 21);
  assert.notEqual(fixture.source, clean.source);
  const controller = new InstrumentedController(fixture, 1, 1);
  assert.ok(Object.keys(controller.launch().variables).every((name) => !name.startsWith("inkbench_bug_")));
});

test("the Heresy II derivative is isolated from the clean authored corpus", () => {
  const clean = loadAuthoredFixture("heresy2");
  const fixture = loadAuthoredPlantedFixture("heresy2-30");
  assert.equal(clean.manifest.bugs.length, 0);
  assert.equal(fixture.tier, "authored-planted");
  assert.equal(fixture.manifest.family, "stitch-heavy-random-authored-story");
  assert.equal(fixture.manifest.difficulty, 10);
  assert.equal(fixture.manifest.bugs.length, 30);
  assert.equal(new Set(fixture.manifest.bugs.map((bug) => bug.faultType)).size, 14);
  assert.equal(new Set(fixture.manifest.bugs.map((bug) => bug.site.knot)).size, 30);
  assert.equal(new Set(fixture.manifest.bugs.map((bug) => bug.site.file)).size, 5);
  assert.equal(Object.keys(fixture.sourceBundle.files).length, 21);

  // Unlike the single-file Intercept derivative, Heresy II is a 21-file story whose
  // entrypoint is deliberately left untouched: the 30 defects live in five narrative
  // files plus globals. Isolation therefore means "the bundle differs", not "the
  // entrypoint differs" -- asserting the latter would be false by construction.
  const mutated = Object.keys(fixture.sourceBundle.files).filter(
    (name) => fixture.sourceBundle.files[name] !== clean.sourceBundle.files[name],
  );
  assert.deepEqual(mutated.sort(), ["base.ink", "debrief.ink", "garden.ink", "globals.ink", "temple.ink", "workshop.ink"]);
  assert.equal(fixture.source, clean.source, "the shared entrypoint is intentionally unmutated");
  assert.equal(new Set(fixture.manifest.bugs.map((bug) => bug.site.file)).size, 5);

  const controller = new InstrumentedController(fixture, 1, 1);
  assert.ok(Object.keys(controller.launch().variables).every((name) => !name.startsWith("inkbench_bug_")));
});

test("authored-planted matrices support isolated resumable execution", async () => {
  const output = mkdtempSync(join(tmpdir(), "inkbench-mutants-isolated-test-"));
  const config = {
    schemaVersion: 1,
    storyIds: ["the-intercept-20"],
    algorithms: ["random"],
    searchSeeds: [3],
    budgets: [10],
    storySeed: 1,
  };
  try {
    const first = await runMutantExperimentIsolated(config, { outputDirectory: output, heapLimitMb: 256 });
    const resumed = await runMutantExperimentIsolated(config, { outputDirectory: output, heapLimitMb: 256, resume: true });
    assert.equal(first.runs.length, 1);
    assert.equal(first.runs[0].benchmarkTier, "authored-planted");
    assert.equal(resumed.runs[0].runId, first.runs[0].runId);
    assert.equal(JSON.parse(readFileSync(join(output, "matrix-state.json"), "utf8")).status, "complete");
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("every planted bug in every authored-planted story has an exact replayable witness", () => {
  let replayed = 0;
  for (const story of listAuthoredPlantedStories()) {
  const fixture = loadAuthoredPlantedFixture(story.id);
  const recorded = loadAuthoredPlantedWitnesses(story.id);
  assert.deepEqual(Object.keys(recorded.witnesses).sort(), fixture.manifest.bugs.map((bug) => bug.id).sort());
  for (const bug of fixture.manifest.bugs) {
    const witness = recorded.witnesses[bug.id];
    assert.ok(witness, bug.id);
    const controller = new InstrumentedController(fixture, witness.choicePath.length + 1, 1);
    let observation = controller.launch();
    for (let index = 0; index < witness.choicePath.length; index += 1) {
      const choiceIndex = witness.choicePath[index];
      assert.equal(observation.choices[choiceIndex]?.text, witness.choiceTextPath[index], `${bug.id} choice ${index}`);
      observation = controller.step(choiceIndex).after;
    }
    assert.ok(controller.bugDiscoveries.some((discovery) => discovery.bugId === bug.id), `${story.id} ${bug.id}`);
    replayed += 1;
  }
  }
  // 20 Intercept + 30 Heresy II: every planted bug is reachable by its own oracle.
  assert.equal(replayed, 50);
});

test("authored-planted experiments score bug yield, per-bug competence, and complementarity", () => {
  const result = runMutantExperiment({
    schemaVersion: 1,
    storyIds: ["the-intercept-20"],
    algorithms: ["random", "systematic", "coverage", "swarm"],
    searchSeeds: [1],
    budgets: [100],
    storySeed: 1,
  });
  assert.equal(result.runs.length, 4);
  assert.ok(result.runs.every((run) => run.benchmarkTier === "authored-planted" && run.plantedBugIds.length === 20));
  assert.equal(result.summary.benchmarkTier, "authored-planted");
  assert.equal(result.summary.bugYield.length, 4);
  assert.equal(result.summary.perBug.length, 80);
  assert.equal(result.summary.complementarity[0].pairedRuns, 1);
  assert.equal(result.summary.complementarity[0].bugOpportunities, 20);
  assert.ok(result.summary.bugYield.every((cell) => cell.meanBugsDiscovered > 0 && cell.meanBugsDiscovered < 20));
  const stopped = {
    ...result.runs[0],
    status: "resource-stopped",
    stopReason: "memory",
    discoveredBugs: [],
  };
  const stoppedSummary = summarizeMutantRuns([stopped], {
    schemaVersion: 1,
    storyIds: ["the-intercept-20"],
    algorithms: [stopped.algorithm],
    searchSeeds: [stopped.searchSeed],
    budgets: [stopped.budget.limit],
    storySeed: stopped.storySeed,
  }, "fixed");
  assert.deepEqual(stoppedSummary.bugYield[0].probabilityAnyResourceStopSensitivity, { lower: 0, upper: 1 });
  assert.deepEqual(stoppedSummary.perBug[0].resourceStopSensitivity, { lower: 0, upper: 1 });

  const output = mkdtempSync(join(tmpdir(), "inkbench-mutants-test-"));
  try {
    writeMutantExperiment(output, result);
    assert.match(readFileSync(join(output, "summary.md"), "utf8"), /Per-bug competence map/);
    assert.equal(readFileSync(join(output, "runs.ndjson"), "utf8").trim().split("\n").length, 4);
    assert.equal(JSON.parse(readFileSync(join(output, "corpus-manifest.json"), "utf8")).cases[0].bugs.length, 20);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
