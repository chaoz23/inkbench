import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractLocations } from "../corpus/load.js";
import { hash } from "../core/hash.js";
import {
  SCHEMA_VERSION,
  type AuthoredFaultType,
  type AuthoredPlantedBug,
  type AuthoredPlantedFixture,
  type AuthoredStoryFamily,
  type CorpusSourceMetadata,
  type DifficultyCoordinates,
} from "../core/types.js";

export interface AuthoredPlantedCorpusCase {
  id: string;
  family: AuthoredStoryFamily;
  directory: string;
  mutationSet: string;
  difficulty: number;
  source: CorpusSourceMetadata & {
    licenseSha256: string;
    upstreamSourceSha256: string;
    generator: string;
  };
  compiled: {
    file: string;
    sha256: string;
    compiler: "inklecate";
    compilerVersion: string;
    arguments: string[];
    provenance: string;
  };
  files: Record<string, string>;
  witnesses: {
    file: string;
    sha256: string;
  };
  bugs: AuthoredPlantedBug[];
}

export interface AuthoredPlantedWitness {
  choicePath: number[];
  choiceTextPath: string[];
}

export interface AuthoredPlantedWitnesses {
  schemaVersion: typeof SCHEMA_VERSION;
  fixtureId: string;
  witnesses: Record<string, AuthoredPlantedWitness>;
}

export interface AuthoredPlantedCorpusManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  tier: "authored-planted";
  corpusVersion: "authored-planted-v1";
  source: {
    cleanCorpusManifest: string;
    cleanStoryIds: string[];
  };
  cases: AuthoredPlantedCorpusCase[];
}

