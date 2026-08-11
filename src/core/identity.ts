import { fixtureSourceHash, hash } from "./hash.js";
import { RUN_CONTRACT_VERSION, type RunRequest } from "./types.js";
import { getSearcher } from "../searchers/index.js";

export function benchmarkRunId(request: RunRequest): string {
  const algorithmVersion = request.algorithm === "inkcheck" ? "external-adapter-v1" : getSearcher(request.algorithm).version;
  return hash({
    runContractVersion: RUN_CONTRACT_VERSION,
    fixtureId: request.fixture.manifest.fixtureId,
    generatorVersion: request.fixture.manifest.generatorVersion,
    fixtureSourceSha256: fixtureSourceHash(request.fixture),
    algorithm: request.algorithm,
    algorithmVersion,
    searchSeed: request.searchSeed,
    storySeed: request.storySeed,
    budget: request.budget,
    resources: request.resources ?? {},
  });
}
