import { hash, stableJson } from "../core/hash.js";
import { Prng } from "../core/prng.js";
import type { Observation, TransitionResult } from "../core/types.js";
import type { Searcher } from "./types.js";

interface Colony {
  snapshotId: string;
  observation: Observation;
  novelty: number;
  launches: number;
  yield: number;
  lastProductiveTransition: number;
  choiceAttempts: number[];
  behavioralKey: string;
  zeroYieldLaunches: number;
}

const ROGUE_FRACTION = 0.15;
const MAX_COLONIES = 256;
const RETIRE_AFTER_ZERO_YIELD_LAUNCHES = 8;

function behaviorKey(observation: Observation): string {
  return hash({
    location: observation.location,
    choices: observation.choices.map((choice) => choice.id),
    terminal: observation.terminal,
  });
}

function changedVariableNames(before: Observation, after: Observation): string[] {
  const names = new Set([...Object.keys(before.variables), ...Object.keys(after.variables)]);
  return [...names].filter((name) => stableJson(before.variables[name]) !== stableJson(after.variables[name]));
}

function colonySearcher(id: "swarm-colony" | "swarm", rogueFraction: number): Searcher {
  return {
    id,
    version: id === "swarm" ? "minimal-colony-rogue-v2" : "swarm-ablation-colony-v1",
    run(controller, seed) {
    const rng = new Prng(seed);
    const root = controller.launch();
    const colonies = new Map<string, Colony>();
    const behaviorVisits = new Map<string, number>();
    const variableChangeCounts = new Map<string, number>();
    let deepest = root.depth;
    let pruned = 0;
    let retired = 0;
    let rogueLaunches = 0;
    let nextPruneAt = 64;
    let frontierExhausted = false;

    const addColony = (observation: Observation, novelty: number, transition: number): Colony | null => {
      if (observation.terminal || observation.choices.length === 0) return null;
      const existing = colonies.get(observation.semanticKey);
      if (existing) {
        if (novelty > existing.novelty || observation.depth > existing.observation.depth) {
          if (existing.snapshotId !== observation.snapshotId) {
            controller.retain(observation.snapshotId);
            controller.release(existing.snapshotId);
          }
          existing.snapshotId = observation.snapshotId;
          existing.observation = observation;
          existing.novelty = Math.max(existing.novelty, novelty);
        }
        return existing;
      }
      const colony: Colony = {
        snapshotId: observation.snapshotId,
        observation,
        novelty,
        launches: 0,
        yield: novelty,
        lastProductiveTransition: novelty > 0 ? transition : 0,
        choiceAttempts: observation.choices.map(() => 0),
        behavioralKey: behaviorKey(observation),
        zeroYieldLaunches: 0,
      };
      controller.retain(observation.snapshotId);
      colonies.set(observation.semanticKey, colony);
      return colony;
    };

    const noveltyFor = (result: TransitionResult): number => {
      let novelty = result.coverageDelta.locations * 10
        + result.coverageDelta.choiceConfigurations * 6
        + result.coverageDelta.choices * 3
        + result.coverageDelta.edges * 2;
      for (const name of changedVariableNames(result.before, result.after)) {
        const seen = variableChangeCounts.get(name) ?? 0;
        novelty += 3 / Math.sqrt(seen + 1);
        variableChangeCounts.set(name, seen + 1);
      }
      if (result.after.depth > deepest) {
        novelty += Math.min(4, (result.after.depth - deepest) * 0.5);
        deepest = result.after.depth;
      }
      return novelty;
    };

    const observe = (result: TransitionResult, parent: Colony | null): Colony | null => {
      const novelty = noveltyFor(result);
      const key = behaviorKey(result.after);
      behaviorVisits.set(key, (behaviorVisits.get(key) ?? 0) + 1);
      if (parent) {
        parent.yield += novelty;
        if (novelty > 0) parent.lastProductiveTransition = result.transition;
      }
      return addColony(result.after, novelty, result.transition);
    };

    const colonyScore = (colony: Colony): number => {
      const saturation = behaviorVisits.get(colony.behavioralKey) ?? 0;
      const frontier = colony.choiceAttempts.reduce((sum, attempts) => sum + 1 / (attempts + 1), 0);
      const productivity = (colony.yield + 1) / (colony.launches + 1);
      const staleFor = controller.transitions - colony.lastProductiveTransition;
      return (colony.novelty + frontier * 3 + productivity * 2 + Math.min(colony.observation.depth, 80) * 0.08)
        / (1 + saturation * 0.75 + staleFor * 0.002);
    };

    const selectColony = (): Colony | null => {
      const candidates = [...colonies.values()];
      if (candidates.length === 0) return null;
      const weighted = candidates.map((colony) => ({ colony, weight: Math.max(0.001, colonyScore(colony)) }));
      const total = weighted.reduce((sum, item) => sum + item.weight, 0);
      let roll = rng.next() * total;
      for (const item of weighted) {
        roll -= item.weight;
        if (roll <= 0) return item.colony;
      }
      return weighted.at(-1)!.colony;
    };

    const selectChoice = (colony: Colony | null, observation: Observation, rogue: boolean): number => {
      if (rogue || !colony) return rng.integer(observation.choices.length);
      const weights = observation.choices.map((_, index) => 1 / ((colony.choiceAttempts[index] ?? 0) + 1));
      const total = weights.reduce((sum, value) => sum + value, 0);
      let roll = rng.next() * total;
      for (let index = 0; index < weights.length; index += 1) {
        roll -= weights[index]!;
        if (roll <= 0) return index;
      }
      return weights.length - 1;
    };

    const prune = (): void => {
      if (colonies.size <= MAX_COLONIES) return;
      const protectedKeys = new Set([root.semanticKey]);
      const ranked = [...colonies.entries()]
        .filter(([key]) => !protectedKeys.has(key))
        .sort((left, right) => colonyScore(left[1]) - colonyScore(right[1]));
      const remove = colonies.size - MAX_COLONIES;
      for (const [key] of ranked.slice(0, remove)) {
        controller.release(colonies.get(key)!.snapshotId);
        colonies.delete(key);
        pruned += 1;
      }
    };

    const retire = (colony: Colony, priorYield: number, rootColony: Colony): void => {
      if (colony === rootColony || !colonies.has(colony.observation.semanticKey)) return;
      colony.zeroYieldLaunches = colony.yield > priorYield ? 0 : colony.zeroYieldLaunches + 1;
      if (colony.zeroYieldLaunches < RETIRE_AFTER_ZERO_YIELD_LAUNCHES || colony.choiceAttempts.some((attempts) => attempts === 0)) return;
      controller.release(colony.snapshotId);
      colonies.delete(colony.observation.semanticKey);
      retired += 1;
    };

    const knownFrontierIsClosed = (): boolean => pruned === 0
      && [...colonies.values()].every((colony) => colony.choiceAttempts.every((attempts) => attempts > 0));

    const rootColony = addColony(root, 1, 0)!;
    behaviorVisits.set(rootColony.behavioralKey, 1);
    while (!controller.exhausted) {
      if (knownFrontierIsClosed()) {
        frontierExhausted = true;
        break;
      }
      const rogue = rng.next() < rogueFraction;
      let colony = rogue ? rootColony : selectColony();
      if (!colony) colony = rootColony;
      const launchColony = colony;
      const priorYield = launchColony.yield;
      if (rogue) rogueLaunches += 1;
      let observation = controller.launch(rogue ? controller.rootSnapshotId : colony.snapshotId);
      colony.launches += 1;
      const energy = rogue ? 3 + rng.integer(5) : 1 + rng.integer(4);
      for (let step = 0; step < energy && !controller.exhausted && observation.choices.length > 0; step += 1) {
        const choiceIndex = selectChoice(colony, observation, rogue);
        if (!rogue) colony.choiceAttempts[choiceIndex] = (colony.choiceAttempts[choiceIndex] ?? 0) + 1;
        const result = controller.step(choiceIndex);
        const child = observe(result, colony);
        observation = result.after;
        if (child) colony = child;
      }
      if (controller.transitions >= nextPruneAt) {
        prune();
        nextPruneAt = controller.transitions + 64;
      }
      retire(launchColony, priorYield, rootColony);
    }
    return {
      notes: [
        `InkSwarm colony policy: semantic novelty, behavioral saturation, saved colonies, ${RETIRE_AFTER_ZERO_YIELD_LAUNCHES}-launch zero-yield retirement, pruning cap ${MAX_COLONIES}, and ${(rogueFraction * 100).toFixed(0)}% rogue launches.`,
        `Retained ${colonies.size} colonies, retired ${retired}, pruned ${pruned}, and launched ${rogueLaunches} rogue walks.`,
        frontierExhausted ? "Stopped because every choice from every retained-or-fully-retired semantic colony had been tried and no incomplete colony had been pruned." : "Did not establish semantic-frontier closure before the resource boundary.",
      ],
    };
    },
  };
}

export const swarmColonySearcher = colonySearcher("swarm-colony", 0);
export const swarmSearcher = colonySearcher("swarm", ROGUE_FRACTION);
