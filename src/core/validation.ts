import { stableJson } from "./hash.js";
import { executionFingerprintDigest } from "./identity.js";
import type { RunReport } from "./types.js";

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

/** Refuse accidental retry weighting or mixed-build pooling before summary generation. */
export function assertSummarizableRuns(runs: readonly RunReport[]): void {
  const seen = new Map<string, RunReport>();
  for (const run of runs) {
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
