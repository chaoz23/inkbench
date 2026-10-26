import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertMatrixIdentity,
  assertSummarizableRuns,
  auditGeneratedMatrix,
  benchmarkRunId,
  executionFingerprint,
  executionFingerprintDigest,
  generateFixture,
  plannedExperimentCells,
  runBenchmark,
  summarizeAuthoredRuns,
  summarizeMutantRuns,
  summarizeRuns,
} from "../dist/index.js";
import { hash } from "../dist/core/hash.js";

const config = {
  schemaVersion: 1,
  families: ["shallow-obvious"],
  algorithms: ["inkcheck"],
  fixtureSeeds: [1],
  searchSeeds: [7],
  budgets: [25],
  difficulty: 1,
  storySeed: 1,
};

function nativeTelemetry() {
  return {
    schemaVersion: 1,
    phases: {
      setupMs: 8, compilationMs: 7, sourceScanMs: 1, searchActiveMs: 12,
      minimumReproductionMs: 0, checkpointWriteMs: 0, checkpointReopenMs: 0,
      replayScoringMs: 2, reportEnrichmentMs: 1, reportWriteMs: 0, finalizationMs: 3,
    },
    passes: [],
  };
}

function externalReport() {
  const fixture = generateFixture("shallow-obvious", 1, 1);
  const request = { fixture, algorithm: "inkcheck", searchSeed: 7, storySeed: 1, budget: 25 };
  const base = runBenchmark({ ...request, algorithm: "random" });
  const fingerprint = executionFingerprint(request);
  return {
    ...base,
    runId: benchmarkRunId(request, fingerprint),
    algorithm: "inkcheck",
    algorithmVersion: "test-native",
    executionFingerprint: fingerprint,
    discoveredBugs: [],
    timing: {
      ...base.timing,
      wallMs: 500,
      cpuMs: null,
      externalProcessWallMs: 300,
      phases: { ...base.timing.phases, compileLoadMs: 7, searchMs: 12, replayScoringMs: 19, finalizationMs: 4 },
    },
    resources: {
      ...base.resources,
      provenance: "external-adapter",
      longRunTelemetry: nativeTelemetry(),
    },
  };
}

function roundtrip(value) { return JSON.parse(JSON.stringify(value)); }

function writeMatrix(directory, report) {
  const scheduledRunIds = plannedExperimentCells(config).map((cell) => cell.runId);
  assert.deepEqual(scheduledRunIds, [report.runId]);
  mkdirSync(join(directory, "cells"), { recursive: true });
  writeFileSync(join(directory, "config.json"), JSON.stringify(config));
  writeFileSync(join(directory, "cells", `${report.runId}.json`), JSON.stringify(report));
  writeFileSync(join(directory, "matrix-state.json"), JSON.stringify({
    schemaVersion: 2,
    status: "complete",
    config,
    completedCells: 1,
    totalCells: 1,
    runIds: scheduledRunIds,
    scheduledRunIds,
    experimentFingerprint: hash({ config, scheduledRunIds }, 64),
  }));
}

test("durable native cost remains pass-local and wrapper/native phases remain distinct", () => {
  const report = roundtrip(externalReport());
  const before = roundtrip(report);
  assert.doesNotThrow(() => assertSummarizableRuns([report]));
  const summary = summarizeRuns([report], config);
  assert.equal(summary.totalRuns, 1);
  assert.equal(report.timing.phases.searchMs, report.resources.longRunTelemetry.phases.searchActiveMs);
  assert.equal(report.timing.phases.compileLoadMs, report.resources.longRunTelemetry.phases.compilationMs);
  assert.equal(report.timing.externalProcessWallMs, 300);
  assert.equal(report.timing.phases.replayScoringMs, 19);
  assert.equal(report.resources.longRunTelemetry.phases.replayScoringMs, 2);
  assert.equal(report.timing.phases.finalizationMs, 4);
  assert.equal(report.resources.longRunTelemetry.phases.finalizationMs, 3);
  assert.deepEqual(report, before, "summary validation must not rewrite durable native observations");
});

