import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureSourceHash, hash } from "./hash.js";
import { RUN_CONTRACT_VERSION, type ExecutionFingerprint, type RunRequest } from "./types.js";
import { getSearcher } from "../searchers/index.js";

let artifactDigest: string | undefined;
let lockDigest: string | null | undefined;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function filesBelow(root: string): string[] {
  const out: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const metadata = statSync(path);
      if (metadata.isDirectory()) visit(path);
      else if (name.endsWith(".js")) out.push(path);
    }
  };
  if (existsSync(root)) visit(root);
  return out;
}

function packageRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

export function harnessArtifactSha256(): string {
  if (artifactDigest) return artifactDigest;
  const root = packageRoot();
  const files = [join(root, "package.json"), ...filesBelow(join(root, "dist"))].filter(existsSync);
  const digest = createHash("sha256");
  for (const path of files.sort()) {
    digest.update(relative(root, path));
    digest.update("\0");
    digest.update(readFileSync(path));
    digest.update("\0");
  }
  artifactDigest = digest.digest("hex");
  return artifactDigest;
}

function packageLockSha256(): string | null {
  if (lockDigest !== undefined) return lockDigest;
  const path = join(packageRoot(), "package-lock.json");
  lockDigest = existsSync(path) ? sha256File(path) : null;
  return lockDigest;
}

export function executionFingerprint(request: RunRequest): ExecutionFingerprint {
  const algorithmVersion = request.algorithm === "inkcheck" ? "external-adapter-v4" : getSearcher(request.algorithm).version;
  const inkcheckCommand = request.algorithm === "inkcheck" ? request.inkcheckCommand ?? "inkcheck" : undefined;
  const inkcheckCommandSha256 = inkcheckCommand && existsSync(inkcheckCommand)
    ? sha256File(inkcheckCommand)
    : null;
  const algorithmArtifact = join(
    packageRoot(),
    "dist",
    request.algorithm === "inkcheck" ? "adapters/inkcheck.js" : `searchers/${request.algorithm}.js`,
  );
  const compilerArtifactSha256 = request.fixture.tier === "generated-planted" ? null : request.fixture.manifest.compiler.artifactSha256;
  const fields = {
    schemaVersion: 1 as const,
    harnessArtifactSha256: harnessArtifactSha256(),
    packageLockSha256: packageLockSha256(),
    algorithmVersion,
    algorithmArtifactSha256: existsSync(algorithmArtifact) ? sha256File(algorithmArtifact) : null,
    externalCommandSha256: inkcheckCommandSha256,
    node: process.version,
    v8: process.versions.v8,
    platform: `${process.platform}-${process.arch}`,
    inkRuntimeVersion: "2.4.0",
    compilerArtifactSha256,
  };
  return { ...fields, digest: executionFingerprintDigest(fields) };
}

export function executionFingerprintDigest(fields: Omit<ExecutionFingerprint, "digest">): string {
  return hash(fields, 64);
}

export function benchmarkRunId(request: RunRequest, fingerprint = executionFingerprint(request)): string {
  return hash({
    runContractVersion: RUN_CONTRACT_VERSION,
    fixtureId: request.fixture.manifest.fixtureId,
    generatorVersion: request.fixture.manifest.generatorVersion,
    fixtureSourceSha256: fixtureSourceHash(request.fixture),
    algorithm: request.algorithm,
    executionFingerprint: fingerprint.digest,
    searchSeed: request.searchSeed,
    storySeed: request.storySeed,
    budget: request.budget,
    timeBudgetMs: request.timeBudgetMs ?? null,
    inkcheckOptions: request.inkcheckOptions ?? {},
    resources: request.resources ?? {},
  }, 32);
}
