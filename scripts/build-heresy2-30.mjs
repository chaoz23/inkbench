#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractLocations, loadAuthoredFixture } from "../dist/corpus/load.js";
import { InstrumentedController } from "../dist/core/runtime.js";
import { getSearcher } from "../dist/searchers/index.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLEAN_MANIFEST_PATH = join(REPO_ROOT, "corpus/authored-v1/manifest.json");
const CLEAN_DIRECTORY = join(REPO_ROOT, "corpus/authored-v1/heresy2");
const OUTPUT_ROOT = join(REPO_ROOT, "corpus/authored-planted-v1");
const CASE_DIRECTORY = join(OUTPUT_ROOT, "heresy2-30");
const ENTRYPOINT = "heresy2.ink";
const ARTIFACT = "story.ink.json";
const FIXTURE_ID = "authored-planted-heresy2-30";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const mutations = [
  ["heresy2-01-lounge-wafer", "shallow-obvious", "inventory-alias", "debrief.ink", "debrief.lounge", "= lounge\n", "~ wafer_chip = 1", "Entering the debrief lounge creates a late-game wafer chip."],
  ["heresy2-02-bob-crm-key", "shallow-obvious", "unrelated-side-effect", "debrief.ink", "debrief.bob_start", "= bob_start\n", "~ crm114_key = 1", "Beginning Bob's interview silently grants an unrelated control-room key."],
  ["heresy2-03-inquisition-trust", "order-dependent", "cross-state-contamination", "debrief.ink", "debrief.inquisition", "= inquisition\n", "~ keith_trusts = 1", "Discussing the Inquisition incorrectly marks Keith as trusting the agent."],
  ["heresy2-04-ordered-apology", "order-dependent", "premature-state-commit", "debrief.ink", "debrief.other_agent", "= other_agent\n", "{ inquisition:\n    ~ bob_has_apologized = 1\n    ~ inkbench_bug_04 = true\n}", "Discussing the Inquisition before Keith prematurely records Bob's later apology."],
  ["heresy2-05-delayed-laura-state", "delayed-consequence", "history-erasure", "debrief.ink", "debrief.laura_details", "= laura_details\n", "{ bob_has_apologized:\n    ~ laura_state = 2\n    ~ inkbench_bug_05 = true\n}", "The premature apology corrupts Laura's state several choices later."],
  ["heresy2-06-card-b-combat-sign", "shallow-obvious", "numeric-sign-corruption", "base.ink", "base.card_B", "= card_B\n", "~ combat_ratio = 0 - combat_ratio", "Card B reverses the combat ratio sign before deployment."],
  ["heresy2-07-card-c-code-reset", "delayed-consequence", "stale-state-reset", "base.ink", "base.card_C", "= card_C\n", "~ code_apollo_backroom = 0", "Card C clears a future access code."],
  ["heresy2-08-card-e-badge", "combination-lock", "impossible-inventory-state", "base.ink", "base.card_E", "= card_E\n", "~ inquisition_leader_badge = 1", "Card E creates an endgame badge before it can exist."],
  ["heresy2-09-transfer-hypermarket-id", "deep-corridor", "premature-state-commit", "workshop.ink", "workshop.transfer", "= transfer\n", "~ hypermarket_id = 1", "The transfer corridor grants a future Hypermarket identity."],
  ["heresy2-10-tattoo-revisit-item", "revisit-after-mutation", "revisit-side-effect", "workshop.ink", "workshop.tattoo", "= tattoo\n", "{ tattooed:\n    ~ item_poloshirt_inquisition = 1\n    ~ inkbench_bug_10 = true\n}", "Revisiting the tattoo machine after mutation creates an Inquisition shirt."],
  ["heresy2-11-panorama-counter", "false-novelty", "irrelevant-state-coupling", "workshop.ink", "workshop.panorama", "= panorama\n", "~ dummy_item = dummy_item + 1", "Every hallway revisit changes an irrelevant global counter."],
  ["heresy2-12-oracle-code-sign", "combination-lock", "numeric-sign-corruption", "workshop.ink", "workshop.door_to_oracle", "= door_to_oracle\n", "~ code_apollo_foyer = 0 - code_apollo_foyer", "Approaching room 237 reverses its combination code."],
  ["heresy2-13-desk-revisit-key", "revisit-after-mutation", "revisit-side-effect", "workshop.ink", "workshop.desk", "= desk\n", "{ padded_cell_key:\n    ~ computer_room_key = 1\n    ~ inkbench_bug_13 = true\n}", "Returning to the desk after taking one key creates another."],
  ["heresy2-14-drawer-book-alias", "shallow-obvious", "inventory-alias", "workshop.ink", "workshop.find_padded_cell_key", "= find_padded_cell_key\n", "~ dummies_book = 1", "Taking the padded-cell key also creates an unrelated book."],
  ["heresy2-15-terminal-wiring", "false-novelty", "irrelevant-state-coupling", "workshop.ink", "workshop.computer_terminal", "= computer_terminal\n", "~ gold_wiring = 1", "Examining the terminal creates remote wiring inventory."],
  ["heresy2-16-lcd-write-loss", "delayed-consequence", "write-after-write-loss", "workshop.ink", "workshop.find_lcd_display", "    ~ lcd_display = 1\n", "    ~ lcd_display = 0", "The newly acquired LCD is immediately overwritten as absent."],
  ["heresy2-17-login-door-bypass", "combination-lock", "condition-bypass", "workshop.ink", "workshop.computer_login", "= computer_login\n", "~ door_to_oracle_code = 1", "Opening the login prompt grants an unrelated locked-door credential."],
  ["heresy2-18-retry-power-loop", "loop-count", "loop-off-by-one", "workshop.ink", "workshop.bad_try", "= bad_try\n", "{ bad_try > 1:\n    ~ exo_power = exo_power - 7\n    ~ inkbench_bug_18 = true\n}", "The second failed login retry applies an extra power penalty."],
  ["heresy2-19-cell-key-bypass", "combination-lock", "condition-bypass", "workshop.ink", "workshop.padded_cell", "= padded_cell\n", "~ padded_cell_key = 1", "Entering the cell scene silently bypasses its key requirement."],
  ["heresy2-20-helen-apollo-state", "order-dependent", "cross-state-contamination", "workshop.ink", "workshop.meet_helen", "= meet_helen\n", "~ apollo_and_daphne = 1", "Meeting Helen commits an unrelated Apollo outcome."],
  ["heresy2-21-owl-stun-orb", "deep-corridor", "unrelated-side-effect", "workshop.ink", "workshop.owl", "= owl\n", "~ stun_orb = 1", "Approaching the owl creates a combat item."],
  ["heresy2-22-garden-temple-reveal", "delayed-consequence", "premature-state-commit", "workshop.ink", "workshop.to_garden", "= to_garden\n", "~ temple_found = 1", "Trying the garden exit reveals the temple before its clue is learned."],
  ["heresy2-23-garden-trust-reset", "delayed-consequence", "stale-state-reset", "garden.ink", "garden.garden_gate", "= garden_gate\n", "~ keith_trusts = 0", "Returning to the garden gate erases an unrelated trust state."],
  ["heresy2-24-noble-beans", "shallow-obvious", "inventory-alias", "garden.ink", "garden.noble", "= noble\n", "~ fava_beans = 1", "Talking to the noble creates an unrelated market item."],
  ["heresy2-25-alcove-random-noise", "novelty-honeypot", "irrelevant-state-coupling", "garden.ink", "garden.alcove", "= alcove\n", "~ combo_value = RANDOM(0, 9999)", "The alcove produces irrelevant random state on every visit."],
  ["heresy2-26-dish-code-sign", "combination-lock", "numeric-sign-corruption", "garden.ink", "garden.dish", "= dish\n", "~ code_melampus = 0 - code_melampus", "Examining the symbol dish reverses Melampus's code."],
  ["heresy2-27-conversation-wiring", "false-novelty", "cross-state-contamination", "garden.ink", "garden.conversation", "= conversation\n", "~ gold_wiring = 1", "Listening to garden gossip creates workshop wiring."],
  ["heresy2-28-servant-apology-loss", "delayed-consequence", "history-erasure", "garden.ink", "garden.servant", "= servant\n", "~ bob_has_apologized = 0", "Speaking with the servant erases Bob's prior apology state."],
  ["heresy2-29-pronaos-crutch", "rare-prefix", "impossible-inventory-state", "temple.ink", "temple.pronaos", "= pronaos\n", "~ crutch = 1", "Entering the pronaos creates the crutch before any acquisition choice."],
  ["heresy2-30-beggar-compound", "compound-needle", "compound-state-corruption", "temple.ink", "temple.enter_via_beggar", "= enter_via_beggar\n", "~ melampus_key = 0\n~ antivirus = 1\n~ inkbench_bug_30 = true", "A compound rolling history at the beggar entrance creates antivirus early and corrupts the Melampus-key transition."],
].map(([id, family, faultType, file, knot, anchor, effectCode, effect], index) => ({
  id,
  family,
  faultType,
  file,
  knot,
  anchor,
  effectCode,
  effect,
  oracleVariable: `inkbench_bug_${String(index + 1).padStart(2, "0")}`,
  probeVariable: `inkbench_probe_${String(index + 1).padStart(2, "0")}`,
  historyToken: (index + 1) * 7_919,
}));

