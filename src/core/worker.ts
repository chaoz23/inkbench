#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { writeJsonAtomic } from "./atomic.js";
import { runBenchmark } from "./run.js";
import type { RunRequest } from "./types.js";

interface WorkerPayload {
  request: Omit<RunRequest, "onProgress">;
  reportPath: string;
  latestProgressPath?: string;
}

function readStdin(): string {
  return readFileSync(0, "utf8");
}

try {
  const payload = JSON.parse(readStdin()) as WorkerPayload;
  if (!payload || typeof payload !== "object" || typeof payload.reportPath !== "string") {
    throw new TypeError("worker payload is invalid");
  }
  const report = runBenchmark({
    ...payload.request,
    onProgress: (event) => {
      process.stderr.write(`${JSON.stringify(event)}\n`);
      if (payload.latestProgressPath) writeJsonAtomic(payload.latestProgressPath, event);
    },
  });
  writeJsonAtomic(payload.reportPath, report);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
