import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LONG_RUN_PHASES,
  LONG_RUN_TELEMETRY_SCHEMA_VERSION,
  MAX_LONG_RUN_BYTE_MILLISECONDS_DIGITS,
  MAX_LONG_RUN_TELEMETRY_PASSES,
  validateLongRunTelemetryV1,
} from "../dist/adapters/inkcheck-telemetry.js";

const categories = ["critical", "intent", "authoredCoverage", "visibleOutcomes", "semanticTransitions", "terminalVariants"];
const phaseFields = ["setupMs", "compilationMs", "sourceScanMs", "searchActiveMs", "minimumReproductionMs", "checkpointWriteMs", "checkpointReopenMs", "replayScoringMs", "reportEnrichmentMs", "reportWriteMs", "finalizationMs"];
const retainedGiBMinuteTimesTwo = 2 * 1024 ** 3 * 60_000;

function rate(identities, denominator, scale) {
  return denominator === 0 || denominator === 0n ? null : identities / Number(denominator) * scale;
}

function passCost({
  pass = "shared:deep-novelty-v1:seed=1",
  samplesObserved = 2,
  firstObservationElapsedMs = 100,
  lastObservationElapsedMs = 160,
  transitions = 20,
  logicalIntegral = "24000",
  rssIntegral = "144000",
  identities = 2,
} = {}) {
  const searchActiveMs = firstObservationElapsedMs === null ? 0 : lastObservationElapsedMs - firstObservationElapsedMs;
  return {
    schemaVersion: 1,
    pass,
    samplesObserved,
    firstObservationElapsedMs,
    lastObservationElapsedMs,
    searchActiveMs,
    transitions,
    logicalRetained: {
      basis: "deterministic_logical_accounted_bytes",
      byteMillisecondsTimesTwo: logicalIntegral,
      divisor: 2,
    },
    processRss: {
      basis: "observed_process_rss_bytes",
      byteMillisecondsTimesTwo: rssIntegral,
      divisor: 2,
    },
    yield: Object.fromEntries(categories.map((category) => [category, {
      identities,
      identitiesPerMillionTransitions: rate(identities, transitions, 1_000_000),
      identitiesPerSearchActiveMinute: rate(identities, searchActiveMs, 60_000),
      identitiesPerRetainedGiBMinute: rate(identities, BigInt(logicalIntegral), retainedGiBMinuteTimesTwo),
    }])),
  };
}

function telemetry(passes = [passCost()]) {
  return {
    schemaVersion: 1,
    phases: Object.fromEntries(phaseFields.map((field) => [field, 0])),
    passes,
  };
}

test("InkCheck native receipt preserves exact integers, separate bases, and detached data", () => {
  const input = telemetry();
  input.phases.setupMs = 100;
  input.phases.compilationMs = 80;
  input.phases.finalizationMs = 60;
  input.phases.reportEnrichmentMs = 50;
  const validated = validateLongRunTelemetryV1(input);
  assert.deepEqual(validated, input);
  assert.notEqual(validated, input);
  assert.notEqual(validated.phases, input.phases);
  assert.notEqual(validated.passes, input.passes);
  assert.notEqual(validated.passes[0].yield.critical, input.passes[0].yield.critical);
  assert.deepEqual(validated.passes[0].yield.critical, {
    identities: 2,
    identitiesPerMillionTransitions: 100_000,
    identitiesPerSearchActiveMinute: 2_000,
    identitiesPerRetainedGiBMinute: 10_737_418_240,
  });
  input.passes[0].yield.critical.identities = 999;
  assert.equal(validated.passes[0].yield.critical.identities, 2);
  assert.equal(LONG_RUN_TELEMETRY_SCHEMA_VERSION, 1);
  assert.equal(LONG_RUN_PHASES.length, phaseFields.length);
});

test("empty passes, zero samples, and one sample do not invent a measured interval", () => {
  assert.deepEqual(validateLongRunTelemetryV1(telemetry([])).passes, []);
  for (const samplesObserved of [0, 1]) {
    const input = telemetry([passCost({
      samplesObserved,
      firstObservationElapsedMs: samplesObserved ? 10 : null,
      lastObservationElapsedMs: samplesObserved ? 10 : null,
      transitions: 0,
      logicalIntegral: "0",
      rssIntegral: "0",
      identities: 0,
    })]);
    assert.deepEqual(validateLongRunTelemetryV1(input), input);
    for (const category of categories) {
      const tampered = structuredClone(input);
      tampered.passes[0].yield[category].identities = 1;
      assert.throws(() => validateLongRunTelemetryV1(tampered), /without an observed interval/);
    }
  }
});

