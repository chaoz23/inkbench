import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic, writeJsonAtomic } from "../core/atomic.js";
import { hash } from "../core/hash.js";
import { Prng } from "../core/prng.js";
import { InstrumentedController } from "../core/runtime.js";
import { SCHEMA_VERSION, type AlgorithmId, type BugDiscovery, type CoverageCounts, type Observation, type TransitionResult } from "../core/types.js";
import { runBenchmark } from "../core/run.js";
import { generateRevisionSequence, type LongitudinalRevision, type RevisionEditClass } from "./revisions.js";

export const LONGITUDINAL_EXPERIMENT_SCHEMA_VERSION = 1 as const;
export type LongitudinalArm =
  | "cold-random"
  | "cold-systematic"
  | "cold-coverage"
  | "cold-swarm"
  | "cold-inkcheck"
  | "warm-coverage"
  | "periodic-coverage"
  | "persistent-swarm"
  | "persistent-swarm-no-rogue";

export interface LongitudinalConfig {
  schemaVersion: typeof LONGITUDINAL_EXPERIMENT_SCHEMA_VERSION;
  sequenceSeeds: number[];
  partition: "development" | "validation" | "evaluation";
  revisions: number;
  arms: LongitudinalArm[];
  perRevisionBudget: number;
  storySeed: number;
  maxRoutes: number;
  maxCorpusBytes: number;
  rogueFraction: number;
  periodicRebuildEvery: number;
  inkcheckCommand?: string;
}

export interface RouteStep {
  choiceId: string;
  choiceTextSha256: string;
  choiceIndex: number;
  availableChoicesSha256: string;
}

export type RouteStatus = "valid" | "rebased" | "divergent" | "dominated" | "pruned";

export interface RouteRecipe {
  schemaVersion: 1;
  routeId: string;
  sourceRevisionId: string;
  steps: RouteStep[];
  finalLocation: string;
  finalSemanticKey: string;
  finalChoicesSha256: string;
  depth: number;
  historicalLaunches: number;
  cumulativeYield: number;
  replaySuccesses: number;
  replayFailures: number;
  lastProductiveRevision: number;
  status: RouteStatus;
}

export interface RouteCorpus {
  schemaVersion: 1;
  sequenceId: string;
  arm: LongitudinalArm;
  revisionId: string | null;
  routes: RouteRecipe[];
  prunedRoutes: number;
  rebuilds: number;
}

export interface LongitudinalCellResult {
  schemaVersion: typeof LONGITUDINAL_EXPERIMENT_SCHEMA_VERSION;
  cellId: string;
  sequenceId: string;
  sequenceSeed: number;
  partition: LongitudinalConfig["partition"];
  revision: number;
  revisionId: string;
  parentRevisionId: string | null;
  editClass: RevisionEditClass;
  arm: LongitudinalArm;
  budget: number;
  transitions: number;
  replayTransitions: number;
  explorationTransitions: number;
  replayAttempts: number;
  replaySuccesses: number;
  replayFailures: number;
  rootRogueLaunches: number;
  discoveredBugIds: string[];
  discoveries: BugDiscovery[];
  coverage: CoverageCounts;
  wallMs: number;
  cpuMs: number;
  corpusRoutes: number;
  corpusBytes: number;
  peakCorpusRoutes: number;
  peakCorpusBytes: number;
  prunedRoutes: number;
  rebuiltBeforeRevision: boolean;
  retainedByteMs: number;
  decisionsSha256: string;
  corpusState: RouteCorpus;
}

export interface LongitudinalArmSummary {
  arm: LongitudinalArm;
  cells: number;
  cumulativeTransitions: number;
  replayTransitions: number;
  cumulativeWallMs: number;
  distinctBugs: number;
  discoveries: number;
  meanCorpusBytes: number;
  peakCorpusBytes: number;
  staleRouteFailures: number;
  retainedByteMs: number;
  breakEvenRevisionVersusColdCoverage: number | null;
}

