import type { InProcessAlgorithmId } from "../core/types.js";
import { coverageSearcher } from "./coverage.js";
import { randomSearcher } from "./random.js";
import { swarmColonySearcher, swarmSearcher } from "./swarm.js";
import { swarmNoveltySearcher } from "./swarm-novelty.js";
import { systematicSearcher } from "./systematic.js";
import type { Searcher } from "./types.js";

const SEARCHERS: Record<InProcessAlgorithmId, Searcher> = {
  random: randomSearcher,
  systematic: systematicSearcher,
  coverage: coverageSearcher,
  "swarm-novelty": swarmNoveltySearcher,
  "swarm-colony": swarmColonySearcher,
  swarm: swarmSearcher,
};

export function getSearcher(id: InProcessAlgorithmId): Searcher {
  return SEARCHERS[id];
}
