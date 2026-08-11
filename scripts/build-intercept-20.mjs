#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM_PATH = join(REPO_ROOT, "corpus/authored-v1/the-intercept/TheIntercept.ink");
const CLEAN_MANIFEST_PATH = join(REPO_ROOT, "corpus/authored-v1/manifest.json");
const OUTPUT_ROOT = join(REPO_ROOT, "corpus/authored-planted-v1");
const CASE_DIRECTORY = join(OUTPUT_ROOT, "the-intercept-20");
const ENTRYPOINT = "TheIntercept20.ink";
const ARTIFACT = "story.ink.json";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const mutations = [
  {
    id: "intercept-01-duplicate-wait",
    family: "shallow-obvious",
    phase: "early",
    faultType: "duplicate-choice",
    knot: "start",
    upstreamLine: 102,
    trigger: "Choose the second, accidentally duplicated Wait option in the opening plan.",
    effect: "The duplicate silently adds seven points of forcefulness before the interview.",
    dimensions: { depth: 1, width: 2, stateDimensionality: 1, rarity: 1, delay: 0, revisit: 0, deception: 0, order: 0 },
    apply(source) {
      return replaceOnce(source,
        "\t\t*\t[Wait]\t\t\n\t- \t-> waited",
        "\t\t*\t[Wait]\t\t\n\t\t*\t[Wait]\n\t\t\t~ inkbench_bug_01 = true\n\t\t\t~ forceful = forceful + 7\n\t- \t-> waited",
        this.id);
    },
  },
  {
    id: "intercept-02-teacup-component-alias",
    family: "shallow-obvious",
    phase: "early",
    faultType: "inventory-alias",
    knot: "start.waited",
    upstreamLine: 120,
    trigger: "Take the first mug offered by Harris.",
    effect: "Acquiring the teacup also creates the stolen Bombe component in inventory.",
    dimensions: { depth: 2, width: 1, stateDimensionality: 2, rarity: 1, delay: 0, revisit: 0, deception: 0, order: 0 },
    apply(source) {
      return replaceOnce(source,
        "(took) [Take one]\n\t\t\t~ teacup = true",
        "(took) [Take one]\n\t\t\t~ teacup = true\n\t\t\t~ gotcomponent = true\n\t\t\t~ inkbench_bug_02 = true",
        this.id);
    },
  },
  {
    id: "intercept-03-calm-question-hidden",
    family: "rare-prefix",
    phase: "early",
    faultType: "missing-choice",
    knot: "harris_demands_component",
    upstreamLine: 270,
    trigger: "Reach Harris's first direct demand without being drugged.",
    effect: "The direct Yes answer is hidden by an inverted availability condition.",
    dimensions: { depth: 5, width: 2, stateDimensionality: 1, rarity: 2, delay: 0, revisit: 0, deception: 1, order: 1 },
    apply(source) {
      source = replaceOnce(source,
        "=== harris_demands_component ===\n\t\"{here_at_bletchley_diversion:Please|So}. Do you have it?\"",
        "=== harris_demands_component ===\n\t{ not drugged:\n\t\t~ inkbench_bug_03 = true\n\t}\n\t\"{here_at_bletchley_diversion:Please|So}. Do you have it?\"",
        this.id);
      return replaceOnce(source, "\t \t* \t[Yes]", "\t \t* { drugged }\t[Yes]", this.id);
    },
  },
  {
    id: "intercept-04-suspicion-sign-flip",
    family: "combination-lock",
    phase: "early",
    faultType: "numeric-sign-corruption",
    knot: "harris_demands_component",
    upstreamLine: 273,
    trigger: "Deny knowing where the component is at Harris's first demand.",
    effect: "The evasiveness score changes sign, reversing downstream personality gates.",
    dimensions: { depth: 6, width: 2, stateDimensionality: 2, rarity: 2, delay: 2, revisit: 0, deception: 1, order: 1 },
    apply(source) {
      return replaceOnce(source,
        "\t \t* (nope) [No] \"I have no idea.\" \n\t \t\t\t\t\t-> silence",
        "\t \t* (nope) [No] \"I have no idea.\" \n\t \t\t~ evasive = 0 - evasive\n\t \t\t~ inkbench_bug_04 = true\n\t \t\t-> silence",
        this.id);
    },
  },
  {
    id: "intercept-05-evade-administers-drug",
    family: "order-dependent",
    phase: "early",
    faultType: "unrelated-side-effect",
    knot: "harris_demands_component",
    upstreamLine: 280,
    trigger: "Evade Harris's first direct demand for the component.",
    effect: "Merely evading marks the protagonist as drugged without drinking tea.",
    dimensions: { depth: 7, width: 2, stateDimensionality: 3, rarity: 2, delay: 2, revisit: 0, deception: 1, order: 2 },
    apply(source) {
      return replaceOnce(source,
        "\t\t\t ~ raise(evasive)\n\t\t\t ~ lower(forceful)\n\t\t\t\"Don't play stupid,\"",
        "\t\t\t ~ raise(evasive)\n\t\t\t ~ lower(forceful)\n\t\t\t ~ drugged = true\n\t\t\t ~ inkbench_bug_05 = true\n\t\t\t\"Don't play stupid,\"",
        this.id);
    },
  },
  {
    id: "intercept-06-drink-drops-cup",
    family: "delayed-consequence",
    phase: "early",
    faultType: "stale-state-reset",
    knot: "harris_demands_component.drinkfromcup",
    upstreamLine: 310,
    trigger: "Take and drink the tea at Harris's demand.",
    effect: "The cup flag is cleared immediately after drinking, contradicting the scene and later state.",
    dimensions: { depth: 9, width: 2, stateDimensionality: 2, rarity: 2, delay: 3, revisit: 0, deception: 1, order: 1 },
    apply(source) {
      return replaceOnce(source,
        "\t\t\t \t\t~ drugged  = true\n\t\t\t \t\t~ teacup    = true",
        "\t\t\t \t\t~ drugged  = true\n\t\t\t \t\t~ teacup    = true\n\t\t\t \t\t~ teacup    = false\n\t\t\t \t\t~ inkbench_bug_06 = true",
        this.id);
    },
  },
  {
    id: "intercept-07-blackmail-frames-hooper",
    family: "order-dependent",
    phase: "interrogation",
    faultType: "cross-state-contamination",
    knot: "harris_presses_for_details.admit_open_to_pressure",
    upstreamLine: 371,
    trigger: "Admit being open to blackmail.",
    effect: "A confession about blackmail also marks Hooper as already framed.",
    dimensions: { depth: 10, width: 2, stateDimensionality: 4, rarity: 3, delay: 4, revisit: 0, deception: 2, order: 2 },
    apply(source) {
      return replaceOnce(source,
        "some things... which a man shouldn't do.\"\n\t ~ admitblackmail  = true",
        "some things... which a man shouldn't do.\"\n\t ~ admitblackmail  = true\n\t ~ framedhooper = true\n\t ~ inkbench_bug_07 = true",
        this.id);
    },
  },
  {
    id: "intercept-08-blame-no-one-names-hooper",
    family: "shallow-obvious",
    phase: "interrogation",
    faultType: "choice-effect-inversion",
    knot: "harris_asks_for_theory",
    upstreamLine: 419,
    trigger: "Choose Blame no-one when asked for a theory.",
    effect: "The supposedly neutral answer records that Hooper was named.",
    dimensions: { depth: 10, width: 2, stateDimensionality: 2, rarity: 2, delay: 2, revisit: 0, deception: 0, order: 1 },
    apply(source) {
      return replaceOnce(source,
        " \t* [Blame no—one] \n \t\t-> an_accident",
        " \t* [Blame no—one] \n\t\t~ hooper_mentioned = true\n\t\t~ inkbench_bug_08 = true\n \t\t-> an_accident",
        this.id);
    },
  },
  {
    id: "intercept-09-lie-erases-blackmail",
    family: "delayed-consequence",
    phase: "interrogation",
    faultType: "history-erasure",
    knot: "harris_has_seen_it_before",
    upstreamLine: 470,
    trigger: "Lie after earlier admitting vulnerability to blackmail.",
    effect: "The lie erases the earlier admission, altering later conditional dialogue.",
    dimensions: { depth: 12, width: 2, stateDimensionality: 3, rarity: 3, delay: 5, revisit: 0, deception: 2, order: 3 },
    apply(source) {
      return replaceOnce(source,
        "\t \t\"I wanted to tell you,\" I tell him.",
        "\t \t~ admitblackmail = false\n\t \t~ inkbench_bug_09 = true\n\t \t\"I wanted to tell you,\" I tell him.",
        this.id);
    },
  },
  {
    id: "intercept-10-dissemble-skips-accusation",
    family: "rare-prefix",
    phase: "interrogation",
    faultType: "wrong-divert",
    knot: "harris_demands_you_speak",
    upstreamLine: 494,
    trigger: "Dissemble while not drugged.",
    effect: "The branch skips the Hooper accusation and jumps into the confession narrative.",
    dimensions: { depth: 13, width: 2, stateDimensionality: 3, rarity: 3, delay: 1, revisit: 0, deception: 2, order: 2 },
    apply(source) {
      return replaceOnce(source,
        " * { not drugged  } [Dissemble] -> claim_hooper_took_component",
        " * { not drugged  } [Dissemble]\n\t~ hooper_mentioned = false\n\t~ inkbench_bug_10 = true\n\t-> i_met_a_young_man",
        this.id);
    },
  },
  {
    id: "intercept-11-lie-reapplies-drug",
    family: "combination-lock",
    phase: "interrogation",
    faultType: "condition-bypass",
    knot: "i_met_a_young_man",
    upstreamLine: 536,
    trigger: "Reach the undrugged confession path and choose Lie.",
    effect: "The truth-serum state turns back on even though no drug is present.",
    dimensions: { depth: 16, width: 3, stateDimensionality: 4, rarity: 4, delay: 3, revisit: 0, deception: 2, order: 3 },
    apply(source) {
      return replaceOnce(source,
        "\t * { not drugged  }   \t[Lie] -> nope",
        "\t * { not drugged  }   \t[Lie]\n\t \t~ drugged = true\n\t \t~ inkbench_bug_11 = true\n\t \t-> nope",
        this.id);
    },
  },
  {
    id: "intercept-12-denial-creates-component",
    family: "combination-lock",
    phase: "interrogation",
    faultType: "impossible-inventory-state",
    knot: "i_met_a_young_man",
    upstreamLine: 562,
    trigger: "Claim not to have the component, then choose Lie.",
    effect: "The denial creates the component in inventory while dialogue says it is gone.",
    dimensions: { depth: 18, width: 2, stateDimensionality: 5, rarity: 4, delay: 2, revisit: 0, deception: 2, order: 3 },
    apply(source) {
      return replaceOnce(source,
        "\t\t* * [Lie] \t\t\t\t\t\t\t-> dont_have",
        "\t\t* * [Lie]\n\t\t\t~ gotcomponent = true\n\t\t\t~ inkbench_bug_12 = true\n\t\t\t-> dont_have",
        this.id);
    },
  },
  {
    id: "intercept-13-hot-temper-prematurely-convicts",
    family: "order-dependent",
    phase: "interrogation",
    faultType: "premature-state-commit",
    knot: "claim_hooper_took_component",
    upstreamLine: 664,
    trigger: "Accuse Hooper and choose the circumstantial Imply argument.",
    effect: "Hooper is recorded as the revealed culprit before evidence or confession.",
    dimensions: { depth: 18, width: 3, stateDimensionality: 5, rarity: 5, delay: 6, revisit: 0, deception: 2, order: 5 },
    apply(source) {
      return replaceOnce(source,
        "\t\t * \t[Imply] \"At the moment the machine halted,",
        "\t\t * \t[Imply]\n\t\t\t~ revealedhooperasculprit = true\n\t\t\t~ inkbench_bug_13 = true\n\t\t\t\"At the moment the machine halted,",
        this.id);
    },
  },
  {
    id: "intercept-14-threat-loses-clue",
    family: "delayed-consequence",
    phase: "escape",
    faultType: "write-after-write-loss",
    knot: "inside_hoopers_hut",
    upstreamLine: 876,
    trigger: "Threaten Hooper with the exact Hut 2 hiding place.",
    effect: "The freshly stored straight clue is immediately overwritten with NONE.",
    dimensions: { depth: 20, width: 3, stateDimensionality: 4, rarity: 4, delay: 8, revisit: 0, deception: 2, order: 3 },
    apply(source) {
      return replaceOnce(source,
        "nothing you can do to stop any of that from happening.\"\n\t \t\t~ hooperClueType = STRAIGHT",
        "nothing you can do to stop any of that from happening.\"\n\t \t\t~ hooperClueType = STRAIGHT\n\t \t\t~ hooperClueType = NONE\n\t \t\t~ inkbench_bug_14 = true",
        this.id);
    },
  },
  {
    id: "intercept-15-door-revisit-breaks-window",
    family: "revisit-after-mutation",
    phase: "escape",
    faultType: "revisit-side-effect",
    knot: "slam_door_shut_and_gone.from_outside_heard",
    upstreamLine: 973,
    trigger: "Try the window, listen at the keyhole, then revisit the door.",
    effect: "Revisiting the locked door marks the untouched window as smashed.",
    dimensions: { depth: 23, width: 3, stateDimensionality: 5, rarity: 5, delay: 2, revisit: 3, deception: 2, order: 4 },
    apply(source) {
      return replaceOnce(source,
        "\t* { not try_the_door  } {listened}   [Try the door] -> try_the_door",
        "\t* { not try_the_door  } {listened}   [Try the door]\n\t\t~ smashedglass = true\n\t\t~ inkbench_bug_15 = true\n\t\t-> try_the_door",
        this.id);
    },
  },
  {
    id: "intercept-16-bunk-loop-forgets-tool",
    family: "loop-count",
    phase: "escape",
    faultType: "loop-off-by-one",
    knot: "slam_door_shut_and_gone.find_something_to_smash_window",
    upstreamLine: 1076,
    trigger: "Inspect enough bunk items to reveal Something else, then take it.",
    effect: "On the revisit threshold, the selected window-smashing tool is reset.",
    dimensions: { depth: 28, width: 4, stateDimensionality: 4, rarity: 5, delay: 2, revisit: 4, deception: 3, order: 3 },
    apply(source) {
      return replaceOnce(source,
        "\t\t* * {bunk_opts > 1} [Something else] -> opts",
        "\t\t* * {bunk_opts > 1} [Something else]\n\t\t\t~ smashingWindowItem = NONE\n\t\t\t~ inkbench_bug_16 = true\n\t\t\t-> opts",
        this.id);
    },
  },
  {
    id: "intercept-17-muddy-route-duplicates-component",
    family: "false-novelty",
    phase: "escape",
    faultType: "irrelevant-state-coupling",
    knot: "smash_the_window",
    upstreamLine: 1104,
    trigger: "Take the longer muddy route to Hut 2.",
    effect: "The irrelevant muddy-shoes flag also creates the component before it is collected.",
    dimensions: { depth: 30, width: 3, stateDimensionality: 6, rarity: 4, delay: 1, revisit: 1, deception: 5, order: 2 },
    apply(source) {
      return replaceOnce(source,
        "\t\t\t\t~ muddyshoes  = true",
        "\t\t\t\t~ muddyshoes  = true\n\t\t\t\t~ gotcomponent = true\n\t\t\t\t~ inkbench_bug_17 = true",
        this.id);
    },
  },
  {
    id: "intercept-18-leave-takes-component",
    family: "shallow-obvious",
    phase: "escape",
    faultType: "choice-effect-inversion",
    knot: "smash_the_window",
    upstreamLine: 1111,
    trigger: "Choose Leave it after reaching the hidden component.",
    effect: "The Leave it action puts the component into inventory.",
    dimensions: { depth: 31, width: 2, stateDimensionality: 5, rarity: 4, delay: 0, revisit: 1, deception: 1, order: 2 },
    apply(source) {
      return replaceOnce(source,
        "\t \t* [Leave it] \n\t \t\tStill there means",
        "\t \t* [Leave it] \n\t \t\t~ gotcomponent = true\n\t \t\t~ inkbench_bug_18 = true\n\t \t\tStill there means",
        this.id);
    },
  },
  {
    id: "intercept-19-compound-item-resurrection",
    family: "compound-needle",
    phase: "endgame",
    faultType: "compound-state-corruption",
    knot: "return_to_room_after_excursion",
    upstreamLine: 1206,
    trigger: "Take the muddy route, frame Hooper on the tent, and return without the component.",
    effect: "The component resurrects only when three unrelated history conditions coincide.",
    dimensions: { depth: 38, width: 4, stateDimensionality: 8, rarity: 7, delay: 6, revisit: 2, deception: 4, order: 6 },
    apply(source) {
      return replaceOnce(source,
        "=== return_to_room_after_excursion\n\t{ gotcomponent :",
        "=== return_to_room_after_excursion\n\t{ muddyshoes && framedhooper && not gotcomponent:\n\t\t~ gotcomponent = true\n\t\t~ inkbench_bug_19 = true\n\t}\n\t{ gotcomponent :",
        this.id);
    },
  },
  {
    id: "intercept-20-returned-component-option-hidden",
    family: "delayed-consequence",
    phase: "endgame",
    faultType: "delayed-missing-choice",
    knot: "night_passes",
    upstreamLine: 1241,
    trigger: "Return to the room carrying the component and reach morning.",
    effect: "The Show him the component option is hidden by an inverted condition.",
    dimensions: { depth: 39, width: 3, stateDimensionality: 7, rarity: 5, delay: 7, revisit: 2, deception: 3, order: 4 },
    apply(source) {
      source = replaceOnce(source,
        "=== night_passes\n// In room smashed glass",
        "=== night_passes\n// In room smashed glass\n\t{ gotcomponent:\n\t\t~ inkbench_bug_20 = true\n\t}",
        this.id);
      return replaceOnce(source,
        " \t* { gotcomponent  }   [Show him the component] -> someone_threw_component",
        " \t* { not gotcomponent  }   [Show him the component] -> someone_threw_component",
        this.id);
    },
  },
];

