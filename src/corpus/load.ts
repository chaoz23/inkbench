import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { hash } from "../core/hash.js";
import { SCHEMA_VERSION, type AuthoredFixture, type AuthoredStoryFamily, type CorpusSourceMetadata } from "../core/types.js";
import type { StaticComplexityCoordinates } from "./complexity.js";

export interface AuthoredCorpusCase {
  id: string;
  family: AuthoredStoryFamily;
  projectSize: "small" | "medium" | "large";
  complexity: {
    schemaVersion: 1;
    analyzer: "inkbench-corpus-complexity-v1";
    static: StaticComplexityCoordinates;
    scaleRoles: string[];
  };
  directory: string;
  source: CorpusSourceMetadata & {
    licenseSha256: string;
    compileSetup: string;
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
}

export interface AuthoredCorpusManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  tier: "authored-project";
  corpusVersion: "authored-corpus-v1";
  source: {
    repository: string;
    commit: string;
    manifestPath: string;
  };
  cases: AuthoredCorpusCase[];
}

const CORPUS_ROOT = fileURLToPath(new URL("../../corpus/authored-v1/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(CORPUS_ROOT, "manifest.json"), "utf8")) as AuthoredCorpusManifest;

function validateRelativeName(value: string): void {
  if (value.length === 0 || value.startsWith("/") || value.includes("..") || value.includes("\\")) {
    throw new Error(`unsafe authored-corpus path: ${value}`);
  }
}

function verifyManifest(): void {
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.tier !== "authored-project" || manifest.corpusVersion !== "authored-corpus-v1") {
    throw new Error("unsupported authored corpus manifest");
  }
  const ids = new Set<string>();
  for (const entry of manifest.cases) {
    if (ids.has(entry.id)) throw new Error(`duplicate authored corpus id: ${entry.id}`);
    ids.add(entry.id);
    validateRelativeName(entry.directory);
    validateRelativeName(entry.source.entrypoint);
    validateRelativeName(entry.source.licenseFile);
    validateRelativeName(entry.compiled.file);
    if (!(entry.source.entrypoint in entry.files)) throw new Error(`${entry.id}: entrypoint is not listed in files`);
    if (entry.complexity?.schemaVersion !== 1 || entry.complexity.analyzer !== "inkbench-corpus-complexity-v1") throw new Error(`${entry.id}: missing corpus complexity coordinates`);
    for (const [filename, digest] of Object.entries(entry.files)) {
      validateRelativeName(filename);
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`${entry.id}: invalid SHA-256 for ${filename}`);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.compiled.sha256)) throw new Error(`${entry.id}: invalid compiled artifact SHA-256`);
  }
}

verifyManifest();

export function extractLocations(files: Record<string, string>): string[] {
  const locations = new Set<string>();
  for (const source of Object.values(files)) {
    let currentKnot: string | null = null;
    for (const line of source.split(/\r?\n/)) {
      const knot = line.match(/^\s*===+\s*(?:(function)\s+)?([A-Za-z_][A-Za-z0-9_]*)/);
      if (knot) {
        currentKnot = knot[2]!;
        locations.add(currentKnot);
        continue;
      }
      const stitch = line.match(/^\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*=?\s*$/);
      if (stitch && currentKnot) locations.add(`${currentKnot}.${stitch[1]!}`);
    }
  }
  return [...locations].sort();
}

export function getAuthoredCorpusManifest(): AuthoredCorpusManifest {
  return structuredClone(manifest);
}

export function listAuthoredStories(): AuthoredCorpusCase[] {
  return structuredClone(manifest.cases);
}

export function loadAuthoredFixture(id: string): AuthoredFixture {
  const entry = manifest.cases.find((candidate) => candidate.id === id);
  if (!entry) throw new RangeError(`unknown authored story: ${id}`);
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
  const compiledStory = readFileSync(join(directory, entry.compiled.file), "utf8");
  const compiledDigest = hash(compiledStory, 64);
  if (compiledDigest !== entry.compiled.sha256) throw new Error(`${id}: compiled artifact checksum mismatch; expected ${entry.compiled.sha256}, got ${compiledDigest}`);
  JSON.parse(compiledStory);
  return {
    tier: "authored-project",
    source,
    sourceBundle: { entrypoint: entry.source.entrypoint, files },
    compiledStory,
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      generatorVersion: "authored-corpus-v1",
      fixtureId: `authored-${entry.id}`,
      family: entry.family,
      seed: 0,
      difficulty: 1,
      dimensions: {
        depth: 0,
        width: 0,
        stateDimensionality: 0,
        rarity: 0,
        delay: 0,
        revisit: 0,
        deception: 0,
        order: 0,
      },
      parameters: {
        storyId: entry.id,
        title: entry.source.name,
        projectSize: entry.projectSize,
        upstreamCommit: entry.source.commit,
        corpusSourceCommit: manifest.source.commit,
      },
      locations: extractLocations(files),
      bugs: [],
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
