import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateFixture, runBenchmark, validateLongRunTelemetryV1 } from "../dist/index.js";

function receipt() {
  const logicalIntegral = "2400";
  const categories = ["critical", "intent", "authoredCoverage", "visibleOutcomes", "semanticTransitions", "terminalVariants"];
  return {
    schemaVersion: 1,
    phases: {
      setupMs: 10, compilationMs: 4, sourceScanMs: 2, searchActiveMs: 60,
      minimumReproductionMs: 7, checkpointWriteMs: 3, checkpointReopenMs: 0,
      replayScoringMs: 17, reportEnrichmentMs: 4, reportWriteMs: 3, finalizationMs: 30,
    },
    passes: [{
      schemaVersion: 1, pass: "shared:deep-novelty-v1:seed=7", samplesObserved: 2,
      firstObservationElapsedMs: 20, lastObservationElapsedMs: 80,
      searchActiveMs: 60, transitions: 20,
      logicalRetained: { basis: "deterministic_logical_accounted_bytes", byteMillisecondsTimesTwo: logicalIntegral, divisor: 2 },
      processRss: { basis: "observed_process_rss_bytes", byteMillisecondsTimesTwo: "18000", divisor: 2 },
      yield: Object.fromEntries(categories.map((category) => {
        const identities = category === "terminalVariants" ? 3 : category === "visibleOutcomes" ? 1 : 0;
        return [category, {
          identities,
          identitiesPerMillionTransitions: identities / 20 * 1_000_000,
          identitiesPerSearchActiveMinute: identities / 60 * 60_000,
          identitiesPerRetainedGiBMinute: identities / Number(logicalIntegral) * Number(2n * 1024n ** 3n * 60_000n),
        }];
      })),
    }],
  };
}

