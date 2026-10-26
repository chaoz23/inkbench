import { types as utilTypes } from "node:util";

/**
 * InkCheck's output-only schema-v1 contract. This module neither loads InkCheck
 * nor records observations, changes search policy, or invents missing costs.
 * Setup/finalization may contain component phases; never sum the phase vector.
 */
export const LONG_RUN_TELEMETRY_SCHEMA_VERSION = 1;
export const MAX_LONG_RUN_TELEMETRY_PASSES = 32;
/** Enough for the maximum integral of safe-integer bytes over safe-integer milliseconds. */
export const MAX_LONG_RUN_BYTE_MILLISECONDS_DIGITS = 33;

export const LONG_RUN_PHASES = [
  "setup",
  "compilation",
  "source_scan",
  "search_active",
  "minimum_reproduction",
  "checkpoint_write",
  "checkpoint_reopen",
  "replay_scoring",
  "report_enrichment",
  "report_write",
  "finalization",
] as const;

export type LongRunPhaseV1 = typeof LONG_RUN_PHASES[number];

export interface RunPhaseDurationsV1 {
  /** Inclusive run setup. Component phases may overlap an inclusive parent phase. */
  setupMs: number;
  compilationMs: number;
  sourceScanMs: number;
  searchActiveMs: number;
  minimumReproductionMs: number;
  checkpointWriteMs: number;
  checkpointReopenMs: number;
  replayScoringMs: number;
  reportEnrichmentMs: number;
  reportWriteMs: number;
  /** Inclusive post-search work; component finalization phases remain separately visible. */
  finalizationMs: number;
}

export interface ByteTimeIntegralV1 {
  basis: "deterministic_logical_accounted_bytes" | "observed_process_rss_bytes";
  /** Twice the exact integral as a canonical bounded unsigned decimal. */
  byteMillisecondsTimesTwo: string;
  divisor: 2;
}

export interface LongRunYieldRateV1 {
  /** Identities added strictly after the first live sample through the last. */
  identities: number;
  identitiesPerMillionTransitions: number | null;
  identitiesPerSearchActiveMinute: number | null;
  identitiesPerRetainedGiBMinute: number | null;
}

export interface LongRunYieldRatesV1 {
  critical: LongRunYieldRateV1;
  intent: LongRunYieldRateV1;
  authoredCoverage: LongRunYieldRateV1;
  visibleOutcomes: LongRunYieldRateV1;
  semanticTransitions: LongRunYieldRateV1;
  terminalVariants: LongRunYieldRateV1;
}

export interface LongRunPassCostV1 {
  schemaVersion: 1;
  pass: string;
  samplesObserved: number;
  firstObservationElapsedMs: number | null;
  lastObservationElapsedMs: number | null;
  /** Time covered by adjacent live samples from this pass, excluding unobserved edges. */
  searchActiveMs: number;
  /** Transitions strictly after the first live sample through the last. */
  transitions: number;
  logicalRetained: ByteTimeIntegralV1;
  processRss: ByteTimeIntegralV1;
  yield: LongRunYieldRatesV1;
}

export interface LongRunTelemetryV1 {
  schemaVersion: 1;
  phases: RunPhaseDurationsV1;
  /** Costs and yields remain pass-local because identities can overlap across passes. */
  passes: LongRunPassCostV1[];
}

const PHASE_DURATION_KEYS = [
  "setupMs",
  "compilationMs",
  "sourceScanMs",
  "searchActiveMs",
  "minimumReproductionMs",
  "checkpointWriteMs",
  "checkpointReopenMs",
  "replayScoringMs",
  "reportEnrichmentMs",
  "reportWriteMs",
  "finalizationMs",
] as const;

const TELEMETRY_KEYS = ["schemaVersion", "phases", "passes"] as const;
const PASS_COST_KEYS = [
  "schemaVersion",
  "pass",
  "samplesObserved",
  "firstObservationElapsedMs",
  "lastObservationElapsedMs",
  "searchActiveMs",
  "transitions",
  "logicalRetained",
  "processRss",
  "yield",
] as const;
const BYTE_TIME_KEYS = ["basis", "byteMillisecondsTimesTwo", "divisor"] as const;
const YIELD_KEYS = [
  "critical",
  "intent",
  "authoredCoverage",
  "visibleOutcomes",
  "semanticTransitions",
  "terminalVariants",
] as const;
const YIELD_RATE_KEYS = [
  "identities",
  "identitiesPerMillionTransitions",
  "identitiesPerSearchActiveMinute",
  "identitiesPerRetainedGiBMinute",
] as const;

