import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  analyzeAuthoredCorpus,
  analyzeLocalCorpus,
  getAuthoredCorpusManifest,
} from "../dist/index.js";

test("authored corpus complexity coordinates are deterministic and cover the declared scale roles", () => {
  const report = analyzeAuthoredCorpus(20, "fixed");
  const repeated = analyzeAuthoredCorpus(20, "fixed");
  const staticOnly = analyzeAuthoredCorpus(0, "fixed");
  const stripRuntimeTiming = (value) => value;
  assert.deepEqual(stripRuntimeTiming(repeated), stripRuntimeTiming(report));
  assert.deepEqual(staticOnly.stories.map((story) => story.scaleRoles), report.stories.map((story) => story.scaleRoles));
  assert.equal(report.stories.length, 3);
  assert.ok(report.stories.some((story) => story.scaleRoles.includes("include-heavy-public-proxy")));
  assert.ok(report.stories.some((story) => story.scaleRoles.includes("state-heavy-public-proxy")));
  assert.ok(report.corpusGaps.some((gap) => /AAA/.test(gap)));
  for (const entry of getAuthoredCorpusManifest().cases) {
    const measured = report.stories.find((story) => story.storyId === entry.id);
    assert.deepEqual(measured.static, entry.complexity.static);
  }
});

test("local-only complexity analysis emits no paths or source/runtime text", () => {
  const root = fileURLToPath(new URL("../corpus/authored-v1/the-intercept/", import.meta.url));
  const report = analyzeLocalCorpus({
    schemaVersion: 1,
    corpusId: "private-calibration",
    cases: [{
      id: "private-story",
      sourceFiles: [`${root}TheIntercept.ink`],
      entrypoint: `${root}TheIntercept.ink`,
      compiledArtifact: `${root}story.ink.json`,
      compilerVersion: "1.2.1",
      license: "proprietary",
    }],
  }, 0, "fixed");
  const serialized = JSON.stringify(report);
  assert.equal(report.stories[0].visibility, "local-private");
  assert.equal(report.stories[0].provenance.license, "proprietary");
  assert.equal(report.stories[0].provenance.sourceRepository, null);
  assert.doesNotMatch(serialized, /TheIntercept\.ink|story\.ink\.json|\/Users\//);
  assert.doesNotMatch(serialized, /I caught the morning train|currentChoices|variablesState/);
});