test("two observations in one millisecond retain work yield but null time and retained rates", () => {
  const input = telemetry([passCost({ firstObservationElapsedMs: 10, lastObservationElapsedMs: 10, transitions: 1, logicalIntegral: "0", rssIntegral: "0", identities: 1 })]);
  const validated = validateLongRunTelemetryV1(input);
  assert.equal(validated.passes[0].yield.critical.identitiesPerMillionTransitions, 1_000_000);
  assert.equal(validated.passes[0].yield.critical.identitiesPerSearchActiveMinute, null);
  assert.equal(validated.passes[0].yield.critical.identitiesPerRetainedGiBMinute, null);
  for (const field of ["logicalRetained", "processRss"]) {
    const tampered = structuredClone(input);
    tampered.passes[0][field].byteMillisecondsTimesTwo = "1";
    assert.throws(() => validateLongRunTelemetryV1(tampered), /zero-duration costs/);
  }
});

test("marathon and maximum safe-clock byte integrals survive without Number coercion", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const integral = (2n * BigInt(max) * BigInt(max)).toString();
  assert.ok(integral.length <= MAX_LONG_RUN_BYTE_MILLISECONDS_DIGITS);
  const input = telemetry([
    passCost({ pass: "shared:marathon", firstObservationElapsedMs: 0, lastObservationElapsedMs: 3_600_000, logicalIntegral: "30923764531200000", rssIntegral: "46385646796800000" }),
    passCost({ pass: "shared:maximum", firstObservationElapsedMs: 0, lastObservationElapsedMs: max, transitions: max, logicalIntegral: integral, rssIntegral: integral, identities: max }),
  ]);
  const validated = validateLongRunTelemetryV1(input);
  assert.equal(validated.passes[0].logicalRetained.byteMillisecondsTimesTwo, "30923764531200000");
  assert.equal(validated.passes[1].logicalRetained.byteMillisecondsTimesTwo, integral);
});

test("pass count, labels, uniqueness, and safe integer facts are bounded", () => {
  const atLimit = telemetry(Array.from({ length: MAX_LONG_RUN_TELEMETRY_PASSES }, (_, index) => passCost({ pass: `shared:pass=${index}` })));
  assert.equal(validateLongRunTelemetryV1(atLimit).passes.length, MAX_LONG_RUN_TELEMETRY_PASSES);
  assert.throws(() => validateLongRunTelemetryV1(telemetry([...atLimit.passes, passCost({ pass: "shared:overflow" })])), /at most/);
  assert.throws(() => validateLongRunTelemetryV1(telemetry([passCost(), passCost()])), /unique/);
  for (const pass of ["", "x".repeat(129), "private story text\n", "opaque\n", "opaque\r", "<script>"]) {
    assert.throws(() => validateLongRunTelemetryV1(telemetry([passCost({ pass })])), /bounded opaque/);
  }
  assert.equal(validateLongRunTelemetryV1(telemetry([passCost({ pass: "x".repeat(128) })])).passes[0].pass.length, 128);
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    const input = telemetry();
    input.phases.compilationMs = invalid;
    assert.throws(() => validateLongRunTelemetryV1(input), /safe integer/);
  }
});

test("interval relations and pass-local rate denominators fail closed", () => {
  const mutations = [
    (cost) => { cost.firstObservationElapsedMs = null; },
    (cost) => { cost.lastObservationElapsedMs = cost.firstObservationElapsedMs - 1; },
    (cost) => { cost.searchActiveMs += 1; },
    (cost) => { cost.samplesObserved = cost.transitions + 2; },
    (cost) => { cost.samplesObserved = 1; },
    ...["identitiesPerMillionTransitions", "identitiesPerSearchActiveMinute", "identitiesPerRetainedGiBMinute"].flatMap((field) => categories.map((category) => (cost) => { cost.yield[category][field] += 1; })),
  ];
  for (const mutate of mutations) {
    const input = telemetry();
    mutate(input.passes[0]);
    assert.throws(() => validateLongRunTelemetryV1(input), /bounds|interval|rates/);
  }
  for (const invalid of [Infinity, NaN, -1, "1", undefined]) {
    const input = telemetry();
    input.passes[0].yield.critical.identitiesPerMillionTransitions = invalid;
    assert.throws(() => validateLongRunTelemetryV1(input), /finite non-negative/);
  }
});

test("integral numerators, basis enums, and divisors require canonical bounded encodings", () => {
  for (const invalid of ["", "00", "01", "-1", "+1", "1.5", "1e3", "1\n", "9".repeat(34), 1, null]) {
    const input = telemetry();
    input.passes[0].logicalRetained.byteMillisecondsTimesTwo = invalid;
    assert.throws(() => validateLongRunTelemetryV1(input), /canonical unsigned decimal/);
  }
  for (const field of ["logicalRetained", "processRss"]) {
    const input = telemetry();
    input.passes[0][field].basis = "exclusive_owner_bytes";
    assert.throws(() => validateLongRunTelemetryV1(input), /basis is invalid/);
    const divisor = telemetry();
    divisor.passes[0][field].divisor = 1;
    assert.throws(() => validateLongRunTelemetryV1(divisor), /divisor must be 2/);
  }
});

