import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fixtureSourceHash, hash, stableJson } from "../core/hash.js";
import { InstrumentedController } from "../core/runtime.js";
import type { ExperimentConfig, RunReport } from "../core/types.js";
import { assertSummarizableRuns } from "../core/validation.js";
import { generateFixture } from "../fixtures/generate.js";
import { plannedExperimentCells } from "./run.js";

export interface MatrixAuditFinding {
  severity: "error" | "review" | "information";
  code: string;
  message: string;
  runId: string | null;
}

export interface MatrixAuditReport {
  schemaVersion: 1;
  artifactDirectory: string;
  matrixComplete: boolean;
  canonicalCells: number;
  scheduledCells: number;
  duplicateRunIds: number;
  resourceStops: number;
  adapterFailures: number;
  witnessReplays: number;
  witnessReplayFailures: number;
  promotionEligible: boolean;
  findings: MatrixAuditFinding[];
}

export function auditGeneratedMatrix(artifactDirectory: string): MatrixAuditReport {
  const statePath = join(artifactDirectory, "matrix-state.json");
  const configPath = join(artifactDirectory, "config.json");
  if (!existsSync(statePath) || !existsSync(configPath)) throw new Error("matrix audit requires matrix-state.json and config.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    schemaVersion?: number;
    status?: string;
    completedCells?: number;
    totalCells?: number;
    config?: unknown;
    runIds?: string[];
    experimentFingerprint?: string;
    scheduledRunIds?: string[];
  };
  const config = JSON.parse(readFileSync(configPath, "utf8")) as ExperimentConfig;
  const cellsDirectory = join(artifactDirectory, "cells");
  const reportFiles = existsSync(cellsDirectory)
    ? readdirSync(cellsDirectory).filter((name) => name.endsWith(".json")).sort().map((name) => ({ name, report: JSON.parse(readFileSync(join(cellsDirectory, name), "utf8")) as RunReport }))
    : [];
  const reports = reportFiles.map(({ report }) => report);
  const findings: MatrixAuditFinding[] = [];
  const add = (severity: MatrixAuditFinding["severity"], code: string, message: string, runId: string | null = null) => findings.push({ severity, code, message, runId });
  try { assertSummarizableRuns(reports); } catch (error) { add("error", "run-identity", error instanceof Error ? error.message : String(error)); }
  const ids = reports.map((report) => report.runId);
  const duplicates = ids.length - new Set(ids).size;
  if (duplicates > 0) add("error", "duplicate-run-id", `${duplicates} duplicate run IDs`);
  if (state.schemaVersion !== 2) add("error", "matrix-schema", `expected matrix schema 2, received ${state.schemaVersion ?? "missing"}`);
  if (state.status !== "complete") add("review", "matrix-partial", `matrix is ${state.status ?? "unknown"}, not complete`);
  if (stableJson(state.config) !== stableJson(config)) add("error", "matrix-config", "config.json does not match the config frozen in matrix-state.json");
  const scheduledRunIds = state.scheduledRunIds ?? [];
  if (scheduledRunIds.length !== state.totalCells || new Set(scheduledRunIds).size !== scheduledRunIds.length) add("error", "schedule-count", "scheduled run IDs are missing, duplicated, or do not match totalCells");
  if (state.experimentFingerprint !== hash({ config, scheduledRunIds }, 64)) add("error", "matrix-fingerprint", "experiment fingerprint does not bind the frozen config and ordered schedule");
  try {
    const reproducedSchedule = plannedExperimentCells(config).map((cell) => cell.runId);
    if (stableJson(reproducedSchedule) !== stableJson(scheduledRunIds)) {
      add("error", "schedule-reproduction", "current pinned harness/dependencies/adapter do not reproduce the frozen run-ID schedule");
    }
  } catch (error) {
    add("error", "schedule-reproduction", error instanceof Error ? error.message : String(error));
  }
  const reportIdSet = new Set(ids);
  const scheduledIdSet = new Set(scheduledRunIds);
  const missing = scheduledRunIds.filter((runId) => !reportIdSet.has(runId));
  const extra = ids.filter((runId) => !scheduledIdSet.has(runId));
  if (missing.length > 0) add("error", "missing-cells", `${missing.length} scheduled cell files are missing`);
  if (extra.length > 0) add("error", "extra-cells", `${extra.length} cell files are not in the frozen schedule`);
  const stateRunIds = state.runIds ?? [];
  if (new Set(stateRunIds).size !== stateRunIds.length || stateRunIds.some((runId) => !reportIdSet.has(runId)) || ids.some((runId) => !stateRunIds.includes(runId))) {
    add("error", "completed-run-ids", "matrix runIds do not exactly match canonical cell reports");
  }
  if (state.completedCells !== reports.length || stateRunIds.length !== reports.length) add("error", "completed-count", "completedCells, runIds, and canonical cell count disagree");
  for (const { name, report } of reportFiles) if (name !== `${report.runId}.json`) add("error", "cell-filename", `cell filename ${name} does not match report runId`, report.runId);
  for (const report of reports) {
    if (report.budget.unit === "wall-ms" && report.stopReason === "time" && report.status !== "completed") add("error", "planned-time-label", "planned time expiry was not completed", report.runId);
    if (report.stopReason === "work-ceiling") add("review", "native-ceiling", "native work ceiling bound this cell", report.runId);
    if (report.status === "adapter-unavailable" || report.status === "runtime-error" || report.status === "compile-error") add("error", "failed-cell", `${report.status}: ${report.error ?? "no detail"}`, report.runId);
    if (report.timing.wallMs < 0 || !Number.isFinite(report.timing.wallMs)) add("error", "wall-time", "invalid wall timing", report.runId);
    for (const [phase, value] of Object.entries(report.timing.phases)) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) add("error", "timing-phase", `${phase} is invalid`, report.runId);
    }
    if (report.algorithm === "inkcheck" && report.timing.cpuMs === null) add("information", "child-cpu-unavailable", "external child CPU is unavailable and remains null", report.runId);
  }
  let witnessReplays = 0;
  let witnessReplayFailures = 0;
  for (const report of reports.filter((candidate) => candidate.benchmarkTier === "generated-planted")) {
    const fixture = generateFixture(report.family as ExperimentConfig["families"][number], report.fixtureSeed, report.difficulty);
    if (fixture.manifest.fixtureId !== report.fixtureId || fixtureSourceHash(fixture) !== report.fixtureSourceSha256) {
      add("error", "fixture-identity", "generated fixture identity/source does not match the canonical report", report.runId);
      continue;
    }
    for (const discovery of report.discoveredBugs) {
      witnessReplays += 1;
      try {
        const controller = new InstrumentedController(fixture, Math.max(1, discovery.choicePath.length), report.storySeed);
        let observation = controller.launch();
        for (const choiceIndex of discovery.choicePath) observation = controller.step(choiceIndex).after;
        if (!controller.bugDiscoveries.some((item) => item.bugId === discovery.bugId)) throw new Error("oracle not reproduced");
      } catch (error) {
        witnessReplayFailures += 1;
        add("error", "witness-replay", error instanceof Error ? error.message : String(error), report.runId);
      }
    }
  }
  const resourceStops = reports.filter((report) => report.status === "resource-stopped").length;
  if (resourceStops > 0) add("review", "resource-stops", `${resourceStops} resource-stopped cells require an explicit preregistered interpretation`);
  const matrixComplete = state.status === "complete" && reports.length === state.totalCells && missing.length === 0 && extra.length === 0;
  const promotionEligible = matrixComplete && findings.every((finding) => finding.severity !== "error" && finding.severity !== "review");
  return {
    schemaVersion: 1,
    artifactDirectory,
    matrixComplete,
    canonicalCells: reports.length,
    scheduledCells: state.totalCells ?? 0,
    duplicateRunIds: duplicates,
    resourceStops,
    adapterFailures: reports.filter((report) => report.status === "adapter-unavailable" || report.status === "runtime-error" || report.status === "compile-error").length,
    witnessReplays,
    witnessReplayFailures,
    promotionEligible,
    findings,
  };
}
