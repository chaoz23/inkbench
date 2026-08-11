import assert from "node:assert/strict";
import test from "node:test";
import { generateFixture, runBenchmark } from "../dist/index.js";

const algorithms = ["random", "systematic", "coverage", "swarm-novelty", "swarm-colony", "swarm"];

test("all in-process strategies obey the transition ceiling", () => {
  const fixture = generateFixture("loop-count", 3, 2);
  for (const algorithm of algorithms) {
    const report = runBenchmark({ fixture, algorithm, searchSeed: 11, storySeed: 1, budget: 37 });
    assert.equal(report.status, "completed", `${algorithm}: ${report.error ?? ""}`);
    assert.ok(report.counts.transitions <= 37, algorithm);
    assert.ok(report.counts.launches >= 1, algorithm);
    assert.equal(report.budget.unit, "choice-transitions");
  }
});

test("search decisions are deterministic apart from timing", () => {
  const fixture = generateFixture("combination-lock", 3, 2);
  for (const algorithm of algorithms) {
    const first = runBenchmark({ fixture, algorithm, searchSeed: 7, storySeed: 1, budget: 250 });
    const second = runBenchmark({ fixture, algorithm, searchSeed: 7, storySeed: 1, budget: 250 });
    assert.deepEqual(second.counts, first.counts, algorithm);
    assert.deepEqual(second.coverage, first.coverage, algorithm);
    assert.deepEqual(
      second.discoveredBugs.map(({ elapsedMs: _elapsed, cpuMs: _cpu, ...rest }) => rest),
      first.discoveredBugs.map(({ elapsedMs: _elapsed, cpuMs: _cpu, ...rest }) => rest),
      algorithm,
    );
  }
});

test("systematic and coverage controls find an order-only bug", () => {
  const fixture = generateFixture("order-dependent", 2, 2);
  for (const algorithm of ["systematic", "coverage"]) {
    const report = runBenchmark({ fixture, algorithm, searchSeed: 5, storySeed: 1, budget: 500 });
    assert.equal(report.status, "completed");
    assert.equal(report.discoveredBugs.length, 1, algorithm);
  }
});

test("colony swarm variants prove closure on a small finite semantic graph", () => {
  const fixture = generateFixture("shallow-obvious", 1, 1);
  for (const algorithm of ["swarm-colony", "swarm"]) {
    const report = runBenchmark({ fixture, algorithm, searchSeed: 7, storySeed: 1, budget: 500 });
    assert.equal(report.status, "completed", algorithm);
    assert.equal(report.stopReason, "search-exhausted", algorithm);
    assert.ok(report.counts.transitions < 500, algorithm);
    assert.equal(report.discoveredBugs.length, 1, algorithm);
    assert.match(report.notes.join("\n"), /every choice from every retained-or-fully-retired semantic colony/, algorithm);
  }
});
