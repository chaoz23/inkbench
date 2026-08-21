import { hash } from "../core/hash.js";
import { SCHEMA_VERSION, type BugFamily, type GeneratedFixture, type PlantedBug } from "../core/types.js";
import { Prng } from "../core/prng.js";
import { assertFixtureSeedPartition } from "../fixtures/equivalence.js";

export const LONGITUDINAL_REVISION_SCHEMA_VERSION = 1 as const;

export type RevisionEditClass =
  | "baseline"
  | "text-only"
  | "side-branch"
  | "threshold-change"
  | "delayed-bug-introduction"
  | "choice-reorder"
  | "rare-history"
  | "bug-fix"
  | "revisit-bug-introduction"
  | "local-refactor"
  | "broad-refactor-negative-control"
  | "bug-reintroduction"
  | "maintenance";

export interface LongitudinalRevision {
  schemaVersion: typeof LONGITUDINAL_REVISION_SCHEMA_VERSION;
  sequenceId: string;
  sequenceSeed: number;
  partition: "development" | "validation" | "evaluation";
  revision: number;
  revisionId: string;
  parentRevisionId: string | null;
  sourceSha256: string;
  editClass: RevisionEditClass;
  activeBugIds: string[];
  fixture: GeneratedFixture;
}

const EDIT_CLASSES: readonly RevisionEditClass[] = [
  "baseline",
  "text-only",
  "side-branch",
  "threshold-change",
  "delayed-bug-introduction",
  "choice-reorder",
  "rare-history",
  "bug-fix",
  "revisit-bug-introduction",
  "local-refactor",
  "broad-refactor-negative-control",
  "bug-reintroduction",
];

function endpointNames(seed: number, revision: number): { target: string; control: string; targetFirst: boolean } {
  const first = `terminal_${hash({ seed, revision, endpoint: 0 }, 10)}`;
  const second = `terminal_${hash({ seed, revision, endpoint: 1 }, 10)}`;
  const targetFirst = Number.parseInt(hash({ seed, revision, assignment: 1 }, 2), 16) % 2 === 0;
  return { target: targetFirst ? first : second, control: targetFirst ? second : first, targetFirst };
}

function activeBugs(sequenceId: string, revision: number): Array<{ id: string; family: BugFamily }> {
  if (revision >= 4 && revision <= 6) return [{ id: `${sequenceId}:regression-a`, family: "delayed-consequence" }];
  if (revision >= 8 && revision <= 10) return [{ id: `${sequenceId}:regression-b`, family: "revisit-after-mutation" }];
  if (revision === 11) return [{ id: `${sequenceId}:regression-a`, family: "delayed-consequence" }];
  if (revision >= 12 && (revision - 12) % 6 === 3) {
    return [{ id: `${sequenceId}:maintenance-${Math.floor((revision - 12) / 6)}`, family: "delayed-consequence" }];
  }
  return [];
}

function editClassFor(revision: number): RevisionEditClass {
  if (revision < EDIT_CLASSES.length) return EDIT_CLASSES[revision]!;
  const phase = (revision - 12) % 6;
  if (phase === 0) return "text-only";
  if (phase === 1) return "side-branch";
  if (phase === 2) return "choice-reorder";
  if (phase === 3) return "delayed-bug-introduction";
  if (phase === 4) return "bug-fix";
  if (phase === 5) return "broad-refactor-negative-control";
  return "maintenance";
}