function replaceOnce(source, needle, replacement, mutationId) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`${mutationId}: source anchor was not found`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`${mutationId}: source anchor is not unique`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function oracleDeclarations(phase) {
  const selected = mutations.filter((mutation) => mutation.phase === phase);
  return `// Generated by scripts/build-intercept-20.mjs.\n// Oracle markers are test instrumentation and are not exposed to search policies.\n${selected.map((mutation) => `VAR inkbench_bug_${mutation.id.slice(10, 12)} = false`).join("\n")}\n\n`;
}

function splitAt(source, anchor, label) {
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error(`${label}: phase boundary was not found`);
  if (source.indexOf(anchor, index + anchor.length) >= 0) throw new Error(`${label}: phase boundary is not unique`);
  return [source.slice(0, index), source.slice(index)];
}

function compilerArgument() {
  const index = process.argv.indexOf("--compiler");
  if (index < 0 || !process.argv[index + 1]) throw new Error("pass --compiler /path/to/inklecate");
  return resolve(process.argv[index + 1]);
}

const compiler = compilerArgument();
const cleanManifest = JSON.parse(readFileSync(CLEAN_MANIFEST_PATH, "utf8"));
const upstreamCase = cleanManifest.cases.find((candidate) => candidate.id === "the-intercept");
if (!upstreamCase) throw new Error("the-intercept is missing from the clean authored corpus manifest");

