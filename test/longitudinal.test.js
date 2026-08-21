import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  generateRevisionSequence,
  InstrumentedController,
  runLongitudinalExperiment,
} from "../dist/index.js";

function config(overrides = {}) {
  return {
    schemaVersion: 1,
    sequenceSeeds: [1],
    partition: "development",
    revisions: 12,
    arms: ["cold-coverage", "warm-coverage", "periodic-coverage", "persistent-swarm", "persistent-swarm-no-rogue"],
    perRevisionBudget: 80,
    storySeed: 1,
    maxRoutes: 24,
    maxCorpusBytes: 100_000,
    rogueFraction: 0.15,
    periodicRebuildEvery: 4,
    ...overrides,
  };
}

function stableCell(cell) {
  const { wallMs, cpuMs, retainedByteMs, ...stable } = cell;
  return stable;
}

test("revision streams are deterministic, parent-linked, partitioned, and compilable", () => {
  const first = generateRevisionSequence(1, "development", 12);
  const second = generateRevisionSequence(1, "development", 12);
  assert.deepEqual(second, first);
  assert.equal(first[0].parentRevisionId, null);
  assert.equal(first[11].parentRevisionId, first[10].revisionId);
  assert.deepEqual(first.map((revision) => revision.editClass), [
    "baseline", "text-only", "side-branch", "threshold-change", "delayed-bug-introduction", "choice-reorder",
    "rare-history", "bug-fix", "revisit-bug-introduction", "local-refactor", "broad-refactor-negative-control", "bug-reintroduction",
  ]);
  assert.equal(first[7].activeBugIds.length, 0);
  assert.equal(first[11].activeBugIds[0], first[4].activeBugIds[0]);
  for (const revision of first) {
    const controller = new InstrumentedController(revision.fixture, 2, 1);
    assert.ok(controller.launch().choices.length > 0);
  }
  assert.throws(() => generateRevisionSequence(1, "evaluation", 1), /evaluation fixture seeds/);
  const extended = generateRevisionSequence(1, "development", 30);
  assert.equal(extended.length, 30);
  const finalController = new InstrumentedController(extended[29].fixture, 2, 1);
  assert.ok(finalController.launch().choices.length > 0);
  const structuralProfiles = new Set([1, 2, 3].map((seed) => {
    const parameters = generateRevisionSequence(seed, "development", 1)[0].fixture.manifest.parameters;
    return `${parameters.keepsakeCount}:${parameters.corridorLength}`;
  }));
  assert.ok(structuralProfiles.size >= 2, "sequence seeds must create more than identity-only replication");
});

test("persistent longitudinal decisions and route corpora are deterministic apart from timing", () => {
  const chosen = config({ revisions: 6, perRevisionBudget: 50, arms: ["warm-coverage", "persistent-swarm", "persistent-swarm-no-rogue"] });
  const first = runLongitudinalExperiment(chosen, { generatedAt: "fixed" });
  const second = runLongitudinalExperiment(chosen, { generatedAt: "fixed" });
  assert.deepEqual(second.cells.map(stableCell), first.cells.map(stableCell));
  assert.ok(first.cells.some((cell) => cell.replayTransitions > 0));
  assert.ok(first.cells.every((cell) => cell.transitions <= cell.budget));
  assert.ok(first.cells.every((cell) => cell.replayTransitions + cell.explorationTransitions === cell.transitions));
  assert.ok(first.cells.every((cell) => cell.corpusRoutes <= chosen.maxRoutes));
  assert.ok(first.cells.every((cell) => cell.corpusBytes <= chosen.maxCorpusBytes));
  assert.ok(first.cells.every((cell) => cell.peakCorpusRoutes <= chosen.maxRoutes));
  assert.ok(first.cells.every((cell) => cell.peakCorpusBytes <= chosen.maxCorpusBytes));
  assert.doesNotMatch(JSON.stringify(first.cells.map((cell) => cell.corpusState)), /variablesState|ib_regression|activeBugIds/);
  assert.ok(first.cells.filter((cell) => cell.arm === "persistent-swarm-no-rogue").every((cell) => cell.rootRogueLaunches === 0));
});

test("broad refactors retain honest route-divergence evidence and periodic controls rebuild", () => {
  const result = runLongitudinalExperiment(config({ arms: ["periodic-coverage", "persistent-swarm"], perRevisionBudget: 60 }), { generatedAt: "fixed" });
  const broad = result.cells.find((cell) => cell.arm === "persistent-swarm" && cell.revision === 10);
  assert.ok(broad);
  assert.ok(broad.replayFailures > 0);
  assert.equal(result.cells.find((cell) => cell.arm === "periodic-coverage" && cell.revision === 4).rebuiltBeforeRevision, true);
  assert.equal(result.cells.find((cell) => cell.arm === "periodic-coverage" && cell.revision === 8).rebuiltBeforeRevision, true);
});

test("longitudinal break-even waits for a nonzero cold-coverage bug opportunity", () => {
  const result = runLongitudinalExperiment(config({ revisions: 5, arms: ["cold-coverage", "warm-coverage"], perRevisionBudget: 80 }), { generatedAt: "fixed" });
  const warm = result.summary.arms.find((arm) => arm.arm === "warm-coverage");
  assert.ok(warm);
  assert.ok(warm.breakEvenRevisionVersusColdCoverage === null || warm.breakEvenRevisionVersusColdCoverage >= 4);
});

test("longitudinal cell output resumes without duplicates and witnesses replay on exact revisions", () => {
  const output = mkdtempSync(join(tmpdir(), "inkbench-longitudinal-"));
  try {
    const chosen = config({ revisions: 6, arms: ["cold-systematic", "warm-coverage"], perRevisionBudget: 120 });
    const first = runLongitudinalExperiment(chosen, { outputDirectory: output, generatedAt: "fixed" });
    const resumed = runLongitudinalExperiment(chosen, { outputDirectory: output, resume: true, generatedAt: "fixed" });
    assert.equal(resumed.cells.length, first.cells.length);
    assert.equal(new Set(resumed.cells.map((cell) => cell.cellId)).size, resumed.cells.length);
    assert.equal(readFileSync(join(output, "runs.ndjson"), "utf8").trim().split("\n").length, first.cells.length);
    const discoveryCell = first.cells.find((cell) => cell.discoveries.length > 0);
    assert.ok(discoveryCell, "expected the deterministic calibration arm to discover a revision bug");
    const revision = first.revisions.find((candidate) => candidate.revisionId === discoveryCell.revisionId);
    const discovery = discoveryCell.discoveries[0];
    const controller = new InstrumentedController(revision.fixture, discovery.choicePath.length + 1, chosen.storySeed);
    let observation = controller.launch();
    for (const choiceIndex of discovery.choicePath) observation = controller.step(choiceIndex).after;
    assert.ok(controller.bugDiscoveries.some((candidate) => candidate.bugId === discovery.bugId));
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
