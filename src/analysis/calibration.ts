import { oracleNeutralInkSource } from "../adapters/inkcheck.js";
import { Prng } from "../core/prng.js";
import { InstrumentedController } from "../core/runtime.js";
import { hash } from "../core/hash.js";
import type { BugFamily, GeneratedFixture } from "../core/types.js";
import { generateFixture } from "../fixtures/generate.js";

export interface InstrumentationCalibrationCell {
  family: BugFamily;
  fixtureSeed: number;
  searchSeed: number;
  budget: number;
  executionOrder: "without-then-with" | "with-then-without";
  decisionsSha256: string;
  withCommonInstrumentation: { wallMs: number; peakRssGrowthBytes: number; peakHeapGrowthBytes: number; coverageIndexBytes: number };
  withoutCommonInstrumentation: { wallMs: number; peakRssGrowthBytes: number; peakHeapGrowthBytes: number; coverageIndexBytes: number };
  wallOverheadFraction: number | null;
  rssOverheadBytes: number;
  heapOverheadBytes: number;
}

export interface InstrumentationCalibrationReport {
  schemaVersion: 1;
  generatedAt: string;
  comparisonProfile: "common-observation-and-coverage-instrumentation";
  cells: InstrumentationCalibrationCell[];
  medianWallOverheadFraction: number | null;
  medianRssOverheadBytes: number;
  medianHeapOverheadBytes: number;
  interpretation: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function calibrationRun(fixture: GeneratedFixture, budget: number, seed: number, trackCoverage: boolean) {
  const rng = new Prng(seed);
  const baseline = process.memoryUsage();
  let peakRssGrowthBytes = 0;
  let peakHeapGrowthBytes = 0;
  const decisions: string[] = [];
  const wallStart = performance.now();
  const sampleMemory = (): void => {
    const current = process.memoryUsage();
    peakRssGrowthBytes = Math.max(peakRssGrowthBytes, current.rss - baseline.rss);
    peakHeapGrowthBytes = Math.max(peakHeapGrowthBytes, current.heapUsed - baseline.heapUsed);
  };
  const controller = new InstrumentedController(fixture, budget, 1, {
    trackCoverage,
    onTransition: (transition) => {
      decisions.push(`${transition.before.semanticKey}:${transition.choice.id}`);
      sampleMemory();
    },
  });
  sampleMemory();
  let observation = controller.launch();
  sampleMemory();
  while (!controller.exhausted) {
    if (observation.choices.length === 0) {
      observation = controller.launch();
      if (observation.choices.length === 0) break;
    }
    observation = controller.step(rng.integer(observation.choices.length)).after;
  }
  return {
    wallMs: performance.now() - wallStart,
    peakRssGrowthBytes,
    peakHeapGrowthBytes,
    coverageIndexBytes: controller.coverageIndexBytes,
    decisionsSha256: hash(decisions, 64),
  };
}

export function calibrateInstrumentation(
  families: BugFamily[],
  fixtureSeeds: number[],
  budget = 1_000,
  difficulty = 3,
  generatedAt = new Date().toISOString(),
): InstrumentationCalibrationReport {
  const cells: InstrumentationCalibrationCell[] = [];
  for (let familyIndex = 0; familyIndex < families.length; familyIndex += 1) for (let seedIndex = 0; seedIndex < fixtureSeeds.length; seedIndex += 1) {
    const family = families[familyIndex]!;
    const fixtureSeed = fixtureSeeds[seedIndex]!;
    const fixture = generateFixture(family, fixtureSeed, difficulty);
    const withFirst = (familyIndex + seedIndex) % 2 === 1;
    const first = calibrationRun(fixture, budget, fixtureSeed, withFirst);
    const second = calibrationRun(fixture, budget, fixtureSeed, !withFirst);
    const withCommon = withFirst ? first : second;
    const without = withFirst ? second : first;
    if (without.decisionsSha256 !== withCommon.decisionsSha256) throw new Error(`${family}/${fixtureSeed}: calibration decisions diverged`);
    cells.push({
      family,
      fixtureSeed,
      searchSeed: fixtureSeed,
      budget,
      executionOrder: withFirst ? "with-then-without" : "without-then-with",
      decisionsSha256: withCommon.decisionsSha256,
      withCommonInstrumentation: withCommon,
      withoutCommonInstrumentation: without,
      wallOverheadFraction: without.wallMs === 0 ? null : (withCommon.wallMs - without.wallMs) / without.wallMs,
      rssOverheadBytes: withCommon.peakRssGrowthBytes - without.peakRssGrowthBytes,
      heapOverheadBytes: withCommon.peakHeapGrowthBytes - without.peakHeapGrowthBytes,
    });
  }
  const wall = cells.flatMap((cell) => cell.wallOverheadFraction === null ? [] : [cell.wallOverheadFraction]);
  return {
    schemaVersion: 1,
    generatedAt,
    comparisonProfile: "common-observation-and-coverage-instrumentation",
    cells,
    medianWallOverheadFraction: wall.length === 0 ? null : median(wall),
    medianRssOverheadBytes: median(cells.map((cell) => cell.rssOverheadBytes)),
    medianHeapOverheadBytes: median(cells.map((cell) => cell.heapOverheadBytes)),
    interpretation: "This paired, counterbalanced calibration compares InkBench common observation/coverage accounting on identical choice decisions. Memory fields measure growth above each run's starting process baseline. Individual cells remain noisy; it does not convert external-tool native telemetry into common instrumentation cost.",
  };
}

export interface OraclePlaceboAudit {
  schemaVersion: 1;
  family: BugFamily;
  seeds: number;
  forbiddenCueLeaks: number;
  sourceOrderProbeWins: number;
  lexicalEndpointProbeWins: number;
  sourceOrderAdvantage: number;
  lexicalEndpointAdvantage: number;
  passesChanceTolerance: boolean;
}

export function auditSourceAwarePlacebos(family: BugFamily, seeds: number[], difficulty = 3, tolerance = 0.15): OraclePlaceboAudit {
  let forbiddenCueLeaks = 0;
  let sourceOrderProbeWins = 0;
  let lexicalEndpointProbeWins = 0;
  for (const seed of seeds) {
    const fixture = generateFixture(family, seed, difficulty);
    const neutral = oracleNeutralInkSource(fixture.source, { fixture, algorithm: "inkcheck", searchSeed: seed, storySeed: 1, budget: 1 }, false, false);
    if (/\b(?:bug|safe|fault|target|control|oracle|planted)\b|INKBENCH_(?:BUG|SIGNAL)|\bib_bug\b/i.test(neutral)) forbiddenCueLeaks += 1;
    const target = String(fixture.manifest.parameters.targetEndpoint);
    const control = String(fixture.manifest.parameters.controlEndpoint);
    if (neutral.indexOf(`=== ${target} ===`) < neutral.indexOf(`=== ${control} ===`)) sourceOrderProbeWins += 1;
    if (target.localeCompare(control) < 0) lexicalEndpointProbeWins += 1;
  }
  const sourceOrderAdvantage = Math.abs(sourceOrderProbeWins / seeds.length - 0.5);
  const lexicalEndpointAdvantage = Math.abs(lexicalEndpointProbeWins / seeds.length - 0.5);
  return {
    schemaVersion: 1,
    family,
    seeds: seeds.length,
    forbiddenCueLeaks,
    sourceOrderProbeWins,
    lexicalEndpointProbeWins,
    sourceOrderAdvantage,
    lexicalEndpointAdvantage,
    passesChanceTolerance: forbiddenCueLeaks === 0 && sourceOrderAdvantage <= tolerance && lexicalEndpointAdvantage <= tolerance,
  };
}