export interface LongitudinalSummary {
  schemaVersion: typeof LONGITUDINAL_EXPERIMENT_SCHEMA_VERSION;
  generatedAt: string;
  config: LongitudinalConfig;
  experimentFingerprint: string;
  totalCells: number;
  arms: LongitudinalArmSummary[];
  learningCurve: Array<{
    arm: LongitudinalArm;
    revision: number;
    editClass: RevisionEditClass;
    cells: number;
    bugDiscoveries: number;
    meanTransitions: number;
    meanReplayShare: number;
    meanCorpusBytes: number;
    meanReplaySuccessRate: number | null;
  }>;
  competenceByEditClass: Array<{ arm: LongitudinalArm; editClass: RevisionEditClass; cells: number; discoveries: number; replayFailures: number }>;
  complementarity: Array<{ revision: number; editClass: RevisionEditClass; patternCounts: Record<string, number> }>;
  interpretation: string[];
}

export interface LongitudinalExperimentResult {
  revisions: LongitudinalRevision[];
  cells: LongitudinalCellResult[];
  summary: LongitudinalSummary;
}

export interface LongitudinalRunOptions {
  outputDirectory?: string;
  resume?: boolean;
  generatedAt?: string;
  onCell?: (cell: LongitudinalCellResult, completed: number, total: number, resumed: boolean) => void;
}

interface CurrentColony {
  observation: Observation;
  snapshotId: string;
  novelty: number;
  launches: number;
  yield: number;
  attempts: number[];
}

function validateConfig(config: LongitudinalConfig): void {
  if (config.schemaVersion !== 1) throw new RangeError("longitudinal config schemaVersion must be 1");
  if (config.sequenceSeeds.length === 0 || new Set(config.sequenceSeeds).size !== config.sequenceSeeds.length) throw new RangeError("sequenceSeeds must be non-empty and unique");
  if (config.arms.length === 0 || new Set(config.arms).size !== config.arms.length) throw new RangeError("arms must be non-empty and unique");
  if (!Number.isSafeInteger(config.revisions) || config.revisions < 1 || config.revisions > 30) throw new RangeError("revisions must be 1..30");
  for (const field of ["perRevisionBudget", "storySeed", "maxRoutes", "maxCorpusBytes", "periodicRebuildEvery"] as const) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1) throw new RangeError(`${field} must be a positive integer`);
  }
  if (config.maxCorpusBytes < 1_024) throw new RangeError("maxCorpusBytes must leave at least 1024 bytes for corpus metadata");
  if (!(config.rogueFraction >= 0 && config.rogueFraction <= 1)) throw new RangeError("rogueFraction must be between 0 and 1");
  if (config.arms.includes("cold-inkcheck") && !config.inkcheckCommand) throw new RangeError("cold-inkcheck requires inkcheckCommand");
  for (const seed of config.sequenceSeeds) generateRevisionSequence(seed, config.partition, 1);
}

function emptyCorpus(sequenceId: string, arm: LongitudinalArm): RouteCorpus {
  return { schemaVersion: 1, sequenceId, arm, revisionId: null, routes: [], prunedRoutes: 0, rebuilds: 0 };
}

function routeCorpusBytes(corpus: RouteCorpus): number {
  return Buffer.byteLength(JSON.stringify(corpus), "utf8");
}

function choiceConfiguration(observation: Observation): string {
  return hash(observation.choices.map((choice) => choice.id), 64);
}

function routeFromTransition(
  revision: LongitudinalRevision,
  transition: TransitionResult,
  steps: RouteStep[],
  novelty: number,
): RouteRecipe {
  const after = transition.after;
  const routeId = hash({ steps, finalLocation: after.location }, 32);
  return {
    schemaVersion: 1,
    routeId,
    sourceRevisionId: revision.revisionId,
    steps,
    finalLocation: after.location,
    finalSemanticKey: after.semanticKey,
    finalChoicesSha256: choiceConfiguration(after),
    depth: after.depth,
    historicalLaunches: 0,
    cumulativeYield: novelty,
    replaySuccesses: 0,
    replayFailures: 0,
    lastProductiveRevision: novelty > 0 ? revision.revision : 0,
    status: "valid",
  };
}

