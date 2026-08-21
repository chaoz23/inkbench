import type { ResourceStopReason, RunReport, TerminalOutcomeCounts } from "../core/types.js";

export function summarizeTerminalOutcomes(runs: RunReport[]): TerminalOutcomeCounts {
  const statuses: RunReport["status"][] = ["completed", "resource-stopped", "adapter-unavailable", "compile-error", "runtime-error"];
  const reasons: ResourceStopReason[] = ["budget", "work-ceiling", "search-exhausted", "memory", "time", "cancelled", "error"];
  const byStatus = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<RunReport["status"], number>;
  const byStopReason = Object.fromEntries(reasons.map((reason) => [reason, 0])) as Record<ResourceStopReason, number>;
  for (const run of runs) {
    byStatus[run.status] += 1;
    byStopReason[run.stopReason] += 1;
  }
  return {
    launched: runs.length,
    completed: byStatus.completed,
    resourceStopped: byStatus["resource-stopped"],
    failed: byStatus["adapter-unavailable"] + byStatus["compile-error"] + byStatus["runtime-error"],
    byStatus,
    byStopReason,
  };
}
