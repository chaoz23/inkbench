import { hash } from "../core/hash.js";
import { Prng } from "../core/prng.js";
import type { CoverageDelta, Observation } from "../core/types.js";
import type { Searcher } from "./types.js";

interface Candidate {
  snapshotId: string;
  semanticKey: string;
  choiceIndex: number;
  choiceId: string;
  depth: number;
  discoveryYield: number;
  siblingCount: number;
  tie: number;
}

function weightedYield(delta: CoverageDelta): number {
  return delta.locations * 8
    + delta.choiceConfigurations * 5
    + delta.choices * 3
    + delta.edges * 2
    + delta.variableTransitions * 2
    + delta.semanticStates;
}

export const coverageSearcher: Searcher = {
  id: "coverage",
  version: "semantic-priority-frontier-v1",
  run(controller, seed) {
    const rng = new Prng(seed);
    const frontier: Candidate[] = [];
    const queuedEdges = new Set<string>();
    const stateLaunches = new Map<string, number>();
    const choiceAttempts = new Map<string, number>();

    const enqueue = (observation: Observation, discoveryYield: number): void => {
      for (const choice of observation.choices) {
        const key = `${observation.semanticKey}|${choice.id}`;
        if (queuedEdges.has(key)) continue;
        queuedEdges.add(key);
        controller.retain(observation.snapshotId);
        frontier.push({
          snapshotId: observation.snapshotId,
          semanticKey: observation.semanticKey,
          choiceIndex: choice.index,
          choiceId: choice.id,
          depth: observation.depth,
          discoveryYield,
          siblingCount: observation.choices.length,
          tie: rng.next(),
        });
      }
    };

    const root = controller.launch();
    enqueue(root, 1);
    while (!controller.exhausted && frontier.length > 0) {
      let bestIndex = 0;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < frontier.length; index += 1) {
        const item = frontier[index]!;
        const launches = stateLaunches.get(item.semanticKey) ?? 0;
        const attempts = choiceAttempts.get(item.choiceId) ?? 0;
        const score = item.discoveryYield * 4
          + item.siblingCount * 0.5
          + Math.min(item.depth, 50) * 0.08
          + 6 / (launches + 1)
          + 4 / (attempts + 1)
          + item.tie * 1e-6;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
      const candidate = frontier.splice(bestIndex, 1)[0]!;
      stateLaunches.set(candidate.semanticKey, (stateLaunches.get(candidate.semanticKey) ?? 0) + 1);
      choiceAttempts.set(candidate.choiceId, (choiceAttempts.get(candidate.choiceId) ?? 0) + 1);
      controller.launch(candidate.snapshotId);
      controller.release(candidate.snapshotId);
      const result = controller.step(candidate.choiceIndex);
      enqueue(result.after, weightedYield(result.coverageDelta));
    }
    return {
      notes: [
        "Small coverage-guided control: semantic frontier, novelty yield, depth preference, and saturation.",
        `Priority schedule id ${hash({ seed, policy: "semantic-priority-frontier-v1" })}.`,
      ],
    };
  },
};
