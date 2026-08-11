import { Prng } from "../core/prng.js";
import type { Searcher } from "./types.js";

export const randomSearcher: Searcher = {
  id: "random",
  version: "random-uniform-v1",
  run(controller, seed) {
    const rng = new Prng(seed);
    let observation = controller.launch();
    while (!controller.exhausted) {
      if (observation.choices.length === 0) {
        observation = controller.launch();
        if (observation.choices.length === 0) break;
      }
      const result = controller.step(rng.integer(observation.choices.length));
      observation = result.after;
    }
    return { notes: ["Uniform legal choices in root-started episodes; no checkpoints reused."] };
  },
};
