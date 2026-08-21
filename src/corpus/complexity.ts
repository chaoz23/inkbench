import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { hash } from "../core/hash.js";
import { InstrumentedController } from "../core/runtime.js";
import { SCHEMA_VERSION, type AuthoredFixture, type CorpusSourceMetadata, type SourceBundle, type TransitionResult } from "../core/types.js";
import { systematicSearcher } from "../searchers/systematic.js";
import { listAuthoredStories, loadAuthoredFixture } from "./load.js";

export const CORPUS_COMPLEXITY_SCHEMA_VERSION = 1 as const;

export interface StaticComplexityCoordinates {
  sourceFiles: number;
  sourceBytes: number;
  sourceLines: number;
  includeDirectives: number;
  knots: number;
  stitches: number;
  choices: number;
  diverts: number;
  tunnels: number;
  functions: number;
  lists: number;
  variables: number;
  conditionalExpressions: number;
  compiledBytes: number;
  compiledContainers: number;
}

export interface RuntimeComplexityCoordinates {
  samplingBudget: number;
  transitionsObserved: number;
  locationsObserved: number;
  edgesObserved: number;
  semanticStatesObserved: number;
  maxDepthObserved: number;
  meanBranchingObserved: number;
  maxBranchingObserved: number;
  revisitTransitionsObserved: number;
  repeatedEdgeTransitionsObserved: number;
  maxVariablesObserved: number;
  peakSnapshotBytes: number;
  peakCheckpointBytes: number;
  approximateMeanSnapshotBytes: number;
  stopReason: string;
}

export interface CorpusComplexityRecord {
  schemaVersion: typeof CORPUS_COMPLEXITY_SCHEMA_VERSION;
  storyId: string;
  visibility: "public-redistributable" | "local-private";
  provenance: {
    sourceRepository: string | null;
    sourceCommit: string | null;
    license: string | null;
    compiler: string;
    compilerVersion: string;
    sourceBundleSha256: string;
    compiledArtifactSha256: string;
  };
  static: StaticComplexityCoordinates;
  runtime: RuntimeComplexityCoordinates | null;
  scaleRoles: string[];
}

export interface CorpusComplexityReport {
  schemaVersion: typeof CORPUS_COMPLEXITY_SCHEMA_VERSION;
  generatedAt: string;
  privacyContract: string;
  runtimeSamplingBudget: number;
  stories: CorpusComplexityRecord[];
  observedEnvelope: Record<string, { minimum: number; maximum: number }>;
  corpusGaps: string[];
}

function matches(files: Record<string, string>, pattern: RegExp): number {
  let count = 0;
  for (const source of Object.values(files)) count += source.split(/\r?\n/).filter((line) => pattern.test(line)).length;
  return count;
}

function countCompiledContainers(value: unknown): number {
  if (Array.isArray(value)) return 1 + value.reduce((sum, item) => sum + countCompiledContainers(item), 0);
  if (value !== null && typeof value === "object") {
    return 1 + Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + countCompiledContainers(item), 0);
  }
  return 0;
}

export function analyzeStaticComplexity(bundle: SourceBundle, compiledStory: string): StaticComplexityCoordinates {
  const files = bundle.files;
  return {
    sourceFiles: Object.keys(files).length,
    sourceBytes: Object.values(files).reduce((sum, source) => sum + Buffer.byteLength(source, "utf8"), 0),
    sourceLines: Object.values(files).reduce((sum, source) => sum + source.split(/\r?\n/).length, 0),
    includeDirectives: matches(files, /^\s*INCLUDE\s+/),
    knots: matches(files, /^\s*===+\s*(?!function\b)[A-Za-z_]/),
    stitches: matches(files, /^\s*=\s*[A-Za-z_][A-Za-z0-9_]*\s*=?\s*$/),
    choices: matches(files, /^\s*[+*](?!\s*\*)/),
    diverts: matches(files, /->(?!>)/),
    tunnels: matches(files, /->->/),
    functions: matches(files, /^\s*===+\s*function\s+/),
    lists: matches(files, /^\s*LIST\s+/),
    variables: matches(files, /^\s*(?:VAR|CONST)\s+/),
    conditionalExpressions: matches(files, /\{[^}\n]+[:|}]/),
    compiledBytes: Buffer.byteLength(compiledStory, "utf8"),
    compiledContainers: countCompiledContainers(JSON.parse(compiledStory)),
  };
}