let source = readFileSync(UPSTREAM_PATH, "utf8");
for (const mutation of mutations) source = mutation.apply(source);
const [earlySource, afterEarly] = splitAt(source, "=== harris_presses_for_details", "early/interrogation");
const [interrogationSource, afterInterrogation] = splitAt(afterEarly, "=== inside_hoopers_hut", "interrogation/escape");
const [escapeSource, endgameSource] = splitAt(afterInterrogation, "=== live_on_the_run", "escape/endgame");
const phaseSources = { early: earlySource, interrogation: interrogationSource, escape: escapeSource, endgame: endgameSource };

const entrypointSource = [
  "// Deterministic InkBench derivative of The Intercept; see LICENSE-AND-PROVENANCE.md.",
  "INCLUDE bugs/early.ink",
  "INCLUDE bugs/interrogation.ink",
  "INCLUDE bugs/escape.ink",
  "INCLUDE bugs/endgame.ink",
  "",
].join("\n");

write(join(CASE_DIRECTORY, ENTRYPOINT), entrypointSource);
for (const phase of ["early", "interrogation", "escape", "endgame"]) {
  write(join(CASE_DIRECTORY, `bugs/${phase}.ink`), `${oracleDeclarations(phase)}${phaseSources[phase]}`);
}

const upstreamLicense = readFileSync(join(REPO_ROOT, "corpus/authored-v1", upstreamCase.directory, upstreamCase.source.licenseFile), "utf8").trimEnd();
const provenance = `${upstreamLicense}\n\n## InkBench derivative notice\n\nThis benchmark is a modified derivative of **The Intercept** by inkle Ltd, copyright 2016, licensed under the MIT License above. The pinned unmodified source is stored at \`corpus/authored-v1/the-intercept/TheIntercept.ink\` from commit \`${upstreamCase.source.commit}\` of ${upstreamCase.source.repository}.\n\nInkBench deterministically applies the 20 disclosed mutations in \`scripts/build-intercept-20.mjs\`. Oracle marker globals are instrumentation: search strategies receive ordinary runtime observations, while only the benchmark controller maps those variables to planted-bug identities.\n\nThe source remains attributable to inkle Ltd; the mutation set and benchmark packaging are additions by the InkBench contributors.\n`;
write(join(CASE_DIRECTORY, "LICENSE-AND-PROVENANCE.md"), provenance);

