import assert from "node:assert/strict";
import test from "node:test";
import { BUG_FAMILIES, InstrumentedController, generateFixture, runBenchmark } from "../dist/index.js";

test("every v0.1 fixture family is deterministic and compiles", () => {
  for (const family of BUG_FAMILIES) {
    const first = generateFixture(family, 17, 2);
    const second = generateFixture(family, 17, 2);
    assert.deepEqual(second, first, family);
    const report = runBenchmark({ fixture: first, algorithm: "systematic", searchSeed: 3, storySeed: 1, budget: 1 });
    assert.equal(report.status, "completed", `${family}: ${report.error ?? ""}`);
    assert.equal(report.counts.transitions, 1, family);
  }
});

test("difficulty coordinates and manifest IDs are stable", () => {
  const easy = generateFixture("combination-lock", 4, 1);
  const hard = generateFixture("combination-lock", 4, 4);
  assert.equal(easy.manifest.fixtureId, "combination-lock-d1-s4");
  assert.equal(hard.manifest.fixtureId, "combination-lock-d4-s4");
  assert.ok(hard.manifest.dimensions.stateDimensionality > easy.manifest.dimensions.stateDimensionality);
  assert.ok(hard.manifest.dimensions.rarity > easy.manifest.dimensions.rarity);
});

test("a reported witness replays the planted oracle exactly", () => {
  const fixture = generateFixture("shallow-obvious", 9, 2);
  const report = runBenchmark({ fixture, algorithm: "systematic", searchSeed: 1, storySeed: 1, budget: 50 });
  const discovery = report.discoveredBugs[0];
  assert.ok(discovery, "systematic control should find the shallow bug");
  const controller = new InstrumentedController(fixture, discovery.choicePath.length, 1);
  let observation = controller.launch();
  for (const choiceIndex of discovery.choicePath) {
    assert.ok(observation.choices[choiceIndex]);
    observation = controller.step(choiceIndex).after;
  }
  assert.ok(observation.events.some((event) => event.kind === "bug" && event.value === discovery.bugId));
  assert.equal(observation.location, "bug");
});