test("legacy reports without additive telemetry or external wall retain their recorded values", () => {
  const legacy = externalReport();
  const { digest: _digest, ...fields } = legacy.executionFingerprint;
  const legacyFields = { ...fields, algorithmVersion: "external-adapter-v4" };
  legacy.executionFingerprint = { ...legacyFields, digest: executionFingerprintDigest(legacyFields) };
  legacy.runId = benchmarkRunId({
    fixture: generateFixture("shallow-obvious", 1, 1), algorithm: "inkcheck", searchSeed: 7, storySeed: 1, budget: 25,
  }, legacy.executionFingerprint);
  delete legacy.resources.longRunTelemetry;
  delete legacy.timing.externalProcessWallMs;
  legacy.timing.phases.searchMs = 300;
  legacy.timing.phases.compileLoadMs = null;
  const durable = roundtrip(legacy);
  assert.doesNotThrow(() => assertSummarizableRuns([durable]));
  assert.equal(summarizeRuns([durable], config).totalRuns, 1);
  assert.equal(durable.timing.phases.searchMs, 300, "historical whole-child timings are not reconstructed");
  assert.equal(Object.hasOwn(durable.resources, "longRunTelemetry"), false);
  assert.equal(Object.hasOwn(durable.timing, "externalProcessWallMs"), false);
});

test("v6 reports from legacy CLIs leave unsupported native phases null", () => {
  const report = externalReport();
  delete report.resources.longRunTelemetry;
  report.timing.phases.searchMs = null;
  report.timing.phases.compileLoadMs = null;
  assert.doesNotThrow(() => assertSummarizableRuns([roundtrip(report)]));
  assert.equal(report.timing.externalProcessWallMs, 300);
  report.resources = null;
  assert.doesNotThrow(() => assertSummarizableRuns([roundtrip(report)]));
});

test("unpublished adapter-v5 historical whole-child labels remain readable", () => {
  const legacy = externalReport();
  const { digest: _digest, ...fields } = legacy.executionFingerprint;
  const legacyFields = { ...fields, algorithmVersion: "external-adapter-v5" };
  legacy.executionFingerprint = { ...legacyFields, digest: executionFingerprintDigest(legacyFields) };
  legacy.runId = benchmarkRunId({
    fixture: generateFixture("shallow-obvious", 1, 1), algorithm: "inkcheck", searchSeed: 7, storySeed: 1, budget: 25,
  }, legacy.executionFingerprint);
  delete legacy.resources.longRunTelemetry;
  delete legacy.timing.externalProcessWallMs;
  legacy.timing.phases.searchMs = 300;
  legacy.timing.phases.compileLoadMs = null;
  const durable = roundtrip(legacy);
  assert.doesNotThrow(() => assertSummarizableRuns([durable]));
  assert.equal(summarizeRuns([durable], config).totalRuns, 1);
  assert.equal(durable.timing.phases.searchMs, 300);
});

test("durable summary boundaries reject malformed native ledgers, provenance, and mapped phases", () => {
  const mutations = [
    ["present null ledger", (run) => { run.resources.longRunTelemetry = null; }],
    ["unsafe native duration", (run) => { run.resources.longRunTelemetry.phases.searchActiveMs = Number.MAX_SAFE_INTEGER + 1; }],
    ["private source field", (run) => { run.resources.longRunTelemetry.phases.storyText = "private story"; }],
    ["nonexternal provenance", (run) => { run.resources.provenance = "inkbench-worker"; }],
    ["non-InkCheck algorithm", (run) => { run.algorithm = "random"; }],
    ["whole-child search label", (run) => { run.timing.phases.searchMs = run.timing.externalProcessWallMs; }],
    ["invented compilation label", (run) => { run.timing.phases.compileLoadMs = null; }],
    ["deleted receipt with native phases", (run) => { delete run.resources.longRunTelemetry; }],
    ["missing receipt with unsupported search", (run) => { delete run.resources.longRunTelemetry; run.timing.phases.compileLoadMs = null; }],
    ["missing receipt with unsupported compilation", (run) => { delete run.resources.longRunTelemetry; run.timing.phases.searchMs = null; }],
    ["negative external wall", (run) => { run.timing.externalProcessWallMs = -1; }],
    ["null external wall", (run) => { run.timing.externalProcessWallMs = null; }],
    ["nonfinite external wall", (run) => { run.timing.externalProcessWallMs = Infinity; }],
  ];
  for (const [label, mutate] of mutations) {
    const report = externalReport();
    mutate(report);
    const durable = roundtrip(report);
    assert.throws(() => assertSummarizableRuns([durable]), /invalid telemetry/, label);
    assert.throws(() => summarizeRuns([durable], config), /invalid telemetry/, label);
  }
  const undefinedLedger = externalReport();
  undefinedLedger.resources.longRunTelemetry = undefined;
  assert.throws(() => assertSummarizableRuns([undefinedLedger]), /invalid telemetry/);
});

