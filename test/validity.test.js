import assert from "node:assert/strict";
import test from "node:test";
import { Compiler, CompilerOptions, Story } from "inkjs/full";
import {
  BUG_FAMILIES,
  benchmarkRunId,
  executionFingerprint,
  executionFingerprintDigest,
  experimentSchedule,
  generateFixture,
  InstrumentedController,
  oracleNeutralInkSource,
  runBenchmark,
  summarizeRuns,
} from "../dist/index.js";

function requestFor(fixture, algorithm = "random") {
  return { fixture, algorithm, searchSeed: 7, storySeed: 1, budget: 25 };
}

function continueFully(story) {
  let text = "";
  while (story.canContinue) text += story.Continue();
  return text;
}

test("generated InkCheck inputs contain no private oracle channels and still compile", () => {
  for (const family of BUG_FAMILIES) {
    const fixture = generateFixture(family, 201, 4);
    const neutral = oracleNeutralInkSource(fixture.source, requestFor(fixture, "inkcheck"), false, false);
    assert.doesNotMatch(neutral, /ib_bug|INKBENCH_BUG|INKBENCH_SIGNAL|oracle marker|oracle assignment/i, family);
    assert.doesNotMatch(neutral, /\b(?:bug|safe|fault|target|control|oracle|planted)\b/i, family);
    assert.ok(!neutral.includes(family), `${family}: leaked family id`);
    for (const bug of fixture.manifest.bugs) assert.ok(!neutral.includes(bug.id), `${family}: leaked bug id`);
    assert.doesNotMatch(String(fixture.manifest.parameters.targetEndpoint), /bug|fault|target|safe|control/i, family);
    assert.doesNotMatch(String(fixture.manifest.parameters.controlEndpoint), /bug|fault|target|safe|control/i, family);
    const compiled = new Compiler(neutral, new CompilerOptions(null, [], true)).Compile().ToJson();
    assert.doesNotMatch(compiled, /ib_bug|INKBENCH_BUG|INKBENCH_SIGNAL/i, `${family}: compiled oracle channel`);
    for (const bug of fixture.manifest.bugs) assert.ok(!compiled.includes(bug.id), `${family}: compiled bug id`);
  }
});

test("oracle-neutral and private generated builds preserve sampled runtime behavior", () => {
  for (const family of BUG_FAMILIES) {
    const fixture = generateFixture(family, 211, 2);
    const neutral = oracleNeutralInkSource(fixture.source, requestFor(fixture, "inkcheck"), false, false);
    for (let episode = 0; episode < 3; episode += 1) {
      const controller = new InstrumentedController(fixture, 20, 1);
      let observation = controller.launch();
      const story = new Story(new Compiler(neutral, new CompilerOptions(null, [], true)).Compile().ToJson());
      story.state.storySeed = 1;
      story.state.previousRandom = 0;
      let text = continueFully(story);
      for (let depth = 0; depth < 20; depth += 1) {
        assert.deepEqual(story.currentChoices.map((choice) => choice.text), observation.choices.map((choice) => choice.text), `${family}: choices at ${depth}`);
        assert.deepEqual(story.currentChoices.map((choice) => choice.sourcePath), observation.choices.map((choice) => choice.sourcePath), `${family}: choice sources at ${depth}`);
        assert.deepEqual(story.currentChoices.map((choice) => choice.pathStringOnChoice), observation.choices.map((choice) => choice.targetPath), `${family}: choice targets at ${depth}`);
        assert.equal(story.currentErrors?.length ?? 0, observation.errors.length, `${family}: errors at ${depth}`);
        assert.equal(story.currentWarnings?.length ?? 0, observation.warnings.length, `${family}: warnings at ${depth}`);
        if (observation.terminal) {
          assert.equal(story.currentChoices.length, 0, `${family}: terminal choices`);
          assert.equal(text, observation.text, `${family}: terminal text`);
          assert.equal(story.state.VisitCountAtPathString(observation.location), 1, `${family}: terminal identity`);
          break;
        }
        const choiceIndex = (episode + depth) % observation.choices.length;
        observation = controller.step(choiceIndex).after;
        story.ChooseChoiceIndex(choiceIndex);
        text = continueFully(story);
      }
    }
  }
});

test("structural seeds change formerly static generated topologies", () => {
  const keys = {
    "deep-corridor": "depth",
    "loop-count": "triggerCount",
    "revisit-after-mutation": "mutationDistance",
    "novelty-honeypot": "casinoDepth",
    "false-novelty": "roadDepth",
  };
  for (const [family, key] of Object.entries(keys)) {
    const first = generateFixture(family, 201, 10).manifest.parameters[key];
    const second = generateFixture(family, 202, 10).manifest.parameters[key];
    assert.notDeepEqual(second, first, `${family}.${key}`);
  }
  const endpointPositions = [1, 2].map((seed) => generateFixture("shallow-obvious", seed, 1).manifest.parameters.targetEndpointPosition);
  assert.deepEqual(endpointPositions, [0, 1], "target/control source order must be seed-permuted");
});