function sourceFor(seed: number, revision: number): {
  source: string;
  locations: string[];
  active: Array<{ id: string; family: BugFamily }>;
  corridorLength: number;
  keepsakeCount: number;
  preferredKeepsake: number;
} {
  const sequenceId = `longitudinal-s${seed}`;
  const active = activeBugs(sequenceId, revision);
  const rng = new Prng(seed);
  const keepsakeCount = 3 + rng.integer(3);
  const preferredKeepsake = rng.integer(keepsakeCount);
  const baseCorridorLength = 3 + rng.integer(3);
  const maintenancePhase = revision >= 12 ? (revision - 12) % 6 : -1;
  const broad = revision === 10 || maintenancePhase === 5;
  const start = broad ? "entry_refactored" : "start";
  const hub = broad ? "junction_refactored" : "hub";
  const side = broad ? "archive_refactored" : "side_room";
  const evaluate = broad ? "resolution_refactored" : "evaluate";
  const corridorLength = baseCorridorLength + (revision >= 9 ? 2 : revision >= 3 ? 1 : 0);
  const endpoints = endpointNames(seed, revision);
  const locations = [start, hub, evaluate, endpoints.target, endpoints.control, ...Array.from({ length: corridorLength }, (_, index) => `corridor_${index}`)];
  if (revision >= 2) locations.push(side);
  const lines = [
    "VAR ib_regression = 0",
    "VAR memory = 0",
    "VAR hub_visits = 0",
    "VAR keepsake = 0",
    "VAR side_visited = 0",
    `-> ${start}`,
    "",
    `=== ${start} ===`,
    revision === 1 || maintenancePhase === 0 ? `The archive entrance has freshly edited prose for revision ${revision}.` : "The archive entrance is quiet.",
  ];
  const startChoiceBlocks = Array.from({ length: keepsakeCount }, (_, index) => [
    `+ [Choose keepsake ${index + 1}]`,
    `    ~ keepsake = ${index}`,
    ...(index === preferredKeepsake ? ["    ~ memory = memory + 1"] : []),
    `    -> ${hub}`,
  ]);
  lines.push(...(revision === 5 || maintenancePhase === 2 ? startChoiceBlocks.reverse() : startChoiceBlocks).flat());
  lines.push("", `=== ${hub} ===`, "~ hub_visits = hub_visits + 1", "Routes leave the junction.");
  if (revision >= 2) {
    lines.push(
      "+ { side_visited == 0 } [Visit the side archive]",
      "    ~ side_visited = 1",
      "    ~ memory = memory + 1",
      `    -> ${side}`,
    );
  }
  lines.push("+ [Take the main corridor]", "    -> corridor_0", "");
  if (revision >= 2) {
    lines.push(`=== ${side} ===`, "The side archive looks useful but is not itself an oracle.", "+ [Return to the junction]", `    -> ${hub}`, "");
  }
  for (let index = 0; index < corridorLength; index += 1) {
    lines.push(
      `=== corridor_${index} ===`,
      revision >= 9 ? "A locally refactored corridor continues." : "An unchanged corridor continues.",
      "+ [Continue]",
      `    -> ${index === corridorLength - 1 ? evaluate : `corridor_${index + 1}`}`,
      "",
    );
  }
  let condition = "false";
  if (maintenancePhase === 3) condition = `keepsake == ${preferredKeepsake} && memory >= 1`;
  else if (revision === 4 || revision === 5) condition = `keepsake == ${preferredKeepsake}`;
  else if (revision === 6) condition = `keepsake == ${preferredKeepsake} && memory >= 2`;
  else if (revision >= 8 && revision <= 10) condition = "memory >= 2 && hub_visits >= 2";
  else if (revision === 11) condition = `keepsake == ${preferredKeepsake} && memory >= 1`;
  lines.push(
    `=== ${evaluate} ===`,
    "The ordinary route resolves.",
    `{ ${condition}:`,
    "    ~ ib_regression = 1",
    `    -> ${endpoints.target}`,
    "- else:",
    `    -> ${endpoints.control}`,
    "}",
    "",
  );
  const endpointBlocks = [
    [`=== ${endpoints.target} ===`, `Outcome ${hash({ seed, revision, kind: "a" }, 12)}.`, "-> END", ""],
    [`=== ${endpoints.control} ===`, `Outcome ${hash({ seed, revision, kind: "b" }, 12)}.`, "-> END", ""],
  ];
  lines.push(...(endpoints.targetFirst ? endpointBlocks : endpointBlocks.reverse()).flat());
  return { source: `${lines.join("\n").trimEnd()}\n`, locations, active, corridorLength, keepsakeCount, preferredKeepsake };
}

export function generateRevisionSequence(
  seed: number,
  partition: "development" | "validation" | "evaluation" = "development",
  revisions = 12,
): LongitudinalRevision[] {
  if (!Number.isSafeInteger(revisions) || revisions < 1 || revisions > 30) {
    throw new RangeError("revisions must be 1..30");
  }
  assertFixtureSeedPartition([seed], partition);
  const sequenceId = `longitudinal-s${seed}`;
  const output: LongitudinalRevision[] = [];
  let parentRevisionId: string | null = null;
  for (let revision = 0; revision < revisions; revision += 1) {
    const built = sourceFor(seed, revision);
    const sourceSha256 = hash(built.source, 64);
    const editClass = editClassFor(revision);
    const revisionId = hash({ sequenceId, revision, parentRevisionId, sourceSha256, editClass }, 32);
    const bugs: PlantedBug[] = built.active.map((bug) => ({
      id: bug.id,
      family: bug.family,
      description: "Private longitudinal regression oracle.",
      oracle: { kind: "variable-equals", variable: "ib_regression", value: 1 },
    }));
    const fixture: GeneratedFixture = {
      tier: "generated-planted",
      source: built.source,
      manifest: {
        schemaVersion: SCHEMA_VERSION,
        generatorVersion: "longitudinal-v1",
        fixtureId: `${sequenceId}-r${revision}`,
        family: built.active[0]?.family ?? "delayed-consequence",
        seed,
        difficulty: 1,
        dimensions: {
          depth: built.corridorLength + 3,
          width: built.keepsakeCount + (revision >= 2 ? 1 : 0),
          stateDimensionality: 4,
          rarity: revision === 6 ? 9 : revision >= 8 && revision <= 10 ? 6 : 3,
          delay: revision >= 4 ? 4 : 0,
          revisit: revision >= 8 && revision <= 10 ? 2 : 0,
          deception: revision >= 2 ? 2 : 0,
          order: revision === 5 ? 3 : 0,
        },
        parameters: {
          sequenceId,
          revision,
          editClass,
          partition,
          activeBugIds: bugs.map((bug) => bug.id),
          corridorLength: built.corridorLength,
          keepsakeCount: built.keepsakeCount,
          preferredKeepsake: built.preferredKeepsake,
        },
        locations: built.locations,
        bugs,
      },
    };
    output.push({
      schemaVersion: LONGITUDINAL_REVISION_SCHEMA_VERSION,
      sequenceId,
      sequenceSeed: seed,
      partition,
      revision,
      revisionId,
      parentRevisionId,
      sourceSha256,
      editClass,
      activeBugIds: bugs.map((bug) => bug.id),
      fixture,
    });
    parentRevisionId = revisionId;
  }
  return output;
}
