import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  listAuthoredStories,
  loadAuthoredFixture,
  runAuthoredExperiment,
  runBenchmark,
  writeAuthoredExperiment,
} from "../dist/index.js";

test("authored corpus is pinned, licensed, and separated from planted fixtures", () => {
  const stories = listAuthoredStories();
  assert.deepEqual(stories.map((story) => story.id), ["dog-ink-adventure", "the-intercept", "heresy2"]);
  for (const story of stories) {
    const fixture = loadAuthoredFixture(story.id);
    assert.equal(fixture.tier, "authored-project");
    assert.equal(fixture.manifest.bugs.length, 0);
    assert.equal(fixture.manifest.source.commit, story.source.commit);
    assert.ok(fixture.manifest.locations.length > 0);
    assert.ok(Object.keys(fixture.sourceBundle.files).length > 0);
  }
});

test("all authored stories compile and run through the shared instrumented controller", () => {
  for (const story of listAuthoredStories()) {
    const report = runBenchmark({
      fixture: loadAuthoredFixture(story.id),
      algorithm: "systematic",
      searchSeed: 1,
      storySeed: 1,
      budget: 10,
    });
    assert.equal(report.status, "completed", `${story.id}: ${report.error ?? ""}`);
    assert.equal(report.benchmarkTier, "authored-project");
    assert.deepEqual(report.plantedBugIds, []);
    assert.ok(report.counts.transitions <= 10);
    assert.ok(report.coverageItems);
  }
});

test("authored story search is deterministic apart from timing", () => {
  const fixture = loadAuthoredFixture("heresy2");
  const request = { fixture, algorithm: "coverage", searchSeed: 9, storySeed: 3, budget: 50 };
  const first = runBenchmark(request);
  const second = runBenchmark(request);
  assert.equal(first.status, "completed");
  assert.deepEqual(second.counts, first.counts);
  assert.deepEqual(second.coverage, first.coverage);
  assert.deepEqual(second.coverageItems, first.coverageItems);
  assert.deepEqual(second.runtimeFindings, first.runtimeFindings);
});

test("authored experiments emit separate coverage and complementarity reports", () => {
  const result = runAuthoredExperiment({
    schemaVersion: 1,
    storyIds: ["the-intercept"],
    algorithms: ["random", "coverage"],
    searchSeeds: [1],
    budgets: [20],
    storySeed: 1,
  });
  assert.equal(result.runs.length, 2);
  assert.equal(result.summary.benchmarkTier, "authored-project");
  assert.equal(result.summary.coverage.length, 2);
  assert.equal(result.summary.complementarity[0].pairedRuns, 1);
  assert.match(result.summary.interpretation, /no planted oracle/i);

  const output = mkdtempSync(join(tmpdir(), "inkbench-corpus-test-"));
  try {
    writeAuthoredExperiment(output, result);
    assert.match(readFileSync(join(output, "summary.md"), "utf8"), /must not be pooled with planted-bug yield/i);
    assert.equal(readFileSync(join(output, "runs.ndjson"), "utf8").trim().split("\n").length, 2);
    assert.equal(JSON.parse(readFileSync(join(output, "corpus-manifest.json"), "utf8")).cases.length, 3);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