const RETAINED_GIB_MINUTE_TIMES_TWO = 2n * 1024n * 1024n * 1024n * 60_000n;
const MAX_LONG_RUN_BYTE_MILLISECONDS_TIMES_TWO = 10n ** BigInt(MAX_LONG_RUN_BYTE_MILLISECONDS_DIGITS) - 1n;
// JavaScript's $ also matches before a final line terminator. Require the
// actual end so neither canonical decimal strings nor opaque labels hide one.
const CANONICAL_UNSIGNED_DECIMAL = /^(0|[1-9]\d*)(?![\s\S])/;
const PASS_PATTERN = /^[A-Za-z0-9._:=/-]{1,128}(?![\s\S])/;

function record(value: unknown, name: string, maximumKeys: number): Record<string, unknown> {
  if (value === null
    || typeof value !== "object"
    || utilTypes.isProxy(value)
    || Array.isArray(value)) {
    throw new TypeError(`${name} must be a canonical plain data record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (utilTypes.isProxy(prototype)
    || (prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError(`${name} must be a canonical plain data record`);
  }

  // Reject extra properties before copying descriptors for an attacker-sized
  // object. Key inspection cannot execute hooks after proxies are excluded.
  if (Reflect.ownKeys(value).length > maximumKeys) {
    throw new TypeError(`${name} has an invalid shape`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      throw new TypeError(`${name} must contain only enumerable string-keyed data properties`);
    }
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      throw new TypeError(`${name} must contain only enumerable string-keyed data properties`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  name: string
): Record<Keys[number], unknown> {
  const candidate = record(value, name, keys.length);
  const actual = Reflect.ownKeys(candidate);
  if (actual.some((key) => typeof key !== "string")
    || actual.length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(candidate, key))) {
    throw new TypeError(`${name} has an invalid shape`);
  }
  return candidate as Record<Keys[number], unknown>;
}

function denseDataArray(value: unknown, name: string, maximumLength: number): unknown[] {
  if (value === null
    || typeof value !== "object"
    || utilTypes.isProxy(value)
    || !Array.isArray(value)) {
    throw new TypeError(`${name} must be a canonical dense data array`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (utilTypes.isProxy(prototype) || prototype !== Array.prototype) {
    throw new TypeError(`${name} must be a canonical dense data array`);
  }

  // Native array length is a non-accessor own property. Read its descriptor
  // first so an oversized sparse array is rejected before allocating a full
  // descriptor snapshot.
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value")) {
    throw new TypeError(`${name} must be a canonical dense data array`);
  }
  const length = safeInteger(lengthDescriptor.value, `${name}.length`);
  if (length > maximumLength) {
    throw new RangeError(`${name} must contain at most ${maximumLength} entries`);
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string") || ownKeys.length !== length + 1) {
    throw new TypeError(`${name} must be a canonical dense data array without extra properties`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      throw new TypeError(`${name} must be a canonical dense data array without holes or accessors`);
    }
    snapshot[index] = descriptor.value;
  }
  return snapshot;
}

function safeInteger(value: unknown, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new RangeError(`${name} must be a safe integer at least ${minimum}`);
  }
  return value as number;
}

function nullableSafeInteger(value: unknown, name: string): number | null {
  return value === null ? null : safeInteger(value, name);
}

function finiteRate(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number or null`);
  }
  return value;
}

function passName(value: unknown, name: string): string {
  if (typeof value !== "string" || !PASS_PATTERN.test(value)) {
    throw new RangeError(`${name} must be a bounded opaque pass label`);
  }
  return value;
}

function boundedIntegral(value: bigint, name: string): bigint {
  if (value < 0n || value > MAX_LONG_RUN_BYTE_MILLISECONDS_TIMES_TWO) {
    throw new RangeError(`${name} exceeds the bounded decimal integral range`);
  }
  return value;
}

function canonicalIntegral(value: unknown, name: string): bigint {
  if (typeof value !== "string"
    || value.length > MAX_LONG_RUN_BYTE_MILLISECONDS_DIGITS
    || !CANONICAL_UNSIGNED_DECIMAL.test(value)) {
    throw new RangeError(
      `${name} must be a canonical unsigned decimal of at most ${MAX_LONG_RUN_BYTE_MILLISECONDS_DIGITS} digits`
    );
  }
  return boundedIntegral(BigInt(value), name);
}

function rate(numerator: number, denominator: number | bigint, scale: number | bigint): number | null {
  if (denominator === 0 || denominator === 0n) return null;
  const value = numerator / Number(denominator) * Number(scale);
  if (!Number.isFinite(value) || value < 0) throw new RangeError("yield rate is not finite");
  return value;
}

function byteTimeIntegral(
  basis: ByteTimeIntegralV1["basis"],
  byteMillisecondsTimesTwo: bigint
): ByteTimeIntegralV1 {
  return {
    basis,
    byteMillisecondsTimesTwo: boundedIntegral(
      byteMillisecondsTimesTwo,
      `${basis} byte-millisecond integral`
    ).toString(),
    divisor: 2,
  };
}