test("all nested object shapes are exact and diagnostics do not echo private payloads", () => {
  const marker = "PRIVATE_STORY_TEXT_CHOICE_VARIABLE_AND_PATH";
  for (const getObject of [
    (value) => value,
    (value) => value.phases,
    (value) => value.passes[0],
    (value) => value.passes[0].logicalRetained,
    (value) => value.passes[0].processRss,
    (value) => value.passes[0].yield,
    (value) => value.passes[0].yield.critical,
  ]) {
    const input = telemetry();
    getObject(input)[marker] = marker;
    assert.throws(() => validateLongRunTelemetryV1(input), (error) => {
      assert.match(error.message, /invalid shape/);
      assert.ok(!error.message.includes(marker));
      return true;
    });
  }
  const invalidPass = telemetry([passCost({ pass: `${marker} private prose` })]);
  assert.throws(() => validateLongRunTelemetryV1(invalidPass), (error) => !error.message.includes(marker));
  for (const input of [null, undefined, {}, [], 0, "receipt"]) {
    assert.throws(() => validateLongRunTelemetryV1(input));
  }
  const version = telemetry();
  version.schemaVersion = 2;
  assert.throws(() => validateLongRunTelemetryV1(version), /schemaVersion must be 1/);
});

test("proxy, accessor, sparse, inherited, and extra array input hooks are never executed", () => {
  let hooks = 0;
  const trap = () => { hooks += 1; throw new Error("untrusted hook executed"); };
  const handlers = { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, ownKeys: trap };
  assert.throws(() => validateLongRunTelemetryV1(new Proxy(telemetry(), handlers)), /canonical plain/);
  const prototypeProxy = Object.create(new Proxy({}, handlers));
  Object.defineProperties(prototypeProxy, Object.getOwnPropertyDescriptors(telemetry()));
  assert.throws(() => validateLongRunTelemetryV1(prototypeProxy), /canonical plain/);
  const accessor = telemetry();
  Object.defineProperty(accessor.phases, "compilationMs", { enumerable: true, get: trap });
  assert.throws(() => validateLongRunTelemetryV1(accessor), /data properties/);
  const proxiedPasses = telemetry();
  proxiedPasses.passes = new Proxy([], handlers);
  assert.throws(() => validateLongRunTelemetryV1(proxiedPasses), /canonical dense/);
  const inheritedArray = telemetry([]);
  Object.setPrototypeOf(inheritedArray.passes, new Proxy([], handlers));
  assert.throws(() => validateLongRunTelemetryV1(inheritedArray), /canonical dense/);
  const accessorIndex = telemetry(new Array(1));
  Object.defineProperty(accessorIndex.passes, "0", { enumerable: true, get: trap });
  assert.throws(() => validateLongRunTelemetryV1(accessorIndex), /holes or accessors/);
  const extraArray = telemetry();
  extraArray.passes.map = trap;
  assert.throws(() => validateLongRunTelemetryV1(extraArray), /without extra properties/);
  assert.throws(() => validateLongRunTelemetryV1(telemetry(new Array(1))), /without extra properties|without holes/);
  assert.throws(() => validateLongRunTelemetryV1(telemetry(new Array(2 ** 32 - 1))), /at most/);
  const symbolic = telemetry();
  symbolic.phases[Symbol("private")] = 1;
  assert.throws(() => validateLongRunTelemetryV1(symbolic), /string-keyed|invalid shape/);
  assert.equal(hooks, 0);
});

test("the additive report-v4 schema leaves legacy missing receipts valid and defines strict native shapes", () => {
  const schema = JSON.parse(readFileSync(new URL("../schemas/run-report.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, 4);
  assert.ok(!schema.properties.resources.required.includes("longRunTelemetry"));
  assert.equal(schema.properties.resources.properties.longRunTelemetry.$ref, "#/$defs/longRunTelemetryV1");
  assert.equal(schema.properties.timing.properties.externalProcessWallMs.minimum, 0);
  assert.ok(!schema.properties.timing.required.includes("externalProcessWallMs"));
  const defs = schema.$defs;
  assert.deepEqual(defs.longRunTelemetryV1.required, ["schemaVersion", "phases", "passes"]);
  assert.equal(defs.longRunTelemetryV1.additionalProperties, false);
  assert.equal(defs.longRunTelemetryV1.properties.passes.maxItems, MAX_LONG_RUN_TELEMETRY_PASSES);
  assert.deepEqual(defs.longRunPhaseDurationsV1.required, phaseFields);
  assert.equal(defs.longRunSafeInteger.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(defs.longRunLogicalIntegralV1.properties.byteMillisecondsTimesTwo.maxLength, MAX_LONG_RUN_BYTE_MILLISECONDS_DIGITS);
  assert.equal(new RegExp(defs.longRunLogicalIntegralV1.properties.byteMillisecondsTimesTwo.pattern).test("1\n"), false);
  assert.equal(new RegExp(defs.longRunPassCostV1.properties.pass.pattern).test("opaque\n"), false);
  for (const name of ["longRunPhaseDurationsV1", "longRunPassCostV1", "longRunLogicalIntegralV1", "longRunProcessRssIntegralV1", "longRunYieldRatesV1", "longRunYieldRateV1"]) {
    assert.equal(defs[name].additionalProperties, false, name);
  }
});