function routeRecipeBytes(route: RouteRecipe): number {
  return Buffer.byteLength(JSON.stringify(route), "utf8");
}

function mergeRoute(corpus: RouteCorpus, candidate: RouteRecipe, revision: number): number {
  const existing = corpus.routes.find((route) => route.routeId === candidate.routeId);
  if (!existing) {
    const separatorBytes = corpus.routes.length > 0 ? 1 : 0;
    corpus.routes.push(candidate);
    return routeRecipeBytes(candidate) + separatorBytes;
  }
  const previousBytes = routeRecipeBytes(existing);
  existing.cumulativeYield += candidate.cumulativeYield;
  if (candidate.cumulativeYield > 0) existing.lastProductiveRevision = revision;
  if (candidate.depth > existing.depth || candidate.sourceRevisionId !== existing.sourceRevisionId) {
    existing.sourceRevisionId = candidate.sourceRevisionId;
    existing.steps = candidate.steps;
    existing.finalLocation = candidate.finalLocation;
    existing.finalSemanticKey = candidate.finalSemanticKey;
    existing.finalChoicesSha256 = candidate.finalChoicesSha256;
    existing.depth = candidate.depth;
  }
  existing.status = "valid";
  return routeRecipeBytes(existing) - previousBytes;
}

function pruneCorpus(corpus: RouteCorpus, config: LongitudinalConfig, revision: number): void {
  const score = (route: RouteRecipe): number => {
    const productivity = (route.cumulativeYield + 1) / (route.historicalLaunches + route.replayFailures + 1);
    const staleness = revision - route.lastProductiveRevision;
    const toxicity = route.replayFailures / (route.replaySuccesses + route.replayFailures + 1);
    return productivity + route.depth * 0.02 - staleness * 0.05 - toxicity * 4;
  };
  corpus.routes.sort((left, right) => score(right) - score(left) || left.routeId.localeCompare(right.routeId));
  while (corpus.routes.length > config.maxRoutes || routeCorpusBytes(corpus) > config.maxCorpusBytes) {
    const removed = corpus.routes.pop();
    if (!removed) break;
    removed.status = "pruned";
    corpus.prunedRoutes += 1;
  }
}

function coldAlgorithm(arm: LongitudinalArm): AlgorithmId | null {
  if (arm === "cold-random") return "random";
  if (arm === "cold-systematic") return "systematic";
  if (arm === "cold-coverage") return "coverage";
  if (arm === "cold-swarm") return "swarm";
  if (arm === "cold-inkcheck") return "inkcheck";
  return null;
}

function runColdCell(config: LongitudinalConfig, revision: LongitudinalRevision, arm: LongitudinalArm, corpus: RouteCorpus): Omit<LongitudinalCellResult, "cellId"> {
  const algorithm = coldAlgorithm(arm)!;
  const wallStart = performance.now();
  const cpuStart = process.cpuUsage();
  const report = runBenchmark({
    fixture: revision.fixture,
    algorithm,
    searchSeed: revision.sequenceSeed,
    storySeed: config.storySeed,
    budget: config.perRevisionBudget,
    ...(config.inkcheckCommand ? { inkcheckCommand: config.inkcheckCommand } : {}),
  });
  const cpu = process.cpuUsage(cpuStart);
  const wallMs = performance.now() - wallStart;
  const finalCorpus = { ...corpus, revisionId: revision.revisionId, routes: [] };
  return {
    schemaVersion: 1,
    sequenceId: revision.sequenceId,
    sequenceSeed: revision.sequenceSeed,
    partition: revision.partition,
    revision: revision.revision,
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    editClass: revision.editClass,
    arm,
    budget: config.perRevisionBudget,
    transitions: report.counts.transitions,
    replayTransitions: 0,
    explorationTransitions: report.counts.transitions,
    replayAttempts: 0,
    replaySuccesses: 0,
    replayFailures: 0,
    rootRogueLaunches: 0,
    discoveredBugIds: report.discoveredBugs.map((item) => item.bugId),
    discoveries: report.discoveredBugs,
    coverage: report.coverage ?? { locations: 0, choiceConfigurations: 0, choices: 0, edges: 0, semanticStates: 0, rawStates: 0, variableValues: 0, variableTransitions: 0 },
    wallMs,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    corpusRoutes: 0,
    corpusBytes: 0,
    peakCorpusRoutes: 0,
    peakCorpusBytes: 0,
    prunedRoutes: 0,
    rebuiltBeforeRevision: false,
    retainedByteMs: 0,
    decisionsSha256: hash({ runId: report.runId, discoveries: report.discoveredBugs, coverage: report.coverage }, 64),
    corpusState: finalCorpus,
  };
}

