import type { InstrumentedController } from "../core/runtime.js";
import type { InProcessAlgorithmId } from "../core/types.js";

export interface SearchOutcome {
  notes: string[];
}

export interface Searcher {
  readonly id: InProcessAlgorithmId;
  readonly version: string;
  run(controller: InstrumentedController, seed: number): SearchOutcome;
}