test("authored and authored-planted summaries share durable native-ledger validation", () => {
  const report = roundtrip(externalReport());
  report.resources.longRunTelemetry = null;
  const authoredConfig = { schemaVersion: 1, storyIds: ["dog-ink-adventure"], algorithms: ["inkcheck"], searchSeeds: [7], budgets: [25], storySeed: 1 };
  const mutantConfig = { ...authoredConfig, storyIds: ["the-intercept-20"] };
  assert.throws(() => summarizeAuthoredRuns([report], authoredConfig), /invalid telemetry/);
  assert.throws(() => summarizeMutantRuns([report], mutantConfig), /invalid telemetry/);
});

test("durable matrix audit reports invalid telemetry and does not promote it", () => {
  const directory = mkdtempSync(join(tmpdir(), "inkbench-native-cost-audit-"));
  try {
    const report = externalReport();
    writeMatrix(directory, report);
    const valid = auditGeneratedMatrix(directory);
    assert.equal(valid.promotionEligible, true);
    assert.ok(valid.findings.some((finding) => finding.code === "native-cost-no-pass-observations" && finding.severity === "information"));

    const cellPath = join(directory, "cells", `${report.runId}.json`);
    const tampered = JSON.parse(readFileSync(cellPath, "utf8"));
    tampered.resources.longRunTelemetry = null;
    writeFileSync(cellPath, JSON.stringify(tampered));
    const invalid = auditGeneratedMatrix(directory);
    assert.equal(invalid.promotionEligible, false);
    assert.ok(invalid.findings.some((finding) => finding.code === "invalid-telemetry" && finding.severity === "error" && finding.runId === report.runId));

    delete tampered.resources.longRunTelemetry;
    writeFileSync(cellPath, JSON.stringify(tampered));
    const unsupportedPhases = auditGeneratedMatrix(directory);
    assert.equal(unsupportedPhases.promotionEligible, false);
    assert.ok(unsupportedPhases.findings.some((finding) => finding.code === "invalid-telemetry" && /must be null/.test(finding.message)));

    delete tampered.timing.externalProcessWallMs;
    tampered.timing.phases.searchMs = null;
    tampered.timing.phases.compileLoadMs = null;
    writeFileSync(cellPath, JSON.stringify(tampered));
    const legacy = auditGeneratedMatrix(directory);
    assert.equal(legacy.promotionEligible, true, "missing observational cost is informational, not a new scientific promotion gate");
    assert.ok(legacy.findings.some((finding) => finding.code === "native-cost-unavailable" && finding.severity === "information"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("new external phase semantics change fingerprints and refuse old/new pooling or matrix resume", () => {
  const report = externalReport();
  assert.equal(report.executionFingerprint.algorithmVersion, "external-adapter-v6");
  const { digest: _digest, ...fields } = report.executionFingerprint;
  const oldFields = { ...fields, algorithmVersion: "external-adapter-v4" };
  const legacyFingerprint = { ...oldFields, digest: executionFingerprintDigest(oldFields) };
  const fixture = generateFixture("shallow-obvious", 1, 1);
  const request = { fixture, algorithm: "inkcheck", searchSeed: 7, storySeed: 1, budget: 25 };
  const legacyRunId = benchmarkRunId(request, legacyFingerprint);
  assert.notEqual(legacyRunId, report.runId);
  const legacy = { ...roundtrip(report), runId: legacyRunId, executionFingerprint: legacyFingerprint };
  delete legacy.resources.longRunTelemetry;
  delete legacy.timing.externalProcessWallMs;
  legacy.timing.phases.searchMs = 300;
  assert.throws(() => assertSummarizableRuns([legacy, report]), /executionFingerprint differs/);
  assert.throws(() => assertMatrixIdentity(
    { schemaVersion: 2, config, experimentFingerprint: "old", scheduledRunIds: [legacyRunId] },
    { schemaVersion: 2, config, experimentFingerprint: "new", scheduledRunIds: [report.runId] },
    "telemetry bridge matrix",
  ), /experimentFingerprint differs/);
});