test("counterbalanced schedules are deterministic and balance serial algorithm position", () => {
  const config = {
    schemaVersion: 1,
    families: ["shallow-obvious", "deep-corridor"],
    algorithms: ["random", "coverage", "swarm"],
    fixtureSeeds: [1],
    searchSeeds: [1, 2, 3],
    budgets: [10],
    difficulty: 1,
    storySeed: 1,
    cellOrder: "counterbalanced",
    scheduleSeed: 1234,
    fixturePartition: "validation",
  };
  const first = experimentSchedule(config);
  const second = experimentSchedule(config);
  assert.deepEqual(second, first);
  for (const algorithm of config.algorithms) {
    const positions = [0, 1, 2].map((position) => first.filter((cell) => cell.algorithm === algorithm && cell.position === position).length);
    assert.deepEqual(positions, [2, 2, 2], algorithm);
  }
});

test("run identity changes with the exact executable fingerprint", () => {
  const fixture = generateFixture("shallow-obvious", 1, 1);
  const request = requestFor(fixture);
  const fingerprint = executionFingerprint(request);
  const fields = Object.fromEntries(Object.entries(fingerprint).filter(([key]) => key !== "digest"));
  const variants = [
    { harnessArtifactSha256: "1".repeat(64) },
    { packageLockSha256: "2".repeat(64) },
    { algorithmVersion: `${fingerprint.algorithmVersion}-changed` },
    { algorithmArtifactSha256: "5".repeat(64) },
    { externalCommandSha256: "3".repeat(64) },
    { node: `${fingerprint.node}-changed` },
    { v8: `${fingerprint.v8}-changed` },
    { inkRuntimeVersion: `${fingerprint.inkRuntimeVersion}-changed` },
    { compilerArtifactSha256: "4".repeat(64) },
  ];
  for (const variant of variants) {
    const changedFields = { ...fields, ...variant };
    const changed = { ...changedFields, digest: executionFingerprintDigest(changedFields) };
    assert.notEqual(benchmarkRunId(request, changed), benchmarkRunId(request, fingerprint), Object.keys(variant)[0]);
  }
  const report = runBenchmark(request);
  assert.equal(report.runId, benchmarkRunId(request));
  assert.equal(report.executionFingerprint.digest, fingerprint.digest);
});

test("summary generation refuses duplicate logical cells from mixed executions", () => {
  const fixture = generateFixture("shallow-obvious", 1, 1);
  const report = runBenchmark(requestFor(fixture));
  const changedFields = { ...report.executionFingerprint, node: `${report.executionFingerprint.node}-changed` };
  delete changedFields.digest;
  const changedFingerprint = { ...changedFields, digest: executionFingerprintDigest(changedFields) };
  const mixed = { ...report, runId: "f".repeat(32), executionFingerprint: changedFingerprint };
  const config = {
    schemaVersion: 1,
    families: ["shallow-obvious"],
    algorithms: ["random"],
    fixtureSeeds: [1],
    searchSeeds: [7],
    budgets: [25],
    difficulty: 1,
    storySeed: 1,
  };
  assert.throws(() => summarizeRuns([report, mixed], config), /executionFingerprint differs/);
});

test("observed-anytime summaries retain discoveries and censor resource stops at actual horizons", () => {
  const fixture = generateFixture("shallow-obvious", 3, 1);
  const randomBase = runBenchmark({ ...requestFor(fixture, "random"), budget: 50 });
  const systematicBase = runBenchmark({ ...requestFor(fixture, "systematic"), budget: 50 });
  const found = systematicBase.discoveredBugs[0];
  assert.ok(found);
  const random = {
    ...randomBase,
    status: "resource-stopped",
    stopReason: "memory",
    discoveredBugs: [],
    counts: { ...randomBase.counts, transitions: 20 },
    timing: { ...randomBase.timing, wallMs: 20 },
    resources: { ...randomBase.resources, stopReason: "memory" },
  };
  const systematic = {
    ...systematicBase,
    status: "resource-stopped",
    stopReason: "memory",
    discoveredBugs: [{ ...found, transition: 5, elapsedMs: 5 }],
    counts: { ...systematicBase.counts, transitions: 10 },
    timing: { ...systematicBase.timing, wallMs: 10 },
    resources: { ...systematicBase.resources, stopReason: "memory" },
  };
  const config = {
    schemaVersion: 1,
    families: ["shallow-obvious"],
    algorithms: ["random", "systematic"],
    fixtureSeeds: [3],
    searchSeeds: [7],
    budgets: [50],
    difficulty: 1,
    storySeed: 1,
  };
  const summary = summarizeRuns([random, systematic], config);
  assert.equal(summary.probability.find((cell) => cell.algorithm === "systematic").discoveries, 1);
  assert.equal(summary.probability.find((cell) => cell.algorithm === "systematic").completedRuns, 0);
  assert.ok(summary.survivalTime.some((point) => point.algorithm === "random" && point.elapsedMs === 20 && point.censored === 1 && point.resourceStops === 1));
  assert.equal(summary.complementarity[0].resourceAffectedRuns, 1);
  assert.equal(summary.complementarity[0].exclusiveDiscoveries.systematic, 1);
});