function withAdapterReport({ transport, telemetry, includeTelemetry = true, heap = true, trailingEvents = [], stderr = "" }, inspect) {
  const directory = mkdtempSync(join(tmpdir(), "inkbench-cost-phase-"));
  const command = join(directory, "mock-inkcheck.js");
  const resources = {
    ...(heap ? { peakMemoryBytes: 50_000_000, memoryCapBytes: 100_000_000, memorySearchLimitBytes: 80_000_000 } : {}),
    ...(includeTelemetry ? { longRunTelemetry: telemetry } : {}),
  };
  const common = {
    inkcheckVersion: "0.7.2", compile: { success: true }, elapsedMs: 100,
    resources, effectiveConfiguration: { concurrency: 1, concurrencyMode: "fixed" },
  };
  const explore = { statesExplored: 77, exhaustive: false, truncatedBy: { maxStates: true, memory: false, time: false } };
  const output = transport === "bounded-stream"
    ? [
        { schemaVersion: 1, type: "run_start", inkcheckVersion: "0.7.2" },
        { schemaVersion: 1, type: "run_end", ...common, explore: { ...explore, endingsFound: 0, runtimeErrors: 0 } },
        ...trailingEvents,
      ].map((event) => JSON.stringify(event)).join("\n") + "\n"
    : JSON.stringify({ ...common, explore: { ...explore, endingsFound: [] } });
  try {
    writeFileSync(command, `process.stderr.write(${JSON.stringify(stderr)}); process.stdout.write(${JSON.stringify(output)});\n`, "utf8");
    const report = runBenchmark({
      fixture: generateFixture("shallow-obvious", 1, 1), algorithm: "inkcheck",
      searchSeed: 7, storySeed: 1, budget: 77, inkcheckCommand: command,
    });
    inspect(report);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const transport of ["bounded-stream", "full-json"]) {
  test(`${transport} retains native cost/phase records without inventing whole-process search timing`, () => {
    const telemetry = receipt();
    validateLongRunTelemetryV1(telemetry);
    withAdapterReport({ transport, telemetry }, (report) => {
      assert.equal(report.status, "completed");
      assert.deepEqual(report.resources.longRunTelemetry, telemetry);
      assert.equal(report.timing.phases.searchMs, 60);
      assert.equal(report.timing.phases.compileLoadMs, 4);
      assert.ok(report.timing.externalProcessWallMs > 0);
      assert.ok(report.timing.wallMs >= report.timing.externalProcessWallMs);
      assert.equal(report.timing.phases.scoringMs, report.timing.phases.replayScoringMs);
      assert.equal(report.resources.longRunTelemetry.phases.replayScoringMs, 17);
      assert.equal(report.resources.longRunTelemetry.phases.finalizationMs, 30);
      assert.equal(report.resources.process.peak.rssBytes, null);
      assert.equal(report.timing.cpuMs, null);
      assert.equal(report.counts.transitions, 77);
      assert.equal(report.discoveredBugs.length, 0);
      assert.equal(report.discoveryTimingBasis, transport === "bounded-stream" ? "global-wall" : "final-only");
      assert.match(report.notes.join("\n"), /not whole-run cost or peak RSS/);
    });
  });

  test(`${transport} retains a telemetry-only resource receipt`, () => {
    const telemetry = receipt();
    withAdapterReport({ transport, telemetry, heap: false }, (report) => {
      assert.equal(report.status, "completed");
      assert.deepEqual(report.resources.longRunTelemetry, telemetry);
      assert.equal(report.resources.process.peak, null);
      assert.equal(report.resources.limits.memoryCapBytes, null);
    });
  });

  test(`${transport} missing legacy telemetry is unavailable, not zero-cost or whole-child search`, () => {
    withAdapterReport({ transport, includeTelemetry: false }, (report) => {
      assert.equal(report.status, "completed");
      assert.equal(Object.hasOwn(report.resources, "longRunTelemetry"), false);
      assert.equal(report.timing.phases.searchMs, null);
      assert.equal(report.timing.phases.compileLoadMs, null);
      assert.ok(report.timing.externalProcessWallMs > 0);
      assert.match(report.notes.join("\n"), /unavailable from this CLI/);
    });
  });

  test(`${transport} present malformed telemetry is failed evidence, never silently missing`, () => {
    const malformed = [null, { ...receipt(), schemaVersion: 2 }];
    const privateField = receipt();
    privateField.storyProse = "PRIVATE_STORY_TRIPWIRE";
    malformed.push(privateField);
    const unsafe = receipt();
    unsafe.phases.searchActiveMs = Number.MAX_SAFE_INTEGER + 1;
    malformed.push(unsafe);
    const duplicated = receipt();
    duplicated.passes.push(structuredClone(duplicated.passes[0]));
    malformed.push(duplicated);
    const decimal = receipt();
    decimal.passes[0].logicalRetained.byteMillisecondsTimesTwo = "02400";
    malformed.push(decimal);
    const inconsistent = receipt();
    inconsistent.passes[0].yield.visibleOutcomes.identitiesPerMillionTransitions += 1;
    malformed.push(inconsistent);
    for (const telemetry of malformed) {
      withAdapterReport({ transport, telemetry }, (report) => {
        assert.equal(report.status, "runtime-error");
        assert.equal(report.stopReason, "error");
        assert.equal(report.resources, null);
        assert.equal(report.discoveredBugs.length, 0);
        assert.doesNotMatch(report.error, /PRIVATE_STORY_TRIPWIRE/);
        assert.ok(report.timing.externalProcessWallMs > 0);
        assert.ok(report.timing.wallMs >= report.timing.externalProcessWallMs);
      });
    }
  });

  test(`${transport} invalid-receipt diagnostics do not copy raw private CLI stderr`, () => {
    withAdapterReport({ transport, telemetry: null, stderr: "PRIVATE_STDERR_TRIPWIRE" }, (report) => {
      assert.equal(report.status, "runtime-error");
      assert.match(report.error, /invalid InkCheck long-run telemetry/);
      assert.doesNotMatch(report.error, /PRIVATE_STDERR_TRIPWIRE/);
    });
  });
}

test("terminal records cannot be overwritten or followed by evidence events", () => {
  const replacement = {
    schemaVersion: 1, type: "run_end", compile: { success: true },
    explore: { statesExplored: 77, endingsFound: 0, exhaustive: false, truncatedBy: { maxStates: true } },
  };
  for (const telemetry of [null, receipt()]) {
    for (const event of [replacement, { schemaVersion: 1, type: "ending", choiceIndices: [] }, { schemaVersion: 1, type: "run_start" }]) {
      withAdapterReport({ transport: "bounded-stream", telemetry, trailingEvents: [event], stderr: "PRIVATE_STDERR_TRIPWIRE" }, (report) => {
        assert.equal(report.status, "runtime-error");
        assert.match(report.error, /after its terminal record/);
        assert.doesNotMatch(report.error, /PRIVATE_STDERR_TRIPWIRE/);
      });
    }
  }
});
