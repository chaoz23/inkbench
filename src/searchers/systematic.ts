import type { Observation } from "../core/types.js";
import type { InstrumentedController } from "../core/runtime.js";
import type { Searcher } from "./types.js";

interface FrontierEdge {
  snapshotId: string;
  choiceIndex: number;
}

const MAX_DEPTH = 100;

function edges(controller: InstrumentedController, observation: Observation): FrontierEdge[] {
  return observation.choices.map((choice) => {
    controller.retain(observation.snapshotId);
    return { snapshotId: observation.snapshotId, choiceIndex: choice.index };
  });
}

export const systematicSearcher: Searcher = {
  id: "systematic",
  version: "dfs-semantic-dedup-v1",
  run(controller) {
    const root = controller.launch();
    const frontier = edges(controller, root).reverse();
    const expanded = new Set([root.semanticKey]);
    while (!controller.exhausted && frontier.length > 0) {
      const candidate = frontier.pop()!;
      controller.launch(candidate.snapshotId);
      controller.release(candidate.snapshotId);
      const result = controller.step(candidate.choiceIndex);
      if (!result.after.terminal && result.after.depth < MAX_DEPTH && !expanded.has(result.after.semanticKey)) {
        expanded.add(result.after.semanticKey);
        frontier.push(...edges(controller, result.after).reverse());
      }
    }
    return {
      notes: [
        `Deterministic depth-first calibration baseline with exact semantic-state deduplication and a depth ceiling of ${MAX_DEPTH}.`,
        "This is not the InkCheck adapter and must not be reported as InkCheck.",
      ],
    };
  },
};
