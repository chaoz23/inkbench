import type { InProcessAlgorithmId } from "../core/types.js";
import { coverageSearcher } from "./coverage.js";
import { randomSearcher } from "./random.js";
import { swarmSearcher } from "./swarm.js";
import { systematicSearcher } from "./systematic.js";
import type { Searcher } from "./types.js";

const SEARCHERS: Record<InProcessAlgorithmId, Searcher> = {
  random: randomSearcher,
  systematic: systematicSearcher,
  coverage: coverageSearcher,
  swarm: swarmSearcher,
};

export function getSearcher(id: InProcessAlgorithmId): Searcher {
  return SEARCHERS[id];
}