export function analyzeRuntimeComplexity(fixture: AuthoredFixture, budget: number): RuntimeComplexityCoordinates {
  if (!Number.isSafeInteger(budget) || budget < 1) throw new RangeError("runtime sampling budget must be a positive integer");
  let branchingTotal = 0;
  let observations = 0;
  let maxBranching = 0;
  let maxDepth = 0;
  let revisitTransitions = 0;
  let repeatedEdges = 0;
  let maxVariables = 0;
  const edges = new Set<string>();
  const observe = (transition: TransitionResult): void => {
    const after = transition.after;
    branchingTotal += after.choices.length;
    observations += 1;
    maxBranching = Math.max(maxBranching, after.choices.length);
    maxDepth = Math.max(maxDepth, after.depth);
    maxVariables = Math.max(maxVariables, Object.keys(after.variables).length);
    if (Object.values(after.visitCounts).some((count) => count > 1)) revisitTransitions += 1;
    const edge = `${transition.before.location}|${transition.choice.id}|${after.location}`;
    if (edges.has(edge)) repeatedEdges += 1;
    edges.add(edge);
  };
  const controller = new InstrumentedController(fixture, budget, 1, { onTransition: observe });
  systematicSearcher.run(controller, 0);
  const memory = controller.snapshotMemory;
  return {
    samplingBudget: budget,
    transitionsObserved: controller.transitions,
    locationsObserved: controller.coverage.locations,
    edgesObserved: controller.coverage.edges,
    semanticStatesObserved: controller.coverage.semanticStates,
    maxDepthObserved: maxDepth,
    meanBranchingObserved: observations === 0 ? 0 : branchingTotal / observations,
    maxBranchingObserved: maxBranching,
    revisitTransitionsObserved: revisitTransitions,
    repeatedEdgeTransitionsObserved: repeatedEdges,
    maxVariablesObserved: maxVariables,
    peakSnapshotBytes: memory.peakBytes,
    peakCheckpointBytes: memory.peakCheckpointBytes,
    approximateMeanSnapshotBytes: memory.peak === 0 ? 0 : memory.peakBytes / memory.peak,
    stopReason: controller.resourceStopReason ?? (controller.transitions >= budget ? "budget" : "search-exhausted"),
  };
}

function bundleDigest(bundle: SourceBundle): string {
  return hash(Object.entries(bundle.files).sort(([left], [right]) => left.localeCompare(right)), 64);
}

function scaleRoles(staticCoordinates: StaticComplexityCoordinates): string[] {
  const roles: string[] = [];
  if (staticCoordinates.sourceFiles >= 10 || staticCoordinates.includeDirectives >= 8) roles.push("include-heavy-public-proxy");
  if (staticCoordinates.choices >= 75) roles.push("choice-depth-public-proxy");
  if (staticCoordinates.variables >= 25) roles.push("state-heavy-public-proxy");
  if (roles.length === 0) roles.push("small-project-calibration");
  return roles;
}

function recordForFixture(
  storyId: string,
  fixture: AuthoredFixture,
  runtimeBudget: number,
  visibility: CorpusComplexityRecord["visibility"],
): CorpusComplexityRecord {
  const staticCoordinates = analyzeStaticComplexity(fixture.sourceBundle, fixture.compiledStory);
  const runtime = runtimeBudget > 0 ? analyzeRuntimeComplexity(fixture, runtimeBudget) : null;
  return {
    schemaVersion: CORPUS_COMPLEXITY_SCHEMA_VERSION,
    storyId,
    visibility,
    provenance: {
      sourceRepository: visibility === "local-private" ? null : fixture.manifest.source.repository,
      sourceCommit: visibility === "local-private" ? null : fixture.manifest.source.commit,
      license: fixture.manifest.source.license,
      compiler: fixture.manifest.compiler.name,
      compilerVersion: fixture.manifest.compiler.version,
      sourceBundleSha256: bundleDigest(fixture.sourceBundle),
      compiledArtifactSha256: hash(fixture.compiledStory, 64),
    },
    static: staticCoordinates,
    runtime,
    scaleRoles: scaleRoles(staticCoordinates),
  };
}

function numericEnvelope(stories: CorpusComplexityRecord[]): Record<string, { minimum: number; maximum: number }> {
  const values = new Map<string, number[]>();
  for (const story of stories) {
    for (const [name, value] of Object.entries(story.static)) {
      const list = values.get(`static.${name}`) ?? [];
      list.push(value);
      values.set(`static.${name}`, list);
    }
    for (const [name, value] of Object.entries(story.runtime ?? {})) {
      if (typeof value !== "number") continue;
      const list = values.get(`runtime.${name}`) ?? [];
      list.push(value);
      values.set(`runtime.${name}`, list);
    }
  }
  return Object.fromEntries([...values.entries()].map(([name, items]) => [name, { minimum: Math.min(...items), maximum: Math.max(...items) }]));
}

