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
  sequence: number;
  storedScore: number;
}

function weightedYield(delta: CoverageDelta): number {
  return delta.locations * 8
    + delta.choiceConfigurations * 5
    + delta.choices * 3
    + delta.edges * 2
    + delta.variableTransitions * 2
    + delta.semanticStates;
}

function candidateScore(
  item: Candidate,
  stateLaunches: Map<string, number>,
  choiceAttempts: Map<string, number>,
): number {
  const launches = stateLaunches.get(item.semanticKey) ?? 0;
  const attempts = choiceAttempts.get(item.choiceId) ?? 0;
  return item.discoveryYield * 4
    + item.siblingCount * 0.5
    + Math.min(item.depth, 50) * 0.08
    + 6 / (launches + 1)
    + 4 / (attempts + 1)
    + item.tie * 1e-6;
}

function higherPriority(left: Candidate, right: Candidate): boolean {
  return left.storedScore > right.storedScore
    || (left.storedScore === right.storedScore && left.sequence < right.sequence);
}

class CandidateHeap {
  private readonly values: Candidate[] = [];

  get length(): number {
    return this.values.length;
  }

  peek(): Candidate | undefined {
    return this.values[0];
  }

  push(candidate: Candidate): void {
    this.values.push(candidate);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!higherPriority(this.values[index]!, this.values[parent]!)) break;
      [this.values[index], this.values[parent]] = [this.values[parent]!, this.values[index]!];
      index = parent;
    }
  }

  pop(): Candidate {
    const first = this.values[0];
    if (!first) throw new RangeError("coverage frontier is empty");
    const last = this.values.pop()!;
    if (this.values.length === 0) return first;
    this.values[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.values.length && higherPriority(this.values[left]!, this.values[best]!)) best = left;
      if (right < this.values.length && higherPriority(this.values[right]!, this.values[best]!)) best = right;
      if (best === index) break;
      [this.values[index], this.values[best]] = [this.values[best]!, this.values[index]!];
      index = best;
    }
    return first;
  }
}

export const coverageSearcher: Searcher = {
  id: "coverage",
  version: "semantic-priority-frontier-v2-lazy-heap",
  run(controller, seed) {
    const rng = new Prng(seed);
    const frontier = new CandidateHeap();
    const queuedEdges = new Set<string>();
    const stateLaunches = new Map<string, number>();
    const choiceAttempts = new Map<string, number>();
    let sequence = 0;

    const enqueue = (observation: Observation, discoveryYield: number): void => {
      for (const choice of observation.choices) {
        const key = `${observation.semanticKey}|${choice.id}`;
        if (queuedEdges.has(key)) continue;
        queuedEdges.add(key);
        controller.retain(observation.snapshotId);
        const candidate: Candidate = {
          snapshotId: observation.snapshotId,
          semanticKey: observation.semanticKey,
          choiceIndex: choice.index,
          choiceId: choice.id,
          depth: observation.depth,
          discoveryYield,
          siblingCount: observation.choices.length,
          tie: rng.next(),
          sequence: sequence++,
          storedScore: 0,
        };
        candidate.storedScore = candidateScore(candidate, stateLaunches, choiceAttempts);
        frontier.push(candidate);
      }
    };

    const root = controller.launch();
    enqueue(root, 1);
    while (!controller.exhausted && frontier.length > 0) {
      let candidate: Candidate;
      while (true) {
        candidate = frontier.pop();
        const currentScore = candidateScore(candidate, stateLaunches, choiceAttempts);
        const next = frontier.peek();
        if (!next || currentScore > next.storedScore || (currentScore === next.storedScore && candidate.sequence < next.sequence)) {
          candidate.storedScore = currentScore;
          break;
        }
        candidate.storedScore = currentScore;
        frontier.push(candidate);
      }
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
        "The priority queue uses monotone lazy rescoring, preserving the policy without a full frontier scan per transition.",
        `Priority schedule id ${hash({ seed, policy: "semantic-priority-frontier-v2-lazy-heap" })}.`,
      ],
    };
  },
};