const CORPUS_ROOT = fileURLToPath(new URL("../../corpus/authored-planted-v1/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(CORPUS_ROOT, "manifest.json"), "utf8")) as AuthoredPlantedCorpusManifest;
const SHA256 = /^[0-9a-f]{64}$/;

function validateRelativeName(value: string): void {
  if (value.length === 0 || value.startsWith("/") || value.includes("..") || value.includes("\\")) {
    throw new Error(`unsafe authored-planted path: ${value}`);
  }
}

function verifyManifest(): void {
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.tier !== "authored-planted" || manifest.corpusVersion !== "authored-planted-v1") {
    throw new Error("unsupported authored-planted corpus manifest");
  }
  const caseIds = new Set<string>();
  for (const entry of manifest.cases) {
    if (caseIds.has(entry.id)) throw new Error(`duplicate authored-planted corpus id: ${entry.id}`);
    caseIds.add(entry.id);
    if (!Number.isSafeInteger(entry.difficulty) || entry.difficulty < 1 || entry.difficulty > 10) throw new Error(`${entry.id}: invalid difficulty`);
    validateRelativeName(entry.directory);
    validateRelativeName(entry.source.entrypoint);
    validateRelativeName(entry.source.licenseFile);
    validateRelativeName(entry.compiled.file);
    validateRelativeName(entry.witnesses.file);
    if (!(entry.source.entrypoint in entry.files)) throw new Error(`${entry.id}: entrypoint is not listed in files`);
    if (!SHA256.test(entry.source.licenseSha256) || !SHA256.test(entry.source.upstreamSourceSha256) || !SHA256.test(entry.compiled.sha256) || !SHA256.test(entry.witnesses.sha256)) {
      throw new Error(`${entry.id}: invalid SHA-256 metadata`);
    }
    const bugIds = new Set<string>();
    const oracleVariables = new Set<string>();
    for (const bug of entry.bugs) {
      if (bugIds.has(bug.id)) throw new Error(`${entry.id}: duplicate bug id ${bug.id}`);
      if (oracleVariables.has(bug.oracle.variable)) throw new Error(`${entry.id}: duplicate oracle variable ${bug.oracle.variable}`);
      bugIds.add(bug.id);
      oracleVariables.add(bug.oracle.variable);
      validateRelativeName(bug.site.file);
      if (!Number.isSafeInteger(bug.site.upstreamLine) || bug.site.upstreamLine < 1) throw new Error(`${bug.id}: invalid upstream line`);
    }
    if (entry.id === "the-intercept-20" && entry.bugs.length !== 20) throw new Error(`${entry.id}: expected exactly 20 planted bugs`);
    if (entry.id === "heresy2-30" && entry.bugs.length !== 30) throw new Error(`${entry.id}: expected exactly 30 planted bugs`);
    for (const [filename, digest] of Object.entries(entry.files)) {
      validateRelativeName(filename);
      if (!SHA256.test(digest)) throw new Error(`${entry.id}: invalid SHA-256 for ${filename}`);
    }
  }
}

verifyManifest();

function maxDimensions(bugs: AuthoredPlantedBug[]): DifficultyCoordinates {
  const keys: Array<keyof DifficultyCoordinates> = ["depth", "width", "stateDimensionality", "rarity", "delay", "revisit", "deception", "order"];
  return Object.fromEntries(keys.map((key) => [key, Math.max(0, ...bugs.map((bug) => bug.dimensions[key]))])) as unknown as DifficultyCoordinates;
}

export function getAuthoredPlantedCorpusManifest(): AuthoredPlantedCorpusManifest {
  return structuredClone(manifest);
}

export function listAuthoredPlantedStories(): AuthoredPlantedCorpusCase[] {
  return structuredClone(manifest.cases);
}

export function loadAuthoredPlantedWitnesses(id: string): AuthoredPlantedWitnesses {
  const entry = manifest.cases.find((candidate) => candidate.id === id);
  if (!entry) throw new RangeError(`unknown authored-planted story: ${id}`);
  const contents = readFileSync(join(CORPUS_ROOT, entry.directory, entry.witnesses.file), "utf8");
  const actual = hash(contents, 64);
  if (actual !== entry.witnesses.sha256) throw new Error(`${id}: witness checksum mismatch; expected ${entry.witnesses.sha256}, got ${actual}`);
  const parsed = JSON.parse(contents) as AuthoredPlantedWitnesses;
  if (parsed.schemaVersion !== SCHEMA_VERSION || parsed.fixtureId !== `authored-planted-${id}`) throw new Error(`${id}: incompatible witness metadata`);
  const expected = new Set(entry.bugs.map((bug) => bug.id));
  const actualIds = Object.keys(parsed.witnesses);
  if (actualIds.length !== expected.size || actualIds.some((bugId) => !expected.has(bugId))) throw new Error(`${id}: witnesses must cover every planted bug exactly once`);
  for (const [bugId, witness] of Object.entries(parsed.witnesses)) {
    if (!Array.isArray(witness.choicePath) || !Array.isArray(witness.choiceTextPath) || witness.choicePath.length !== witness.choiceTextPath.length) {
      throw new Error(`${id}: invalid witness path for ${bugId}`);
    }
    if (witness.choicePath.some((choice) => !Number.isSafeInteger(choice) || choice < 0) || witness.choiceTextPath.some((choice) => typeof choice !== "string")) {
      throw new Error(`${id}: invalid witness choice for ${bugId}`);
    }
  }
  return structuredClone(parsed);
}

export function loadAuthoredPlantedFixture(id: string): AuthoredPlantedFixture {
  const entry = manifest.cases.find((candidate) => candidate.id === id);
  if (!entry) throw new RangeError(`unknown authored-planted story: ${id}`);
  const directory = join(CORPUS_ROOT, entry.directory);
  const license = readFileSync(join(directory, entry.source.licenseFile), "utf8");
  if (hash(license, 64) !== entry.source.licenseSha256) throw new Error(`${id}: license checksum mismatch`);
  const files: Record<string, string> = {};
  for (const [filename, expected] of Object.entries(entry.files)) {
    const contents = readFileSync(join(directory, filename), "utf8");
    const actual = hash(contents, 64);
    if (actual !== expected) throw new Error(`${id}: checksum mismatch for ${filename}; expected ${expected}, got ${actual}`);
    files[filename] = contents;
  }
  const source = files[entry.source.entrypoint];
  if (source === undefined) throw new Error(`${id}: entrypoint could not be loaded`);
  for (const bug of entry.bugs) {
    const siteSource = files[bug.site.file];
    if (siteSource === undefined || !siteSource.includes(bug.site.knot.split(".")[0]!)) throw new Error(`${id}: source site is absent for ${bug.id}`);
    if (!Object.values(files).some((contents) => contents.includes(`VAR ${bug.oracle.variable} = false`))) {
      throw new Error(`${id}: oracle variable is absent for ${bug.id}`);
    }
  }
  const compiledStory = readFileSync(join(directory, entry.compiled.file), "utf8");
  const compiledDigest = hash(compiledStory, 64);
  if (compiledDigest !== entry.compiled.sha256) throw new Error(`${id}: compiled artifact checksum mismatch; expected ${entry.compiled.sha256}, got ${compiledDigest}`);
  JSON.parse(compiledStory);
  const faultTypes = [...new Set(entry.bugs.map((bug) => bug.faultType as AuthoredFaultType))].sort();
  return {
    tier: "authored-planted",
    source,
    sourceBundle: { entrypoint: entry.source.entrypoint, files },
    compiledStory,
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      generatorVersion: "authored-planted-v1",
      fixtureId: `authored-planted-${entry.id}`,
      family: entry.family,
      seed: 0,
      difficulty: entry.difficulty,
      dimensions: maxDimensions(entry.bugs),
      parameters: {
        storyId: entry.id,
        title: entry.source.name,
        mutationSet: entry.mutationSet,
        plantedBugs: entry.bugs.length,
        faultTypes,
        upstreamCommit: entry.source.commit,
        upstreamSourceSha256: entry.source.upstreamSourceSha256,
        witnessSha256: entry.witnesses.sha256,
      },
      locations: extractLocations(files),
      bugs: structuredClone(entry.bugs),
      mutationSet: entry.mutationSet,
      source: {
        name: entry.source.name,
        author: entry.source.author,
        license: entry.source.license,
        repository: entry.source.repository,
        commit: entry.source.commit,
        licenseFile: `${entry.directory}/${entry.source.licenseFile}`,
        entrypoint: entry.source.entrypoint,
        randomness: entry.source.randomness,
        structuralMeasures: { ...entry.source.structuralMeasures },
      },
      compiler: {
        name: entry.compiled.compiler,
        version: entry.compiled.compilerVersion,
        artifactSha256: entry.compiled.sha256,
        arguments: [...entry.compiled.arguments],
      },
    },
  };
}