function report(stories: CorpusComplexityRecord[], runtimeBudget: number, generatedAt: string): CorpusComplexityReport {
  return {
    schemaVersion: CORPUS_COMPLEXITY_SCHEMA_VERSION,
    generatedAt,
    privacyContract: "Records contain aggregate counts and content hashes only; no source text, runtime text, choice text, variable names, or local filesystem paths are emitted.",
    runtimeSamplingBudget: runtimeBudget,
    stories,
    observedEnvelope: numericEnvelope(stories),
    corpusGaps: [
      "The redistributable corpus is a convenience sample, not a representative sample of all Ink projects.",
      "No proprietary AAA-scale project is redistributed or treated as indirectly measured.",
      "Runtime coordinates are bounded empirical observations, not proof-relative totals.",
      "Project age, team size, revision frequency, collaboration topology, and production defect history remain unmeasured.",
    ],
  };
}

export function analyzeAuthoredCorpus(runtimeBudget = 1_000, generatedAt = new Date().toISOString()): CorpusComplexityReport {
  const stories = listAuthoredStories().map((entry) => {
    const record = recordForFixture(entry.id, loadAuthoredFixture(entry.id), runtimeBudget, "public-redistributable");
    if (JSON.stringify(record.static) !== JSON.stringify(entry.complexity.static)) {
      throw new Error(`${entry.id}: checked-in corpus complexity coordinates drifted; regenerate and review the manifest`);
    }
    if (JSON.stringify(record.scaleRoles) !== JSON.stringify(entry.complexity.scaleRoles)) {
      throw new Error(`${entry.id}: checked-in corpus scale roles drifted; regenerate and review the manifest`);
    }
    return record;
  });
  return report(stories, runtimeBudget, generatedAt);
}

export interface LocalCorpusConfig {
  schemaVersion: 1;
  corpusId: string;
  cases: Array<{
    id: string;
    sourceFiles: string[];
    entrypoint: string;
    compiledArtifact: string;
    compilerVersion: string;
    license: "MIT" | "CC-BY-4.0" | "proprietary" | "other";
  }>;
}

function localFixture(entry: LocalCorpusConfig["cases"][number]): AuthoredFixture {
  const sourcePaths = entry.sourceFiles.map((path) => resolve(path));
  const files = Object.fromEntries(sourcePaths.map((path, index) => [`source-${index}.ink`, readFileSync(path, "utf8")]));
  const entrypointIndex = sourcePaths.indexOf(resolve(entry.entrypoint));
  if (entrypointIndex < 0) throw new Error(`${entry.id}: entrypoint must be included in sourceFiles`);
  const compiledStory = readFileSync(resolve(entry.compiledArtifact), "utf8");
  JSON.parse(compiledStory);
  const sourceMetadata: CorpusSourceMetadata = {
    name: entry.id,
    author: "private",
    license: entry.license,
    repository: "local-private",
    commit: hash(sourcePaths.map((path) => basename(path)), 64),
    licenseFile: "local-private",
    entrypoint: `source-${entrypointIndex}.ink`,
    randomness: "seeded-runtime",
    structuralMeasures: {},
  };
  return {
    tier: "authored-project",
    source: files[`source-${entrypointIndex}.ink`]!,
    sourceBundle: { entrypoint: `source-${entrypointIndex}.ink`, files },
    compiledStory,
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      generatorVersion: "authored-corpus-v1",
      fixtureId: `local-${hash(entry.id, 16)}`,
      family: "choice-dense-authored-story",
      seed: 0,
      difficulty: 1,
      dimensions: { depth: 0, width: 0, stateDimensionality: 0, rarity: 0, delay: 0, revisit: 0, deception: 0, order: 0 },
      parameters: { visibility: "local-private" },
      locations: [],
      bugs: [],
      source: sourceMetadata,
      compiler: { name: "inklecate", version: entry.compilerVersion, artifactSha256: hash(compiledStory, 64), arguments: [] },
    },
  };
}

export function analyzeLocalCorpus(config: LocalCorpusConfig, runtimeBudget = 0, generatedAt = new Date().toISOString()): CorpusComplexityReport {
  if (config.schemaVersion !== 1 || !config.corpusId || config.cases.length === 0) throw new Error("invalid local corpus config");
  const ids = new Set<string>();
  const stories = config.cases.map((entry) => {
    if (!entry.id || ids.has(entry.id)) throw new Error(`invalid or duplicate local case id: ${entry.id}`);
    ids.add(entry.id);
    return recordForFixture(entry.id, localFixture(entry), runtimeBudget, "local-private");
  });
  return report(stories, runtimeBudget, generatedAt);
}