function checkedPhaseDurations(value: unknown): RunPhaseDurationsV1 {
  const candidate = exactRecord(value, PHASE_DURATION_KEYS, "long-run phase durations");
  return {
    setupMs: safeInteger(candidate.setupMs, "phases.setupMs"),
    compilationMs: safeInteger(candidate.compilationMs, "phases.compilationMs"),
    sourceScanMs: safeInteger(candidate.sourceScanMs, "phases.sourceScanMs"),
    searchActiveMs: safeInteger(candidate.searchActiveMs, "phases.searchActiveMs"),
    minimumReproductionMs: safeInteger(candidate.minimumReproductionMs, "phases.minimumReproductionMs"),
    checkpointWriteMs: safeInteger(candidate.checkpointWriteMs, "phases.checkpointWriteMs"),
    checkpointReopenMs: safeInteger(candidate.checkpointReopenMs, "phases.checkpointReopenMs"),
    replayScoringMs: safeInteger(candidate.replayScoringMs, "phases.replayScoringMs"),
    reportEnrichmentMs: safeInteger(candidate.reportEnrichmentMs, "phases.reportEnrichmentMs"),
    reportWriteMs: safeInteger(candidate.reportWriteMs, "phases.reportWriteMs"),
    finalizationMs: safeInteger(candidate.finalizationMs, "phases.finalizationMs"),
  };
}

function checkedByteTimeIntegral(
  value: unknown,
  expectedBasis: ByteTimeIntegralV1["basis"],
  name: string
): ByteTimeIntegralV1 {
  const candidate = exactRecord(value, BYTE_TIME_KEYS, name);
  if (candidate.basis !== expectedBasis) throw new RangeError(`${name}.basis is invalid`);
  if (candidate.divisor !== 2) throw new RangeError(`${name}.divisor must be 2`);
  return byteTimeIntegral(
    expectedBasis,
    canonicalIntegral(candidate.byteMillisecondsTimesTwo, `${name}.byteMillisecondsTimesTwo`)
  );
}

function checkedYieldRate(value: unknown, name: string): LongRunYieldRateV1 {
  const candidate = exactRecord(value, YIELD_RATE_KEYS, name);
  return {
    identities: safeInteger(candidate.identities, `${name}.identities`),
    identitiesPerMillionTransitions: finiteRate(
      candidate.identitiesPerMillionTransitions,
      `${name}.identitiesPerMillionTransitions`
    ),
    identitiesPerSearchActiveMinute: finiteRate(
      candidate.identitiesPerSearchActiveMinute,
      `${name}.identitiesPerSearchActiveMinute`
    ),
    identitiesPerRetainedGiBMinute: finiteRate(
      candidate.identitiesPerRetainedGiBMinute,
      `${name}.identitiesPerRetainedGiBMinute`
    ),
  };
}

function checkedYieldRates(value: unknown, name: string): LongRunYieldRatesV1 {
  const candidate = exactRecord(value, YIELD_KEYS, name);
  return {
    critical: checkedYieldRate(candidate.critical, `${name}.critical`),
    intent: checkedYieldRate(candidate.intent, `${name}.intent`),
    authoredCoverage: checkedYieldRate(candidate.authoredCoverage, `${name}.authoredCoverage`),
    visibleOutcomes: checkedYieldRate(candidate.visibleOutcomes, `${name}.visibleOutcomes`),
    semanticTransitions: checkedYieldRate(candidate.semanticTransitions, `${name}.semanticTransitions`),
    terminalVariants: checkedYieldRate(candidate.terminalVariants, `${name}.terminalVariants`),
  };
}

function sameRate(left: number | null, right: number | null): boolean {
  return left === right;
}

