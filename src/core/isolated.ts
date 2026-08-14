import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunProgressEvent, RunReport, RunRequest } from "./types.js";

export interface IsolatedRunOptions {
  heapLimitMb?: number;
  hardTimeoutMs?: number;
  latestProgressPath?: string;
  onProgress?: (event: RunProgressEvent) => void;
}

function positiveInteger(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

export async function runBenchmarkIsolated(request: RunRequest, options: IsolatedRunOptions = {}): Promise<RunReport> {
  positiveInteger(options.heapLimitMb, "heapLimitMb");
  positiveInteger(options.hardTimeoutMs, "hardTimeoutMs");
  const scratch = mkdtempSync(join(tmpdir(), "inkbench-worker-"));
  const reportPath = join(scratch, "report.json");
  const requestedMemoryMb = request.resources?.maxMemoryMb;
  const heapLimitMb = options.heapLimitMb ?? (requestedMemoryMb === undefined ? undefined : Math.ceil(requestedMemoryMb / 0.8));
  const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));
  const nodeArgs = [...(heapLimitMb === undefined ? [] : [`--max-old-space-size=${heapLimitMb}`]), workerPath];
  const requestedTimeMs = request.timeBudgetMs ?? request.resources?.maxTimeMs;
  const finalizationGraceMs = requestedTimeMs === undefined
    ? undefined
    : Math.max(300_000, Math.min(1_800_000, Math.ceil(requestedTimeMs * 0.25)));
  const hardTimeoutMs = options.hardTimeoutMs ?? (requestedTimeMs === undefined ? undefined : requestedTimeMs + finalizationGraceMs!);

  try {
    return await new Promise<RunReport>((resolve, reject) => {
      const child = spawn(process.execPath, nodeArgs, { stdio: ["pipe", "ignore", "pipe"] });
      let stderrBuffer = "";
      let diagnostic = "";
      let timer: NodeJS.Timeout | undefined;

      const consumeLine = (line: string): void => {
        if (!line) return;
        try {
          const event = JSON.parse(line) as RunProgressEvent;
          if (event.schemaVersion === 2 && typeof event.type === "string") options.onProgress?.(event);
          else diagnostic += `${line}\n`;
        } catch {
          diagnostic += `${line}\n`;
        }
      };

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrBuffer += chunk;
        while (true) {
          const newline = stderrBuffer.indexOf("\n");
          if (newline < 0) break;
          consumeLine(stderrBuffer.slice(0, newline));
          stderrBuffer = stderrBuffer.slice(newline + 1);
        }
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (timer) clearTimeout(timer);
        consumeLine(stderrBuffer);
        if (existsSync(reportPath)) {
          try {
            resolve(JSON.parse(readFileSync(reportPath, "utf8")) as RunReport);
          } catch (error) {
            reject(error);
          }
          return;
        }
        reject(new Error(`isolated worker ended without a report (code ${code ?? "null"}, signal ${signal ?? "none"})${diagnostic ? `: ${diagnostic.trim().slice(0, 2_000)}` : ""}`));
      });
      if (hardTimeoutMs !== undefined) {
        timer = setTimeout(() => child.kill("SIGTERM"), hardTimeoutMs);
        timer.unref();
      }
      const { onProgress: _onProgress, ...serializable } = request;
      child.stdin.end(JSON.stringify({
        request: serializable,
        reportPath,
        ...(options.latestProgressPath ? { latestProgressPath: options.latestProgressPath } : {}),
      }));
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
