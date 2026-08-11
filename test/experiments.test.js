import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runExperiment, writeExperiment } from "../dist/index.js";

test("experiment output preserves raw runs, probability, survival, and complementarity", () => {
  const config = {
    schemaVersion: 1,
    families: ["shallow-obvious", "deep-corridor"],
    algorithms: ["random", "systematic"],
    fixtureSeeds: [1, 2],
    searchSeeds: [1, 2],
    budgets: [40],
    difficulty: 1,
    storySeed: 1,
  };
  const result = runExperiment(config);
  assert.equal(result.runs.length, 16);
  assert.equal(result.summary.probability.length, 4);
  assert.ok(result.summary.survival.length >= 4);
  assert.equal(result.summary.complementarity.length, 2);
  assert.ok(result.summary.complementarity.every((cell) => cell.runsCompared === 4));

  const output = mkdtempSync(join(tmpdir(), "inkbench-test-"));
  try {
    writeExperiment(output, result);
    const raw = readFileSync(join(output, "runs.ndjson"), "utf8").trim().split("\n");
    assert.equal(raw.length, 16);
    assert.match(readFileSync(join(output, "summary.md"), "utf8"), /Competence map/);
    assert.ok(readFileSync(join(output, "fixtures", "shallow-obvious-d1-s1.ink"), "utf8").includes("INKBENCH_BUG"));
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