function checkedPassCost(value: unknown, index: number): LongRunPassCostV1 {
  const name = `long-run pass ${index}`;
  const candidate = exactRecord(value, PASS_COST_KEYS, name);
  if (candidate.schemaVersion !== 1) throw new RangeError(`${name}.schemaVersion must be 1`);
  const samplesObserved = safeInteger(candidate.samplesObserved, `${name}.samplesObserved`);
  const firstObservationElapsedMs = nullableSafeInteger(
    candidate.firstObservationElapsedMs,
    `${name}.firstObservationElapsedMs`
  );
  const lastObservationElapsedMs = nullableSafeInteger(
    candidate.lastObservationElapsedMs,
    `${name}.lastObservationElapsedMs`
  );
  const searchActiveMs = safeInteger(candidate.searchActiveMs, `${name}.searchActiveMs`);
  const transitions = safeInteger(candidate.transitions, `${name}.transitions`);
  const logicalRetained = checkedByteTimeIntegral(
    candidate.logicalRetained,
    "deterministic_logical_accounted_bytes",
    `${name}.logicalRetained`
  );
  const processRss = checkedByteTimeIntegral(
    candidate.processRss,
    "observed_process_rss_bytes",
    `${name}.processRss`
  );
  const observedYield = checkedYieldRates(candidate.yield, `${name}.yield`);

  if (samplesObserved === 0) {
    if (firstObservationElapsedMs !== null || lastObservationElapsedMs !== null
      || searchActiveMs !== 0
      || transitions !== 0
      || logicalRetained.byteMillisecondsTimesTwo !== "0"
      || processRss.byteMillisecondsTimesTwo !== "0") {
      throw new RangeError(`${name} zero-sample costs must have null bounds and zero integrals`);
    }
  } else {
    if (firstObservationElapsedMs === null || lastObservationElapsedMs === null
      || lastObservationElapsedMs < firstObservationElapsedMs
      || searchActiveMs !== lastObservationElapsedMs - firstObservationElapsedMs) {
      throw new RangeError(`${name} observation bounds do not match searchActiveMs`);
    }
    if (samplesObserved === 1
      && (transitions !== 0
        || searchActiveMs !== 0
        || logicalRetained.byteMillisecondsTimesTwo !== "0"
        || processRss.byteMillisecondsTimesTwo !== "0")) {
      throw new RangeError(`${name} one-sample costs cannot claim an interval`);
    }
    if (samplesObserved > 1 && samplesObserved - 1 > transitions) {
      throw new RangeError(`${name} cannot contain more ordered sample intervals than transitions`);
    }
  }

  if (searchActiveMs === 0
    && (logicalRetained.byteMillisecondsTimesTwo !== "0"
      || processRss.byteMillisecondsTimesTwo !== "0")) {
    throw new RangeError(`${name} zero-duration costs must have zero integrals`);
  }

  if (samplesObserved <= 1) {
    for (const key of YIELD_KEYS) {
      const category = observedYield[key];
      if (category.identities !== 0
        || category.identitiesPerMillionTransitions !== null
        || category.identitiesPerSearchActiveMinute !== null
        || category.identitiesPerRetainedGiBMinute !== null) {
        throw new RangeError(`${name}.yield.${key} must be zero with null rates without an observed interval`);
      }
    }
  }

  for (const key of YIELD_KEYS) {
    const expected = {
      identitiesPerMillionTransitions: rate(observedYield[key].identities, transitions, 1_000_000),
      identitiesPerSearchActiveMinute: rate(observedYield[key].identities, searchActiveMs, 60_000),
      identitiesPerRetainedGiBMinute: rate(
        observedYield[key].identities,
        BigInt(logicalRetained.byteMillisecondsTimesTwo),
        RETAINED_GIB_MINUTE_TIMES_TWO
      ),
    };
    if (!sameRate(observedYield[key].identitiesPerMillionTransitions, expected.identitiesPerMillionTransitions)
      || !sameRate(observedYield[key].identitiesPerSearchActiveMinute, expected.identitiesPerSearchActiveMinute)
      || !sameRate(observedYield[key].identitiesPerRetainedGiBMinute, expected.identitiesPerRetainedGiBMinute)) {
      throw new RangeError(`${name}.yield.${key} rates do not match their pass-local denominators`);
    }
  }

  return {
    schemaVersion: 1,
    pass: passName(candidate.pass, `${name}.pass`),
    samplesObserved,
    firstObservationElapsedMs,
    lastObservationElapsedMs,
    searchActiveMs,
    transitions,
    logicalRetained,
    processRss,
    yield: observedYield,
  };
}

/** Validate and detach a bounded telemetry value at a persistence or output boundary. */
export function validateLongRunTelemetryV1(value: unknown): LongRunTelemetryV1 {
  const candidate = exactRecord(value, TELEMETRY_KEYS, "long-run telemetry");
  if (candidate.schemaVersion !== 1) throw new RangeError("long-run telemetry schemaVersion must be 1");
  const passValues = denseDataArray(
    candidate.passes,
    "long-run telemetry passes",
    MAX_LONG_RUN_TELEMETRY_PASSES
  );
  const seen = new Set<string>();
  const passes: LongRunPassCostV1[] = [];
  for (let index = 0; index < passValues.length; index += 1) {
    const pass = checkedPassCost(passValues[index], index);
    if (seen.has(pass.pass)) {
      throw new RangeError("long-run telemetry pass labels must be unique");
    }
    seen.add(pass.pass);
    passes.push(pass);
  }
  return {
    schemaVersion: 1,
    phases: checkedPhaseDurations(candidate.phases),
    passes,
  };
}