const CALIBRATION_SEED = 101;
const CALIBRATION_BUDGET = 10_000;
const HISTORY_MODULUS = 1_000_003;
const EASY_CONTROL_IDS = new Set(mutations.slice(0, 8).map((mutation) => mutation.id));

function compilerArgument() {
  const index = process.argv.indexOf("--compiler");
  if (index < 0 || !process.argv[index + 1]) throw new Error("pass --compiler /path/to/inklecate");
  return resolve(process.argv[index + 1]);
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function insertAfter(source, anchor, insertion, mutationId) {
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error(`${mutationId}: source anchor was not found`);
  if (source.indexOf(anchor, index + anchor.length) >= 0) throw new Error(`${mutationId}: source anchor is not unique`);
  return `${source.slice(0, index + anchor.length)}${insertion}\n${source.slice(index + anchor.length)}`;
}

function sourceLine(source, anchor) {
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error(`source anchor was not found: ${anchor}`);
  return source.slice(0, index).split(/\r?\n/).length;
}

const compiler = compilerArgument();
const cleanManifest = JSON.parse(readFileSync(CLEAN_MANIFEST_PATH, "utf8"));
const upstreamCase = cleanManifest.cases.find((candidate) => candidate.id === "heresy2");
if (!upstreamCase) throw new Error("heresy2 is missing from the clean authored corpus manifest");

const cleanFixture = loadAuthoredFixture("heresy2");
const cleanSources = Object.fromEntries(Object.keys(upstreamCase.files).map((filename) => [filename, readFileSync(join(CLEAN_DIRECTORY, filename), "utf8")]));
const upstreamLines = new Map(mutations.map((mutation) => [mutation.id, sourceLine(cleanSources[mutation.file], mutation.anchor)]));

function indented(source) {
  return source.split("\n").map((line) => `    ${line}`).join("\n");
}

function buildSources(mode, fingerprints = new Map()) {
  const sources = { ...cleanSources };
  for (const mutation of mutations) {
    const markerAlreadyIncluded = mutation.effectCode.includes(mutation.oracleVariable);
    const fault = markerAlreadyIncluded ? mutation.effectCode : `${mutation.effectCode}\n~ ${mutation.oracleVariable} = true`;
    const historyUpdate = `~ inkbench_history = (inkbench_history * 131 + ${mutation.historyToken}) % ${HISTORY_MODULUS}`;
    let insertion = EASY_CONTROL_IDS.has(mutation.id) ? fault : "";
    if (mode === "calibration") {
      insertion = `${historyUpdate}\n~ ${mutation.probeVariable} = inkbench_history${EASY_CONTROL_IDS.has(mutation.id) ? `\n${fault}` : ""}`;
    }
    if (mode === "final") {
      const fingerprint = fingerprints.get(mutation.id);
      if (!EASY_CONTROL_IDS.has(mutation.id) && fingerprint === undefined) throw new Error(`${mutation.id}: missing calibration fingerprint`);
      insertion = EASY_CONTROL_IDS.has(mutation.id)
        ? `${historyUpdate}\n${fault}`
        : `${historyUpdate}\n{ inkbench_history == ${fingerprint}:\n${indented(fault)}\n}`;
    }
    sources[mutation.file] = insertAfter(sources[mutation.file], mutation.anchor, insertion, mutation.id);
  }
  const oracleDeclarations = mutations.map((mutation) => `VAR ${mutation.oracleVariable} = false`).join("\n");
  const declarations = mode === "calibration"
    ? `\n// Deterministic build-only probes. These do not appear in the published derivative.\nVAR inkbench_history = 17\n${mutations.map((mutation) => `VAR ${mutation.probeVariable} = -1`).join("\n")}\n${oracleDeclarations}\n`
    : mode === "paths"
      ? `\n// Easy-control oracle markers used while calibrating later histories.\n${oracleDeclarations}\n`
      : `\n// Observable history state plus private InkBench oracle markers.\nVAR inkbench_history = 17\n${oracleDeclarations}\n`;
  sources["globals.ink"] = `${sources["globals.ink"].trimEnd()}${declarations}`;
  return sources;
}

function compileSources(sources) {
  for (const [filename, contents] of Object.entries(sources)) write(join(CASE_DIRECTORY, filename), contents);
  const compile = spawnSync(compiler, ["-c", "-o", ARTIFACT, ENTRYPOINT], {
    cwd: CASE_DIRECTORY,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw new Error(`inklecate failed (${compile.status}):\n${compile.stdout}\n${compile.stderr}`);
  const artifactPath = join(CASE_DIRECTORY, ARTIFACT);
  let compiled = readFileSync(artifactPath, "utf8");
  if (compiled.charCodeAt(0) === 0xfeff) compiled = compiled.slice(1);
  if (!compiled.endsWith("\n")) compiled = `${compiled}\n`;
  JSON.parse(compiled);
  write(artifactPath, compiled);
  return compiled;
}

const pathSources = buildSources("paths");
const pathArtifact = compileSources(pathSources);
const pathFixture = {
  ...cleanFixture,
  source: pathSources[ENTRYPOINT],
  sourceBundle: { entrypoint: ENTRYPOINT, files: pathSources },
  compiledStory: pathArtifact,
};
const calibrationSources = buildSources("calibration");
const calibrationArtifact = compileSources(calibrationSources);
const calibrationFixture = {
  ...cleanFixture,
  source: calibrationSources[ENTRYPOINT],
  sourceBundle: { entrypoint: ENTRYPOINT, files: calibrationSources },
  compiledStory: calibrationArtifact,
};
const mutationByKnot = new Map(mutations.map((mutation) => [mutation.knot, mutation]));
const calibrationPaths = new Map();
const qualifies = (mutation, observation) => {
  if (mutation.id === "heresy2-10-tattoo-revisit-item") return observation.variables.tattooed === 1 && (observation.visitCounts[mutation.knot] ?? 0) > 1;
  if (mutation.id === "heresy2-13-desk-revisit-key") return observation.variables.padded_cell_key === 1;
  if (mutation.id === "heresy2-18-retry-power-loop") return (observation.visitCounts[mutation.knot] ?? 0) > 1;
  return true;
};
const calibrationController = new InstrumentedController(pathFixture, CALIBRATION_BUDGET, 1, {
  onTransition(result) {
    const mutation = mutationByKnot.get(result.after.location);
    if (!mutation || !qualifies(mutation, result.after)) return;
    const candidate = {
      choicePath: [...result.after.choicePath],
      choiceTextPath: [...result.after.choiceTextPath],
    };
    const existing = calibrationPaths.get(mutation.id);
    calibrationPaths.set(mutation.id, { first: existing?.first ?? candidate, latest: candidate });
  },
});
calibrationController.launch();
getSearcher("coverage").run(calibrationController, CALIBRATION_SEED);

function fingerprintFor(mutation, candidate) {
  const controller = new InstrumentedController(calibrationFixture, candidate.choicePath.length + 1, 1);
  let observation = controller.launch();
  for (let step = 0; step < candidate.choicePath.length; step += 1) {
    const choiceIndex = candidate.choicePath[step];
    if (!observation.choices[choiceIndex]) throw new Error(`${mutation.id}: calibration replay diverged at step ${step}`);
    observation = controller.step(choiceIndex).after;
  }
  const fingerprint = observation.variables[mutation.probeVariable];
  if (!Number.isSafeInteger(fingerprint) || fingerprint < 0) throw new Error(`${mutation.id}: calibration replay did not record its history probe`);
  return fingerprint;
}

const fingerprints = new Map();
for (const mutation of mutations) {
  const candidates = calibrationPaths.get(mutation.id);
  if (!candidates) throw new Error(`${mutation.id}: calibration did not reach a qualifying ${mutation.knot} state`);
  if (!EASY_CONTROL_IDS.has(mutation.id)) {
    candidates.first.fingerprint = fingerprintFor(mutation, candidates.first);
    fingerprints.set(mutation.id, candidates.first.fingerprint);
  }
}

const mutatedSources = buildSources("final", fingerprints);
const artifact = compileSources(mutatedSources);
const upstreamLicense = readFileSync(join(CLEAN_DIRECTORY, upstreamCase.source.licenseFile), "utf8").trimEnd();
const provenance = `${upstreamLicense}\n\n## InkBench derivative notice\n\n**Heresy II** is by Randall Frank, Andrew Florance, and Marina Galvagni and is used under Creative Commons Attribution 4.0. The pinned clean source is stored in \`corpus/authored-v1/heresy2\` from commit \`${upstreamCase.source.commit}\` of ${upstreamCase.source.repository}.\n\nInkBench deterministically applies 30 disclosed mutations across the debrief, base, workshop, garden, and temple files. Eight mutations are deliberately exposed controls; the remaining 22 require reproducible history fingerprints selected with build-only seed ${CALIBRATION_SEED}, outside the evaluation seed range. The observable rolling history state stresses order, revisits, and false novelty without exposing oracle values. These modifications are benchmark defects and must not be described as defects in the upstream story. Oracle globals are private test instrumentation and are removed from search observations and InkCheck input.\n`;
write(join(CASE_DIRECTORY, "LICENSE-AND-PROVENANCE.md"), provenance);

const bugRecords = mutations.map((mutation, index) => {
  const candidates = calibrationPaths.get(mutation.id);
  const selected = candidates.first;
  const depth = selected.choicePath.length;
  const historyQualified = !EASY_CONTROL_IDS.has(mutation.id);
  return {
    id: mutation.id,
    family: mutation.family,
    faultType: mutation.faultType,
    trigger: `Reach ${mutation.knot}${mutation.id === "heresy2-04-ordered-apology" ? " after discussing the Inquisition" : ""}${historyQualified ? ` with disclosed rolling-history fingerprint ${selected.fingerprint}` : ""}.`,
    effect: mutation.effect,
    description: `${historyQualified ? "Reproduce the planted order/history precondition and reach" : "Reach"} ${mutation.knot}. ${mutation.effect}`,
    oracle: { kind: "variable-equals", variable: mutation.oracleVariable, value: true },
    site: { file: mutation.file, knot: mutation.knot, upstreamLine: upstreamLines.get(mutation.id) },
    dimensions: {
      depth,
      width: mutation.family === "novelty-honeypot" ? 6 : 2,
      stateDimensionality: Math.min(8, 1 + Math.floor(index / 5)),
      rarity: Math.min(10, Math.max(1, Math.floor(depth / 30) + (historyQualified ? 3 : 0))),
      delay: mutation.family === "delayed-consequence" ? Math.max(2, Math.floor(depth / 5)) : 0,
      revisit: mutation.family === "revisit-after-mutation" || mutation.family === "loop-count" ? 2 : 0,
      deception: mutation.family === "false-novelty" || mutation.family === "novelty-honeypot" ? 5 : Math.floor(depth / 12),
      order: historyQualified ? Math.min(10, 2 + Math.floor(depth / 60)) : mutation.family === "order-dependent" || mutation.family === "compound-needle" ? 3 : 0,
    },
  };
});

const fixture = {
  tier: "authored-planted",
  source: mutatedSources[ENTRYPOINT],
  sourceBundle: { entrypoint: ENTRYPOINT, files: mutatedSources },
  compiledStory: artifact,
  manifest: {
    schemaVersion: 1,
    generatorVersion: "authored-planted-v1",
    fixtureId: FIXTURE_ID,
    family: upstreamCase.family,
    seed: 0,
    difficulty: 10,
    dimensions: { depth: Math.max(...bugRecords.map((bug) => bug.dimensions.depth)), width: 6, stateDimensionality: 8, rarity: 10, delay: 7, revisit: 4, deception: 8, order: 8 },
    parameters: { storyId: "heresy2-30", plantedBugs: 30, mutationSet: "heresy2-diverse-30-v2", calibrationSeed: CALIBRATION_SEED, easyControls: EASY_CONTROL_IDS.size, historyQualifiedBugs: mutations.length - EASY_CONTROL_IDS.size },
    locations: extractLocations(mutatedSources),
    bugs: bugRecords,
    mutationSet: "heresy2-diverse-30-v2",
    source: upstreamCase.source,
    compiler: { name: "inklecate", version: "1.2.1", artifactSha256: sha256(artifact), arguments: ["-c", "-o", ARTIFACT, ENTRYPOINT] },
  },
};

const witnessOverrides = {
  "heresy2-04-ordered-apology": { sourceBugId: "heresy2-03-inquisition-trust", suffix: [0] },
};
const witnesses = {};
for (const mutation of mutations) {
  const override = witnessOverrides[mutation.id];
  const candidates = calibrationPaths.get(override?.sourceBugId ?? mutation.id);
  const base = candidates?.first;
  if (!base) throw new Error(`${mutation.id}: coverage calibration did not retain a witness candidate`);
  const choicePath = [...base.choicePath, ...(override?.suffix ?? [])];
  const controller = new InstrumentedController(fixture, choicePath.length + 1, 1);
  let observation = controller.launch();
  const choiceTextPath = [];
  for (let step = 0; step < choicePath.length; step += 1) {
    const choiceIndex = choicePath[step];
    const choice = observation.choices[choiceIndex];
    if (!choice) throw new Error(`${mutation.id}: witness diverged at step ${step} in ${observation.location}`);
    choiceTextPath.push(choice.text);
    observation = controller.step(choiceIndex).after;
  }
  if (!controller.bugDiscoveries.some((discovery) => discovery.bugId === mutation.id)) {
    throw new Error(`${mutation.id}: witness did not reach its oracle (ended at ${observation.location})`);
  }
  witnesses[mutation.id] = { choicePath, choiceTextPath };
}
const witnessArtifact = `${JSON.stringify({ schemaVersion: 1, fixtureId: FIXTURE_ID, witnesses }, null, 2)}\n`;
write(join(CASE_DIRECTORY, "witnesses.json"), witnessArtifact);

const files = Object.fromEntries(Object.keys(mutatedSources).sort().map((filename) => [filename, sha256(mutatedSources[filename])]));
const entry = {
  id: "heresy2-30",
  family: upstreamCase.family,
  directory: "heresy2-30",
  mutationSet: "heresy2-diverse-30-v2",
  difficulty: 10,
  source: {
    ...upstreamCase.source,
    name: "Heresy II — InkBench 30-bug derivative",
    licenseFile: "LICENSE-AND-PROVENANCE.md",
    licenseSha256: sha256(provenance),
    compileSetup: "Compile the original multi-file entrypoint after deterministic source mutation.",
    upstreamSourceSha256: upstreamCase.files[upstreamCase.source.entrypoint],
    generator: "scripts/build-heresy2-30.mjs",
  },
  compiled: {
    file: ARTIFACT,
    sha256: sha256(artifact),
    compiler: "inklecate",
    compilerVersion: "1.2.1",
    arguments: ["-c", "-o", ARTIFACT, ENTRYPOINT],
    provenance: "Generated from the pinned Heresy II source with official inklecate 1.2.1 count-all-visits enabled.",
  },
  files,
  witnesses: { file: "witnesses.json", sha256: sha256(witnessArtifact) },
  bugs: bugRecords,
};
const manifestPath = join(OUTPUT_ROOT, "manifest.json");
const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { cases: [] };
const cases = [...existing.cases.filter((candidate) => candidate.id !== entry.id), entry].sort((left, right) => left.id.localeCompare(right.id));
const manifest = {
  schemaVersion: 1,
  tier: "authored-planted",
  corpusVersion: "authored-planted-v1",
  source: { cleanCorpusManifest: relative(REPO_ROOT, CLEAN_MANIFEST_PATH), cleanStoryIds: [...new Set(cases.map((candidate) => candidate.id === "the-intercept-20" ? "the-intercept" : "heresy2"))].sort() },
  cases,
};
write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(`built ${mutations.length} mutations in ${relative(REPO_ROOT, CASE_DIRECTORY)}\n`);
process.stdout.write(`verified ${Object.keys(witnesses).length} exact root-replay witnesses\n`);
process.stdout.write(`artifact sha256 ${entry.compiled.sha256}\n`);
