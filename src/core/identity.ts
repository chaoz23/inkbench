import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fixtureSourceHash, hash } from "./hash.js";
import { RUN_CONTRACT_VERSION, type RunRequest } from "./types.js";
import { getSearcher } from "../searchers/index.js";

export function benchmarkRunId(request: RunRequest): string {
  const algorithmVersion = request.algorithm === "inkcheck" ? "external-adapter-v3" : getSearcher(request.algorithm).version;
  const inkcheckCommand = request.algorithm === "inkcheck" ? request.inkcheckCommand ?? "inkcheck" : undefined;
  const inkcheckCommandSha256 = inkcheckCommand && existsSync(inkcheckCommand)
    ? createHash("sha256").update(readFileSync(inkcheckCommand)).digest("hex")
    : null;
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
    timeBudgetMs: request.timeBudgetMs ?? null,
    inkcheckOptions: request.inkcheckOptions ?? {},
    resources: request.resources ?? {},
    ...(request.algorithm === "inkcheck" ? { inkcheckCommandSha256 } : {}),
  });
}