const compile = spawnSync(compiler, ["-c", "-o", ARTIFACT, ENTRYPOINT], {
  cwd: CASE_DIRECTORY,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (compile.error) throw compile.error;
if (compile.status !== 0) throw new Error(`inklecate failed (${compile.status}):\n${compile.stdout}\n${compile.stderr}`);
const artifactPath = join(CASE_DIRECTORY, ARTIFACT);
let artifact = readFileSync(artifactPath, "utf8");
if (artifact.charCodeAt(0) === 0xfeff) artifact = artifact.slice(1);
if (!artifact.endsWith("\n")) artifact = `${artifact}\n`;
JSON.parse(artifact);
write(artifactPath, artifact);

const sourceFiles = [ENTRYPOINT, "bugs/early.ink", "bugs/interrogation.ink", "bugs/escape.ink", "bugs/endgame.ink"];
const files = Object.fromEntries(sourceFiles.map((filename) => [filename, sha256(readFileSync(join(CASE_DIRECTORY, filename), "utf8"))]));
const witnessFilename = "witnesses.json";
const witnessPath = join(CASE_DIRECTORY, witnessFilename);
if (!existsSync(witnessPath)) throw new Error(`${witnessFilename} is required; regenerate witnesses after changing the mutation set`);
const witnessArtifact = readFileSync(witnessPath, "utf8");
const witnesses = JSON.parse(witnessArtifact);
if (witnesses.schemaVersion !== 1 || witnesses.fixtureId !== "authored-planted-the-intercept-20") throw new Error("witnesses.json has incompatible identity metadata");
if (!mutations.every((mutation) => Array.isArray(witnesses.witnesses?.[mutation.id]?.choicePath))) throw new Error("witnesses.json does not cover all mutations");
const bugRecords = mutations.map(({ apply: _apply, phase: _phase, dimensions, knot, upstreamLine, ...mutation }) => ({
  ...mutation,
  description: `${mutation.trigger} ${mutation.effect}`,
  oracle: { kind: "variable-equals", variable: `inkbench_bug_${mutation.id.slice(10, 12)}`, value: true },
  site: { file: `bugs/${_phase}.ink`, knot, upstreamLine },
  dimensions,
}));
const manifest = {
  schemaVersion: 1,
  tier: "authored-planted",
  corpusVersion: "authored-planted-v1",
  source: {
    cleanCorpusManifest: relative(REPO_ROOT, CLEAN_MANIFEST_PATH),
    cleanStoryId: "the-intercept",
    repository: upstreamCase.source.repository,
    commit: upstreamCase.source.commit,
  },
  cases: [{
    id: "the-intercept-20",
    family: upstreamCase.family,
    directory: "the-intercept-20",
    mutationSet: "intercept-diverse-20-v1",
    source: {
      ...upstreamCase.source,
      name: "The Intercept — InkBench 20-bug derivative",
      entrypoint: ENTRYPOINT,
      compileSetup: "Compile the entrypoint with its four local phase includes.",
      licenseFile: "LICENSE-AND-PROVENANCE.md",
      licenseSha256: sha256(provenance),
      upstreamSourceSha256: upstreamCase.files[upstreamCase.source.entrypoint],
      generator: "scripts/build-intercept-20.mjs",
    },
    compiled: {
      file: ARTIFACT,
      sha256: sha256(artifact),
      compiler: "inklecate",
      compilerVersion: "1.2.1",
      arguments: ["-c", "-o", ARTIFACT, ENTRYPOINT],
      provenance: "Generated locally from the deterministic derivative with official inklecate 1.2.1 count-all-visits enabled.",
    },
    files,
    witnesses: { file: witnessFilename, sha256: sha256(witnessArtifact) },
    bugs: bugRecords,
  }],
};
write(join(OUTPUT_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(`built ${mutations.length} mutations in ${relative(REPO_ROOT, CASE_DIRECTORY)}\n`);
process.stdout.write(`artifact sha256 ${manifest.cases[0].compiled.sha256}\n`);
