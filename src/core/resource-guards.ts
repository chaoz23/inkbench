import * as v8 from "node:v8";
import type { ProcessMemoryUsage, ResourceLimits, ResourceStopReason } from "./types.js";

export const DEFAULT_PROGRESS_INTERVAL_TRANSITIONS = 10_000;
export const DEFAULT_PROGRESS_INTERVAL_MS = 1_000;

function positiveInteger(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function memoryUsage(): ProcessMemoryUsage {
  const current = process.memoryUsage();
  return {
    heapUsedBytes: current.heapUsed,
    rssBytes: current.rss,
    externalBytes: current.external,
    arrayBuffersBytes: current.arrayBuffers,
  };
}

function maxima(left: ProcessMemoryUsage, right: ProcessMemoryUsage): ProcessMemoryUsage {
  return {
    heapUsedBytes: Math.max(left.heapUsedBytes, right.heapUsedBytes),
    rssBytes: Math.max(left.rssBytes, right.rssBytes),
    externalBytes: Math.max(left.externalBytes, right.externalBytes),
    arrayBuffersBytes: Math.max(left.arrayBuffersBytes, right.arrayBuffersBytes),
  };
}

export class ResourceGuards {
  readonly memoryCapBytes: number;
  readonly timeCapMs: number | null;
  readonly startedAtMs: number;
  readonly progressIntervalTransitions: number;
  readonly progressIntervalMs: number;

  private peakValue: ProcessMemoryUsage;
  private reason: ResourceStopReason | null = null;

  constructor(limits: ResourceLimits = {}) {
    positiveInteger(limits.maxMemoryMb, "maxMemoryMb");
    positiveInteger(limits.maxTimeMs, "maxTimeMs");
    positiveInteger(limits.progressIntervalTransitions, "progressIntervalTransitions");
    positiveInteger(limits.progressIntervalMs, "progressIntervalMs");
    this.memoryCapBytes = limits.maxMemoryMb === undefined
      ? Math.floor(v8.getHeapStatistics().heap_size_limit * 0.85)
      : limits.maxMemoryMb * 1024 * 1024;
    this.timeCapMs = limits.maxTimeMs ?? null;
    this.startedAtMs = Date.now();
    this.progressIntervalTransitions = limits.progressIntervalTransitions ?? DEFAULT_PROGRESS_INTERVAL_TRANSITIONS;
    this.progressIntervalMs = limits.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
    this.peakValue = memoryUsage();
  }

  sample(): ProcessMemoryUsage {
    const current = memoryUsage();
    this.peakValue = maxima(this.peakValue, current);
    return current;
  }

  check(): ResourceStopReason | null {
    if (this.reason) return this.reason;
    const current = this.sample();
    if (current.heapUsedBytes >= this.memoryCapBytes) this.reason = "memory";
    else if (this.timeCapMs !== null && Date.now() - this.startedAtMs >= this.timeCapMs) this.reason = "time";
    return this.reason;
  }

  stop(reason: ResourceStopReason): void {
    if (!this.reason) this.reason = reason;
    this.sample();
  }

  get stopReason(): ResourceStopReason | null {
    return this.reason;
  }

  get peak(): ProcessMemoryUsage {
    this.sample();
    return { ...this.peakValue };
  }

  get final(): ProcessMemoryUsage {
    return this.sample();
  }
}
