import { stableJson } from "./hash.js";
import { executionFingerprintDigest } from "./identity.js";
import type { RunReport } from "./types.js";
import { validateLongRunTelemetryV1 } from "../adapters/inkcheck-telemetry.js";

interface MatrixIdentity {
  schemaVersion?: number;
  config?: unknown;
  experimentFingerprint?: string;
  scheduledRunIds?: string[];
}

export function assertMatrixIdentity(previous: MatrixIdentity, expected: Required<MatrixIdentity>, label: string): void {
  if (previous.schemaVersion !== expected.schemaVersion) {
    throw new Error(`refusing to resume ${label}: matrix-state.schemaVersion differs (${previous.schemaVersion ?? "missing"} != ${expected.schemaVersion})`);
  }
  if (stableJson(previous.config) !== stableJson(expected.config)) {
    throw new Error(`refusing to resume ${label}: config differs from the frozen matrix`);
  }
  if (previous.experimentFingerprint !== expected.experimentFingerprint) {
    throw new Error(`refusing to resume ${label}: experimentFingerprint differs; executable or dependency identity changed`);
  }
  const previousIds = previous.scheduledRunIds;
  if (!Array.isArray(previousIds)) throw new Error(`refusing to resume ${label}: scheduledRunIds is missing`);
  const mismatch = expected.scheduledRunIds.findIndex((runId, index) => previousIds[index] !== runId);
  if (mismatch >= 0 || previousIds.length !== expected.scheduledRunIds.length) {
    throw new Error(`refusing to resume ${label}: scheduledRunIds first differ at index ${mismatch >= 0 ? mismatch : Math.min(previousIds.length, expected.scheduledRunIds.length)}`);
  }
}

function logicalCellKey(run: RunReport): string {
  return stableJson({
    fixtureId: run.fixtureId,
    fixtureSourceSha256: run.fixtureSourceSha256,
    benchmarkTier: run.benchmarkTier,
    algorithm: run.algorithm,
    fixtureSeed: run.fixtureSeed,
    searchSeed: run.searchSeed,
    storySeed: run.storySeed,
    difficulty: run.difficulty,
    budget: run.budget,
    workBudget: run.workBudget,
  });
}

/** Distinguish invalid native observations from executable-identity failures in audits. */
export class RunTelemetryValidationError extends Error {
  constructor(readonly runId: string, message: string) {
    super(`invalid telemetry for ${runId}: ${message}`);
    this.name = "RunTelemetryValidationError";
  }
}

/** Validate additive observations again after loading a durable report, without inventing legacy data. */
export function assertRunTelemetryContract(run: RunReport): void {
  try {
    if (Object.hasOwn(run.timing, "externalProcessWallMs")) {
      const externalWall = run.timing.externalProcessWallMs;
      if (run.algorithm !== "inkcheck" || typeof externalWall !== "number"
        || !Number.isFinite(externalWall) || externalWall < 0) {
        throw new Error("externalProcessWallMs must be a finite nonnegative external-adapter measurement");
      }
    }
    if (!run.resources || !Object.hasOwn(run.resources, "longRunTelemetry")) {
      if (run.algorithm === "inkcheck" && run.executionFingerprint.algorithmVersion === "external-adapter-v6"
        && (run.timing.phases.searchMs !== null || run.timing.phases.compileLoadMs !== null)) {
        throw new Error("external-adapter-v6 searchMs and compileLoadMs must be null without native longRunTelemetry");
      }
      return;
    }
    if (run.algorithm !== "inkcheck" || run.resources.provenance !== "external-adapter") {
      throw new Error("longRunTelemetry requires the inkcheck algorithm and external-adapter provenance");
    }
    const telemetry = validateLongRunTelemetryV1(run.resources.longRunTelemetry);
    if (run.timing.phases.searchMs !== telemetry.phases.searchActiveMs) {
      throw new Error("searchMs must equal native longRunTelemetry.phases.searchActiveMs");
    }
    if (run.timing.phases.compileLoadMs !== telemetry.phases.compilationMs) {
      throw new Error("compileLoadMs must equal native longRunTelemetry.phases.compilationMs");
    }
  } catch (error) {
    throw new RunTelemetryValidationError(run.runId, error instanceof Error ? error.message : String(error));
  }
}

/** Refuse accidental retry weighting or mixed-build pooling before summary generation. */
export function assertSummarizableRuns(runs: readonly RunReport[]): void {
  const seen = new Map<string, RunReport>();
  for (const run of runs) {
    assertRunTelemetryContract(run);
    const { digest, ...fields } = run.executionFingerprint;
    if (executionFingerprintDigest(fields) !== digest) {
      throw new Error(`refusing to summarize ${run.runId}: executionFingerprint digest is invalid`);
    }
    const key = logicalCellKey(run);
    const previous = seen.get(key);
    if (!previous) {
      seen.set(key, run);
      continue;
    }
    if (previous.executionFingerprint.digest !== run.executionFingerprint.digest) {
      throw new Error(`refusing to pool logical cell ${run.fixtureId}/${run.algorithm}: executionFingerprint differs`);
    }
    throw new Error(`refusing to pool duplicate logical cell ${run.fixtureId}/${run.algorithm}/${run.searchSeed}`);
  }
}
