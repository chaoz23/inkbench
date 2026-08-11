import { hash } from "../core/hash.js";
import { Prng } from "../core/prng.js";
import type { Observation } from "../core/types.js";
import type { Searcher } from "./types.js";

function behaviorKey(observation: Observation): string {
  return hash({
    location: observation.location,
    choices: observation.choices.map((choice) => choice.id),
    terminal: observation.terminal,
  });
}

export const swarmNoveltySearcher: Searcher = {
  id: "swarm-novelty",
  version: "swarm-ablation-novelty-saturation-v1",
  run(controller, seed) {
    const rng = new Prng(seed);
    const attempts = new Map<string, number[]>();
    const behaviorVisits = new Map<string, number>();
    let productiveTransitions = 0;
    let earlyResets = 0;

    while (!controller.exhausted) {
      let observation = controller.launch(controller.rootSnapshotId);
      const energy = 1 + rng.integer(4);
      for (let step = 0; step < energy && !controller.exhausted && observation.choices.length > 0; step += 1) {
        const stateAttempts = attempts.get(observation.semanticKey) ?? observation.choices.map(() => 0);
        attempts.set(observation.semanticKey, stateAttempts);
        const saturation = behaviorVisits.get(behaviorKey(observation)) ?? 0;
        const weights = observation.choices.map((_, index) => 1 / (1 + (stateAttempts[index] ?? 0) + saturation * 0.05));
        const total = weights.reduce((sum, value) => sum + value, 0);
        let roll = rng.next() * total;
        let choiceIndex = weights.length - 1;
        for (let index = 0; index < weights.length; index += 1) {
          roll -= weights[index]!;
          if (roll <= 0) {
            choiceIndex = index;
            break;
          }
        }
        stateAttempts[choiceIndex] = (stateAttempts[choiceIndex] ?? 0) + 1;
        const result = controller.step(choiceIndex);
        observation = result.after;
        const key = behaviorKey(observation);
        behaviorVisits.set(key, (behaviorVisits.get(key) ?? 0) + 1);
        if (result.coverageDelta.total > 0) productiveTransitions += 1;
        else if (rng.next() < 0.5) {
          earlyResets += 1;
          break;
        }
      }
    }
    return {
      notes: [
        "InkSwarm ablation: inverse-visit choice saturation and longer productive walks, with root replay only and no saved colonies or rogue population.",
        `Observed ${productiveTransitions} productive transitions and made ${earlyResets} early low-yield resets.`,
      ],
    };
  },
};
