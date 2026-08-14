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
  runMutantExperiment,
  runMutantExperimentIsolated,
  writeMutantExperiment,
} from "../dist/index.js";

test("the Intercept derivative is isolated from the clean authored corpus", () => {
  const clean = loadAuthoredFixture("the-intercept");
  const stories = listAuthoredPlantedStories();
  assert.deepEqual(stories.map((story) => story.id), ["the-intercept-20"]);
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

test("every planted Intercept bug has an exact replayable witness", () => {
  const fixture = loadAuthoredPlantedFixture("the-intercept-20");
  const recorded = loadAuthoredPlantedWitnesses("the-intercept-20");
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
    assert.ok(controller.bugDiscoveries.some((discovery) => discovery.bugId === bug.id), bug.id);
  }
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