function runPersistentCell(
  config: LongitudinalConfig,
  revision: LongitudinalRevision,
  arm: LongitudinalArm,
  priorCorpus: RouteCorpus,
): Omit<LongitudinalCellResult, "cellId"> {
  const periodicReset = arm === "periodic-coverage" && revision.revision > 0 && revision.revision % config.periodicRebuildEvery === 0;
  const corpus: RouteCorpus = periodicReset
    ? { ...emptyCorpus(revision.sequenceId, arm), rebuilds: priorCorpus.rebuilds + 1 }
    : structuredClone(priorCorpus);
  corpus.arm = arm;
  const policySeed = Number.parseInt(hash({ sequenceSeed: revision.sequenceSeed, arm, revision: revision.revision }, 12), 16);
  const rng = new Prng(policySeed);
  const wallStart = performance.now();
  const cpuStart = process.cpuUsage();
  const pathSteps = new Map<string, RouteStep[]>();
  const decisions: string[] = [];
  let replayTransitions = 0;
  let replayAttempts = 0;
  let replaySuccesses = 0;
  let replayFailures = 0;
  let rogueLaunches = 0;
  let peakCorpusRoutes = corpus.routes.length;
  let currentCorpusBytes = routeCorpusBytes(corpus);
  let peakCorpusBytes = currentCorpusBytes;
  const controller = new InstrumentedController(revision.fixture, config.perRevisionBudget, config.storySeed, {
    onTransition: (transition) => {
      const parentSteps = pathSteps.get(JSON.stringify(transition.before.choicePath)) ?? [];
      const step: RouteStep = {
        choiceId: transition.choice.id,
        choiceTextSha256: hash(transition.choice.text, 64),
        choiceIndex: transition.choice.index,
        availableChoicesSha256: choiceConfiguration(transition.before),
      };
      const steps = [...parentSteps, step];
      pathSteps.set(JSON.stringify(transition.after.choicePath), steps);
      const novelty = transition.coverageDelta.total;
      currentCorpusBytes += mergeRoute(corpus, routeFromTransition(revision, transition, steps, novelty), revision.revision);
      if (corpus.routes.length > config.maxRoutes || currentCorpusBytes > config.maxCorpusBytes) {
        pruneCorpus(corpus, config, revision.revision);
        currentCorpusBytes = routeCorpusBytes(corpus);
      }
      decisions.push(`${transition.before.semanticKey}:${transition.choice.id}`);
      peakCorpusRoutes = Math.max(peakCorpusRoutes, corpus.routes.length);
      peakCorpusBytes = Math.max(peakCorpusBytes, currentCorpusBytes);
    },
  });
  const colonies = new Map<string, CurrentColony>();
  const addColony = (observation: Observation, novelty: number): void => {
    if (observation.terminal || observation.choices.length === 0 || colonies.has(observation.semanticKey)) return;
    controller.retain(observation.snapshotId);
    colonies.set(observation.semanticKey, {
      observation,
      snapshotId: observation.snapshotId,
      novelty,
      launches: 0,
      yield: novelty,
      attempts: observation.choices.map(() => 0),
    });
  };
  const root = controller.launch();
  pathSteps.set(JSON.stringify(root.choicePath), []);
  addColony(root, 1);
  for (const recipe of [...corpus.routes].sort((left, right) => right.cumulativeYield - left.cumulativeYield || left.routeId.localeCompare(right.routeId))) {
    if (controller.exhausted) break;
    replayAttempts += 1;
    recipe.historicalLaunches += 1;
    let observation = controller.launch();
    let valid = true;
    let rebased = false;
    const replayed: RouteStep[] = [];
    for (const step of recipe.steps) {
      if (controller.exhausted || observation.choices.length === 0) {
        valid = false;
        break;
      }
      let choice = observation.choices.find((candidate) => candidate.id === step.choiceId);
      if (!choice) {
        choice = observation.choices.find((candidate) => hash(candidate.text, 64) === step.choiceTextSha256);
        if (choice) rebased = true;
      }
      if (!choice && choiceConfiguration(observation) === step.availableChoicesSha256) choice = observation.choices[step.choiceIndex];
      if (!choice) {
        valid = false;
        break;
      }
      const result = controller.step(choice.index);
      replayTransitions += 1;
      replayed.push({ choiceId: choice.id, choiceTextSha256: hash(choice.text, 64), choiceIndex: choice.index, availableChoicesSha256: choiceConfiguration(result.before) });
      pathSteps.set(JSON.stringify(result.after.choicePath), [...replayed]);
      observation = result.after;
    }
    if (valid && observation.location === recipe.finalLocation) {
      replaySuccesses += 1;
      recipe.replaySuccesses += 1;
      recipe.status = rebased ? "rebased" : "valid";
      if (rebased) {
        recipe.steps = replayed;
        recipe.sourceRevisionId = revision.revisionId;
      }
      addColony(observation, recipe.cumulativeYield / (recipe.historicalLaunches + 1));
    } else {
      replayFailures += 1;
      recipe.replayFailures += 1;
      recipe.status = "divergent";
    }
  }

  const isSwarm = arm === "persistent-swarm" || arm === "persistent-swarm-no-rogue";
  const rogueFraction = arm === "persistent-swarm-no-rogue" ? 0 : isSwarm ? config.rogueFraction : 0;
  while (!controller.exhausted) {
    const active = [...colonies.values()].filter((colony) => colony.observation.choices.length > 0);
    const rogue = rng.next() < rogueFraction || active.length === 0;
    let colony: CurrentColony;
    if (rogue) {
      rogueLaunches += 1;
      colony = colonies.get(root.semanticKey)!;
    } else {
      const ranked = active.sort((left, right) => {
        const leftScore = isSwarm
          ? (left.yield + left.novelty + left.observation.depth * 0.1 + 1) / (left.launches + 1)
          : left.attempts.reduce((sum, value) => sum + 1 / (value + 1), 0) + left.novelty * 2 + left.observation.depth * 0.05;
        const rightScore = isSwarm
          ? (right.yield + right.novelty + right.observation.depth * 0.1 + 1) / (right.launches + 1)
          : right.attempts.reduce((sum, value) => sum + 1 / (value + 1), 0) + right.novelty * 2 + right.observation.depth * 0.05;
        return rightScore - leftScore || left.observation.semanticKey.localeCompare(right.observation.semanticKey);
      });
      colony = isSwarm ? ranked[rng.integer(Math.min(ranked.length, 8))]! : ranked[0]!;
    }
    let observation = controller.launch(rogue ? controller.rootSnapshotId : colony.snapshotId);
    colony.launches += 1;
    const energy = isSwarm ? 1 + rng.integer(4) : 1;
    for (let index = 0; index < energy && !controller.exhausted && observation.choices.length > 0; index += 1) {
      let choiceIndex: number;
      if (rogue) choiceIndex = rng.integer(observation.choices.length);
      else {
        const minimum = Math.min(...colony.attempts);
        const options = colony.attempts.map((attempts, choice) => ({ attempts, choice })).filter((item) => item.attempts === minimum);
        choiceIndex = options[isSwarm ? rng.integer(options.length) : 0]!.choice;
        colony.attempts[choiceIndex] = (colony.attempts[choiceIndex] ?? 0) + 1;
      }
      const result = controller.step(choiceIndex);
      colony.yield += result.coverageDelta.total;
      addColony(result.after, result.coverageDelta.total);
      observation = result.after;
      const child = colonies.get(result.after.semanticKey);
      if (child) colony = child;
    }
  }
  corpus.revisionId = revision.revisionId;
  pruneCorpus(corpus, config, revision.revision);
  for (const colony of colonies.values()) {
    if (colony.snapshotId !== controller.rootSnapshotId) {
      try { controller.release(colony.snapshotId); } catch { /* snapshot may share a released route */ }
    }
  }
  const cpu = process.cpuUsage(cpuStart);
  const wallMs = performance.now() - wallStart;
  const corpusBytes = routeCorpusBytes(corpus);
  return {
    schemaVersion: 1,
    sequenceId: revision.sequenceId,
    sequenceSeed: revision.sequenceSeed,
    partition: revision.partition,
    revision: revision.revision,
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    editClass: revision.editClass,
    arm,
    budget: config.perRevisionBudget,
    transitions: controller.transitions,
    replayTransitions,
    explorationTransitions: controller.transitions - replayTransitions,
    replayAttempts,
    replaySuccesses,
    replayFailures,
    rootRogueLaunches: rogueLaunches,
    discoveredBugIds: controller.bugDiscoveries.map((item) => item.bugId),
    discoveries: controller.bugDiscoveries,
    coverage: controller.coverage,
    wallMs,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    corpusRoutes: corpus.routes.length,
    corpusBytes,
    peakCorpusRoutes,
    peakCorpusBytes,
    prunedRoutes: corpus.prunedRoutes,
    rebuiltBeforeRevision: periodicReset,
    retainedByteMs: corpusBytes * wallMs,
    decisionsSha256: hash(decisions, 64),
    corpusState: corpus,
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(config: LongitudinalConfig, cells: LongitudinalCellResult[], fingerprint: string, generatedAt: string): LongitudinalSummary {
  const coldCoverageBySequenceRevision = new Map(cells.filter((cell) => cell.arm === "cold-coverage").map((cell) => [`${cell.sequenceSeed}:${cell.revision}`, cell]));
  const arms = config.arms.map((arm) => {
    const selected = cells.filter((cell) => cell.arm === arm);
    const distinct = new Set(selected.flatMap((cell) => cell.discoveredBugIds));
    let breakEven: number | null = null;
    let ownCumulative = 0;
    let coldCumulative = 0;
    for (const revision of Array.from({ length: config.revisions }, (_, index) => index)) {
      ownCumulative += selected.filter((cell) => cell.revision === revision).reduce((sum, cell) => sum + cell.transitions, 0);
      coldCumulative += [...coldCoverageBySequenceRevision.entries()].filter(([key]) => key.endsWith(`:${revision}`)).reduce((sum, [, cell]) => sum + cell.transitions, 0);
      const ownBugs = new Set(selected.filter((cell) => cell.revision <= revision).flatMap((cell) => cell.discoveredBugIds)).size;
      const coldBugs = new Set(cells.filter((cell) => cell.arm === "cold-coverage" && cell.revision <= revision).flatMap((cell) => cell.discoveredBugIds)).size;
      if (breakEven === null && coldBugs > 0 && ownBugs >= coldBugs && ownCumulative <= coldCumulative) breakEven = revision;
    }
    return {
      arm,
      cells: selected.length,
      cumulativeTransitions: selected.reduce((sum, cell) => sum + cell.transitions, 0),
      replayTransitions: selected.reduce((sum, cell) => sum + cell.replayTransitions, 0),
      cumulativeWallMs: selected.reduce((sum, cell) => sum + cell.wallMs, 0),
      distinctBugs: distinct.size,
      discoveries: selected.reduce((sum, cell) => sum + cell.discoveredBugIds.length, 0),
      meanCorpusBytes: mean(selected.map((cell) => cell.corpusBytes)),
      peakCorpusBytes: selected.length === 0 ? 0 : Math.max(...selected.map((cell) => cell.peakCorpusBytes)),
      staleRouteFailures: selected.reduce((sum, cell) => sum + cell.replayFailures, 0),
      retainedByteMs: selected.reduce((sum, cell) => sum + cell.retainedByteMs, 0),
      breakEvenRevisionVersusColdCoverage: breakEven,
    };
  });
  const learningCurve = config.arms.flatMap((arm) => Array.from({ length: config.revisions }, (_, revision) => {
    const selected = cells.filter((cell) => cell.arm === arm && cell.revision === revision);
    const attempts = selected.reduce((sum, cell) => sum + cell.replayAttempts, 0);
    return {
      arm,
      revision,
      editClass: selected[0]!.editClass,
      cells: selected.length,
      bugDiscoveries: selected.reduce((sum, cell) => sum + cell.discoveredBugIds.length, 0),
      meanTransitions: mean(selected.map((cell) => cell.transitions)),
      meanReplayShare: mean(selected.map((cell) => cell.transitions === 0 ? 0 : cell.replayTransitions / cell.transitions)),
      meanCorpusBytes: mean(selected.map((cell) => cell.corpusBytes)),
      meanReplaySuccessRate: attempts === 0 ? null : selected.reduce((sum, cell) => sum + cell.replaySuccesses, 0) / attempts,
    };
  }));
  const editClasses = [...new Set(cells.map((cell) => cell.editClass))];
  const competenceByEditClass = config.arms.flatMap((arm) => editClasses.map((editClass) => {
    const selected = cells.filter((cell) => cell.arm === arm && cell.editClass === editClass);
    return { arm, editClass, cells: selected.length, discoveries: selected.reduce((sum, cell) => sum + cell.discoveredBugIds.length, 0), replayFailures: selected.reduce((sum, cell) => sum + cell.replayFailures, 0) };
  }));
  const complementarity = Array.from({ length: config.revisions }, (_, revision) => {
    const selected = cells.filter((cell) => cell.revision === revision);
    const patterns: Record<string, number> = {};
    for (const seed of config.sequenceSeeds) {
      const finders = selected.filter((cell) => cell.sequenceSeed === seed && cell.discoveredBugIds.length > 0).map((cell) => cell.arm);
      const pattern = finders.length === 0 ? "none" : finders.join("+");
      patterns[pattern] = (patterns[pattern] ?? 0) + 1;
    }
    return { revision, editClass: selected[0]!.editClass, patternCounts: patterns };
  });
  return {
    schemaVersion: 1,
    generatedAt,
    config,
    experimentFingerprint: fingerprint,
    totalCells: cells.length,
    arms,
    learningCurve,
    competenceByEditClass,
    complementarity,
    interpretation: [
      "Every arm receives the same per-revision and cumulative transition grant; replay and rebase transitions are charged inside that grant.",
      "Cross-revision persistence stores replay recipes only. Raw Ink save states are never trusted across revision identities.",
      "Route reinforcement and pruning use runtime novelty, replay success, age, and yield only; bug IDs and oracle values are not policy inputs.",
      "Results are an experiment scaffold, not a superiority claim. Development sequences must not be reused as blind evaluation sequences.",
    ],
  };
}

export function defaultLongitudinalConfig(): LongitudinalConfig {
  return {
    schemaVersion: 1,
    sequenceSeeds: [1, 2, 3],
    partition: "development",
    revisions: 12,
    arms: ["cold-random", "cold-systematic", "cold-coverage", "cold-swarm", "warm-coverage", "periodic-coverage", "persistent-swarm", "persistent-swarm-no-rogue"],
    perRevisionBudget: 200,
    storySeed: 1,
    maxRoutes: 128,
    maxCorpusBytes: 512_000,
    rogueFraction: 0.15,
    periodicRebuildEvery: 4,
  };
}

export function runLongitudinalExperiment(config: LongitudinalConfig, options: LongitudinalRunOptions = {}): LongitudinalExperimentResult {
  validateConfig(config);
  const revisionsBySeed = new Map(config.sequenceSeeds.map((seed) => [seed, generateRevisionSequence(seed, config.partition, config.revisions)]));
  const revisions = [...revisionsBySeed.values()].flat();
  const scheduled = config.sequenceSeeds.flatMap((seed) => config.arms.flatMap((arm) => revisionsBySeed.get(seed)!.map((revision) => ({ seed, arm, revision }))));
  const scheduledCellIds = scheduled.map(({ seed, arm, revision }) => hash({ schemaVersion: 1, config, seed, arm, revisionId: revision.revisionId }, 32));
  const fingerprint = hash({ config, revisions: revisions.map((revision) => revision.revisionId), scheduledCellIds }, 64);
  const cells: LongitudinalCellResult[] = [];
  const output = options.outputDirectory;
  if (output) {
    mkdirSync(join(output, "cells"), { recursive: true });
    const statePath = join(output, "matrix-state.json");
    if (options.resume && existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { schemaVersion?: number; experimentFingerprint?: string; scheduledCellIds?: string[] };
      if (state.schemaVersion !== 1 || state.experimentFingerprint !== fingerprint || JSON.stringify(state.scheduledCellIds) !== JSON.stringify(scheduledCellIds)) {
        throw new Error("longitudinal resume identity mismatch; use a fresh output directory");
      }
    }
    writeJsonAtomic(join(output, "config.json"), config);
    writeJsonAtomic(join(output, "revision-sequence.json"), revisions.map(({ fixture: _fixture, ...record }) => record));
  }
  const corpora = new Map<string, RouteCorpus>();
  for (let index = 0; index < scheduled.length; index += 1) {
    const { arm, revision } = scheduled[index]!;
    const cellId = scheduledCellIds[index]!;
    const key = `${revision.sequenceSeed}:${arm}`;
    const cellPath = output ? join(output, "cells", `${cellId}.json`) : null;
    if (options.resume && cellPath && existsSync(cellPath)) {
      const saved = JSON.parse(readFileSync(cellPath, "utf8")) as LongitudinalCellResult;
      if (saved.cellId !== cellId || saved.revisionId !== revision.revisionId || saved.arm !== arm) throw new Error(`invalid resumed longitudinal cell ${cellId}`);
      cells.push(saved);
      corpora.set(key, saved.corpusState);
      options.onCell?.(saved, cells.length, scheduled.length, true);
      continue;
    }
    const corpus = corpora.get(key) ?? emptyCorpus(revision.sequenceId, arm);
    const base = coldAlgorithm(arm)
      ? runColdCell(config, revision, arm, corpus)
      : runPersistentCell(config, revision, arm, corpus);
    const cell: LongitudinalCellResult = { ...base, cellId };
    cells.push(cell);
    corpora.set(key, cell.corpusState);
    if (cellPath) writeJsonAtomic(cellPath, cell);
    if (output) writeJsonAtomic(join(output, "matrix-state.json"), {
      schemaVersion: 1,
      status: cells.length === scheduled.length ? "complete" : "running",
      completedCells: cells.length,
      totalCells: scheduled.length,
      experimentFingerprint: fingerprint,
      scheduledCellIds,
      completedCellIds: cells.map((item) => item.cellId),
    });
    options.onCell?.(cell, cells.length, scheduled.length, false);
  }
  const summary = summarize(config, cells, fingerprint, options.generatedAt ?? new Date().toISOString());
  if (output) {
    writeFileAtomic(join(output, "runs.ndjson"), `${cells.map((cell) => JSON.stringify(cell)).join("\n")}\n`);
    writeJsonAtomic(join(output, "summary.json"), summary);
  }
  return { revisions, cells, summary };
}
