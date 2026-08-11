import { BUG_FAMILIES, SCHEMA_VERSION, type BugFamily, type DifficultyCoordinates, type FixtureManifest, type GeneratedFixture } from "../core/types.js";
import { Prng } from "../core/prng.js";

interface BuiltFixture {
  body: string[];
  locations: string[];
  dimensions: DifficultyCoordinates;
  parameters: FixtureManifest["parameters"];
  description: string;
}

function assertInput(family: string, seed: number, difficulty: number): asserts family is BugFamily {
  if (!BUG_FAMILIES.includes(family as BugFamily)) throw new RangeError(`unknown bug family: ${family}`);
  if (!Number.isSafeInteger(seed)) throw new RangeError("fixture seed must be a safe integer");
  if (!Number.isSafeInteger(difficulty) || difficulty < 1 || difficulty > 10) {
    throw new RangeError("difficulty must be an integer from 1 to 10");
  }
}

function choice(label: string, target: string, statements: string[] = []): string[] {
  return [
    `+ [${label}]`,
    ...statements.map((statement) => `    ~ ${statement}`),
    `    -> ${target}`,
  ];
}

function knot(name: string, prose: string, content: string[]): string[] {
  return [`=== ${name} ===`, prose, ...content, ""];
}

function endingKnots(bugId: string): string[] {
  return [
    ...knot("bug", "The planted fault is now observable.", [
      "~ ib_bug = 1",
      `# INKBENCH_BUG:${bugId}`,
      "-> END",
    ]),
    ...knot("safe", "This path ends without triggering the planted fault.", ["-> END"]),
  ];
}

function dims(overrides: Partial<DifficultyCoordinates>): DifficultyCoordinates {
  return {
    depth: 1,
    width: 1,
    stateDimensionality: 1,
    rarity: 1,
    delay: 0,
    revisit: 0,
    deception: 0,
    order: 0,
    ...overrides,
  };
}

function shallowObvious(rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const width = 3 + difficulty;
  const target = rng.integer(width);
  const lines = ["VAR ib_bug = 0", "-> start", ""];
  const choices: string[] = [];
  for (let index = 0; index < width; index += 1) {
    choices.push(...choice(`Obvious option ${index + 1}`, index === target ? "bug" : "safe"));
  }
  lines.push(...knot("start", "A small control fixture offers several obvious exits.", choices), ...endingKnots(bugId));
  return {
    body: lines,
    locations: ["start", "bug", "safe"],
    dimensions: dims({ width, rarity: width }),
    parameters: { width, targetChoice: target },
    description: "A shallow branch directly reaches the planted fault.",
  };
}

function deepCorridor(_rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const depth = 4 + difficulty * 4;
  const lines = ["VAR ib_bug = 0", "-> corridor_0", ""];
  const locations: string[] = [];
  for (let index = 0; index < depth; index += 1) {
    const name = `corridor_${index}`;
    const next = index === depth - 1 ? "bug" : `corridor_${index + 1}`;
    locations.push(name);
    lines.push(...knot(name, "The corridor looks exactly as unpromising as the last stretch.", [
      ...choice("Keep walking", next),
      ...choice("Give up", "safe"),
    ]));
  }
  lines.push(...endingKnots(bugId));
  return {
    body: lines,
    locations: [...locations, "bug", "safe"],
    dimensions: dims({ depth, width: 2, rarity: 2 ** Math.min(depth, 20), delay: depth - 1 }),
    parameters: { depth },
    description: "A fault lies behind a long, low-yield-looking corridor.",
  };
}

function rarePrefix(rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const gates = 2 + difficulty;
  const width = 3 + difficulty;
  const tail = 1 + difficulty;
  const targets = Array.from({ length: gates }, () => rng.integer(width));
  const lines = ["VAR ib_bug = 0", "VAR prefix_ok = 1", "-> gate_0", ""];
  const locations: string[] = [];
  for (let gate = 0; gate < gates; gate += 1) {
    const name = `gate_${gate}`;
    const next = gate === gates - 1 ? "tail_0" : `gate_${gate + 1}`;
    locations.push(name);
    const choices: string[] = [];
    for (let option = 0; option < width; option += 1) {
      choices.push(...choice(
        `Gate ${gate + 1}, mark ${option + 1}`,
        next,
        option === targets[gate] ? [] : ["prefix_ok = 0"],
      ));
    }
    lines.push(...knot(name, "Every mark appears equally ordinary.", choices));
  }
  for (let index = 0; index < tail; index += 1) {
    const name = `tail_${index}`;
    const next = index === tail - 1 ? "prefix_evaluate" : `tail_${index + 1}`;
    locations.push(name);
    lines.push(...knot(name, "Nothing here reveals whether the prefix mattered.", choice("Continue", next)));
  }
  locations.push("prefix_evaluate");
  lines.push(...knot("prefix_evaluate", "The old sequence is finally consulted.", [
    "{ prefix_ok == 1:",
    "    -> bug",
    "- else:",
    "    -> safe",
    "}",
  ]), ...endingKnots(bugId));
  return {
    body: lines,
    locations: [...locations, "bug", "safe"],
    dimensions: dims({ depth: gates + tail + 1, width, stateDimensionality: 1, rarity: width ** gates, delay: tail }),
    parameters: { gates, width, tail, targetChoices: targets },
    description: "Several rare early choices must all match before a delayed fault appears.",
  };
}

function combinationLock(rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const variables = 2 + difficulty;
  const delay = 1 + difficulty;
  const targets = Array.from({ length: variables }, () => rng.integer(2));
  const lines = ["VAR ib_bug = 0", ...Array.from({ length: variables }, (_, i) => `VAR lock_${i} = 0`), "-> lock_0_set", ""];
  const locations: string[] = [];
  for (let index = 0; index < variables; index += 1) {
    const name = `lock_${index}_set`;
    const next = index === variables - 1 ? "lock_delay_0" : `lock_${index + 1}_set`;
    locations.push(name);
    lines.push(...knot(name, "An unrelated preference is recorded.", [
      ...choice("Choose low", next, [`lock_${index} = 0`]),
      ...choice("Choose high", next, [`lock_${index} = 1`]),
    ]));
  }
  for (let index = 0; index < delay; index += 1) {
    const name = `lock_delay_${index}`;
    const next = index === delay - 1 ? "lock_evaluate" : `lock_delay_${index + 1}`;
    locations.push(name);
    lines.push(...knot(name, "The earlier preferences appear irrelevant.", choice("Continue", next)));
  }
  locations.push("lock_evaluate");
  const condition = targets.map((target, i) => `lock_${i} == ${target}`).join(" && ");
  lines.push(...knot("lock_evaluate", "The independent settings form a lock.", [
    `{ ${condition}:`,
    "    -> bug",
    "- else:",
    "    -> safe",
    "}",
  ]), ...endingKnots(bugId));
  return {
    body: lines,
    locations: [...locations, "bug", "safe"],
    dimensions: dims({ depth: variables + delay + 1, width: 2, stateDimensionality: variables, rarity: 2 ** variables, delay }),
    parameters: { variables, delay, targetValues: targets },
    description: "Independent earlier decisions must form one rare variable combination.",
  };
}

function loopCount(_rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const triggerCount = 2 + difficulty * 2;
  const lines = [
    "VAR ib_bug = 0",
    "VAR loop_visits = 0",
    "-> loop_room",
    "",
    ...knot("loop_room", "The room looks familiar.", [
      "~ loop_visits = loop_visits + 1",
      ...choice("Search again", "loop_room"),
      ...choice("Leave", "loop_evaluate"),
    ]),
    ...knot("loop_evaluate", "The number of searches is checked.", [
      `{ loop_visits == ${triggerCount}:`,
      "    -> bug",
      "- else:",
      "    -> safe",
      "}",
    ]),
    ...endingKnots(bugId),
  ];
  return {
    body: lines,
    locations: ["loop_room", "loop_evaluate", "bug", "safe"],
    dimensions: dims({ depth: triggerCount + 1, width: 2, stateDimensionality: 1, rarity: 2 ** triggerCount, revisit: triggerCount - 1 }),
    parameters: { triggerCount },
    description: "The fault requires leaving a loop after exactly the planted visit count.",
  };
}

function revisitAfterMutation(_rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const mutationDistance = 1 + difficulty * 2;
  const lines = ["VAR ib_bug = 0", "VAR has_mutation = 0", "VAR hub_visits = 0", "-> hub", ""];
  const locations = ["hub", "forest"];
  lines.push(...knot("hub", "Old territory may have changed.", [
    "~ hub_visits = hub_visits + 1",
    "+ { has_mutation == 0 } [Explore the forest]",
    "    -> forest",
    "+ { has_mutation == 1 } [Open the newly revealed door]",
    "    -> bug",
    ...choice("Wander the courtyard", "courtyard"),
    ...choice("Leave", "safe"),
  ]));
  lines.push(...knot("forest", "A distant cave may alter the hub.", choice("Enter the cave", "mutation_0")));
  for (let index = 0; index < mutationDistance; index += 1) {
    const name = `mutation_${index}`;
    const final = index === mutationDistance - 1;
    locations.push(name);
    lines.push(...knot(name, "The mutation remains out of sight of the hub.", choice(
      "Continue",
      final ? "hub" : `mutation_${index + 1}`,
      final ? ["has_mutation = 1"] : [],
    )));
  }
  locations.push("courtyard");
  lines.push(...knot("courtyard", "The courtyard changes nothing.", choice("Return to the hub", "hub")), ...endingKnots(bugId));
  return {
    body: lines,
    locations: [...locations, "bug", "safe"],
    dimensions: dims({ depth: mutationDistance + 3, width: 4, stateDimensionality: 2, rarity: 4 * mutationDistance, delay: mutationDistance, revisit: 1 }),
    parameters: { mutationDistance },
    description: "A previously visited hub reveals the fault only after a distant mutation.",
  };
}

function noveltyHoneypot(_rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const casinoWidth = 3 + difficulty;
  const casinoDepth = 2 + difficulty;
  const entrances = 1 + difficulty;
  const roadDepth = 3 + difficulty * 2;
  const lines = ["VAR ib_bug = 0", "VAR casino_step = 0", "VAR casino_signature = 0", "-> start", ""];
  const startChoices = [...choice("Take the boring road", "road_0")];
  for (let index = 0; index < entrances; index += 1) {
    startChoices.push(...choice(`Enter casino door ${index + 1}`, "casino", [`casino_signature = ${index + 1}`]));
  }
  lines.push(...knot("start", "One quiet road competes with a dazzling casino.", startChoices));
  const locations = ["start"];
  for (let index = 0; index < roadDepth; index += 1) {
    const name = `road_${index}`;
    locations.push(name);
    lines.push(...knot(name, "The road offers no novelty at all.", choice("Keep walking", index === roadDepth - 1 ? "bug" : `road_${index + 1}`)));
  }
  locations.push("casino");
  const casinoChoices: string[] = [];
  for (let index = 0; index < casinoWidth; index += 1) {
    casinoChoices.push(...choice(`Play table ${index + 1}`, "casino", [
      "casino_step = casino_step + 1",
      `casino_signature = casino_signature * ${casinoWidth + 1} + ${index + 1}`,
    ]));
  }
  lines.push(...knot("casino", "Every table advertises another glittering variation.", [
    `{ casino_step >= ${casinoDepth}:`,
    "    -> casino_safe",
    "}",
    ...casinoChoices,
  ]));
  locations.push("casino_safe");
  lines.push(...knot("casino_safe", "The casino's variety was harmless.", ["-> safe"]), ...endingKnots(bugId));
  return {
    body: lines,
    locations: [...locations, "bug", "safe"],
    dimensions: dims({ depth: roadDepth + 1, width: casinoWidth, stateDimensionality: 2, rarity: entrances + 1, deception: casinoWidth ** casinoDepth }),
    parameters: { casinoWidth, casinoDepth, entrances, roadDepth },
    description: "A large high-novelty casino distracts from one boring route to the fault.",
  };
}

function falseNovelty(_rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const noiseWidth = 2 + difficulty;
  const roadDepth = 3 + difficulty * 2;
  const lines = ["VAR ib_bug = 0", "VAR irrelevant_counter = 0", "-> start", ""];
  lines.push(...knot("start", "A quiet road sits beside a machine with endlessly changing numbers.", [
    ...choice("Take the quiet road", "quiet_0"),
    ...choice("Inspect the changing machine", "noise"),
  ]));
  const locations = ["start"];
  for (let index = 0; index < roadDepth; index += 1) {
    const name = `quiet_${index}`;
    locations.push(name);
    lines.push(...knot(name, "Nothing changes on the quiet road.", choice("Continue", index === roadDepth - 1 ? "bug" : `quiet_${index + 1}`)));
  }
  const noiseChoices: string[] = [];
  for (let index = 0; index < noiseWidth; index += 1) {
    noiseChoices.push(...choice(`Turn dial ${index + 1}`, "noise", [`irrelevant_counter = irrelevant_counter + ${index + 1}`]));
  }
  noiseChoices.push(...choice("Stop watching", "safe"));
  locations.push("noise");
  lines.push(...knot("noise", "The counter changes, but it controls no downstream behavior.", noiseChoices), ...endingKnots(bugId));
  return {
    body: lines,
    locations: [...locations, "bug", "safe"],
    dimensions: dims({ depth: roadDepth + 1, width: noiseWidth + 1, stateDimensionality: 1, rarity: 2, deception: noiseWidth * roadDepth }),
    parameters: { noiseWidth, roadDepth },
    description: "An irrelevant changing variable creates unbounded false state novelty.",
  };
}

function delayedConsequence(rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const width = 3 + difficulty;
  const delay = 3 + difficulty * 4;
  const target = rng.integer(width);
  const lines = ["VAR ib_bug = 0", "VAR old_cause = 0", "-> cause", ""];
  const causeChoices: string[] = [];
  for (let index = 0; index < width; index += 1) {
    causeChoices.push(...choice(`Choose keepsake ${index + 1}`, "delay_0", index === target ? ["old_cause = 1"] : []));
  }
  lines.push(...knot("cause", "One ordinary early choice matters much later.", causeChoices));
  const locations = ["cause"];
  for (let index = 0; index < delay; index += 1) {
    const name = `delay_${index}`;
    const next = index === delay - 1 ? "delayed_evaluate" : `delay_${index + 1}`;
    locations.push(name);
    lines.push(...knot(name, "The old choice produces no visible signal yet.", [
      ...choice("Continue on the left", next),
      ...choice("Continue on the right", next),
    ]));
  }
  locations.push("delayed_evaluate");
  lines.push(...knot("delayed_evaluate", "The forgotten choice finally has a consequence.", [
    "{ old_cause == 1:",
    "    -> bug",
    "- else:",
    "    -> safe",
    "}",
  ]), ...endingKnots(bugId));
  return {
    body: lines,
    locations: [...locations, "bug", "safe"],
    dimensions: dims({ depth: delay + 2, width, stateDimensionality: 1, rarity: width, delay }),
    parameters: { width, delay, targetChoice: target },
    description: "A rare early cause is silent across a long delay before the fault.",
  };
}

function orderDependent(rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const locationsCount = Math.min(3 + Math.floor(difficulty / 2), 6);
  const permutation = rng.shuffle(Array.from({ length: locationsCount }, (_, i) => i + 1));
  const targetCode = Number(permutation.join(""));
  const lines = [
    "VAR ib_bug = 0",
    "VAR order_code = 0",
    "VAR visited_total = 0",
    ...Array.from({ length: locationsCount }, (_, i) => `VAR visited_${i} = 0`),
    "-> order_hub",
    "",
  ];
  const hub: string[] = [];
  for (let index = 0; index < locationsCount; index += 1) {
    hub.push(
      `+ { visited_${index} == 0 } [Visit location ${index + 1}]`,
      `    ~ visited_${index} = 1`,
      "    ~ visited_total = visited_total + 1",
      `    ~ order_code = order_code * 10 + ${index + 1}`,
      `    -> order_place_${index}`,
    );
  }
  hub.push(
    `+ { visited_total == ${locationsCount} } [Finish the route]`,
    "    -> order_evaluate",
  );
  lines.push(...knot("order_hub", "All locations are common; only their order is rare.", hub));
  const locations = ["order_hub"];
  for (let index = 0; index < locationsCount; index += 1) {
    const name = `order_place_${index}`;
    locations.push(name);
    lines.push(...knot(name, `Location ${index + 1} is ordinary.`, choice("Return to the route", "order_hub")));
  }
  locations.push("order_evaluate");
  lines.push(...knot("order_evaluate", "The route order is checked.", [
    `{ order_code == ${targetCode}:`,
    "    -> bug",
    "- else:",
    "    -> safe",
    "}",
  ]), ...endingKnots(bugId));
  const permutations = Array.from({ length: locationsCount }, (_, i) => i + 1).reduce((product, value) => product * value, 1);
  return {
    body: lines,
    locations: [...locations, "bug", "safe"],
    dimensions: dims({ depth: locationsCount * 2 + 1, width: locationsCount, stateDimensionality: locationsCount + 2, rarity: permutations, revisit: locationsCount, order: permutations }),
    parameters: { locations: locationsCount, targetOrder: permutation, targetCode },
    description: "Every location is covered on every path, but one visit order triggers the fault.",
  };
}

function compoundNeedle(rng: Prng, difficulty: number, bugId: string): BuiltFixture {
  const prefixWidth = 3 + Math.floor(difficulty / 2);
  const keyTarget = rng.integer(prefixWidth);
  const allyTarget = rng.integer(prefixWidth);
  const order = rng.shuffle([1, 2, 3]);
  const orderCode = Number(order.join(""));
  const ritualCount = 2 + difficulty;
  const lines = [
    "VAR ib_bug = 0",
    "VAR has_key = 0",
    "VAR has_ally = 0",
    "VAR needle_order = 0",
    "VAR needle_visited = 0",
    "VAR needle_0 = 0",
    "VAR needle_1 = 0",
    "VAR needle_2 = 0",
    "VAR ritual_count = 0",
    "-> needle_key",
    "",
  ];
  const keyChoices: string[] = [];
  const allyChoices: string[] = [];
  for (let index = 0; index < prefixWidth; index += 1) {
    keyChoices.push(...choice(`Select object ${index + 1}`, "needle_ally", index === keyTarget ? ["has_key = 1"] : []));
    allyChoices.push(...choice(`Trust person ${index + 1}`, "needle_hub", index === allyTarget ? ["has_ally = 1"] : []));
  }
  lines.push(
    ...knot("needle_key", "One unrelated object will matter.", keyChoices),
    ...knot("needle_ally", "One unrelated alliance will matter.", allyChoices),
  );
  const hub: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    hub.push(
      `+ { needle_${index} == 0 } [Visit district ${index + 1}]`,
      `    ~ needle_${index} = 1`,
      "    ~ needle_visited = needle_visited + 1",
      `    ~ needle_order = needle_order * 10 + ${index + 1}`,
      `    -> needle_place_${index}`,
    );
  }
  hub.push(
    "+ { needle_visited == 3 } [Begin the ritual]",
    "    -> ritual",
  );
  lines.push(...knot("needle_hub", "The three districts may be visited in any order.", hub));
  for (let index = 0; index < 3; index += 1) {
    lines.push(...knot(`needle_place_${index}`, "The district appears unrelated to the object and ally.", choice("Return", "needle_hub")));
  }
  lines.push(
    ...knot("ritual", "The final repetition count is another independent condition.", [
      "~ ritual_count = ritual_count + 1",
      ...choice("Repeat", "ritual"),
      ...choice("Resolve", "needle_evaluate"),
    ]),
    ...knot("needle_evaluate", "All unrelated conditions meet here.", [
      `{ has_key == 1 && has_ally == 1 && needle_order == ${orderCode} && ritual_count == ${ritualCount}:`,
      "    -> bug",
      "- else:",
      "    -> safe",
      "}",
    ]),
    ...endingKnots(bugId),
  );
  return {
    body: lines,
    locations: ["needle_key", "needle_ally", "needle_hub", "needle_place_0", "needle_place_1", "needle_place_2", "ritual", "needle_evaluate", "bug", "safe"],
    dimensions: dims({ depth: 10 + ritualCount, width: Math.max(prefixWidth, 3), stateDimensionality: 8, rarity: prefixWidth * prefixWidth * 6 * 2 ** ritualCount, delay: 8, revisit: ritualCount + 3, deception: 3, order: 6 }),
    parameters: { prefixWidth, keyTarget, allyTarget, targetOrder: order, targetOrderCode: orderCode, ritualCount },
    description: "Several unrelated prefix, order, state, and loop-count conditions form one compound needle.",
  };
}

export function generateFixture(family: BugFamily, seed: number, difficulty = 1): GeneratedFixture {
  assertInput(family, seed, difficulty);
  const fixtureId = `${family}-d${difficulty}-s${seed}`;
  const bugId = `${fixtureId}:bug-1`;
  const rng = new Prng(seed);
  const built = family === "shallow-obvious" ? shallowObvious(rng, difficulty, bugId)
    : family === "deep-corridor" ? deepCorridor(rng, difficulty, bugId)
      : family === "rare-prefix" ? rarePrefix(rng, difficulty, bugId)
        : family === "combination-lock" ? combinationLock(rng, difficulty, bugId)
          : family === "loop-count" ? loopCount(rng, difficulty, bugId)
            : family === "revisit-after-mutation" ? revisitAfterMutation(rng, difficulty, bugId)
              : family === "novelty-honeypot" ? noveltyHoneypot(rng, difficulty, bugId)
                : family === "false-novelty" ? falseNovelty(rng, difficulty, bugId)
                  : family === "delayed-consequence" ? delayedConsequence(rng, difficulty, bugId)
                    : family === "order-dependent" ? orderDependent(rng, difficulty, bugId)
                      : compoundNeedle(rng, difficulty, bugId);
  const manifest: FixtureManifest = {
    schemaVersion: SCHEMA_VERSION,
    generatorVersion: "0.1.0",
    fixtureId,
    family,
    seed,
    difficulty,
    dimensions: built.dimensions,
    parameters: built.parameters,
    locations: [...new Set(built.locations)],
    bugs: [{
      id: bugId,
      family,
      description: built.description,
      oracle: { kind: "variable-equals", variable: "ib_bug", value: 1 },
    }],
  };
  const source = [
    `// Generated by InkBench 0.1.0: ${fixtureId}`,
    "// Search strategies must not receive the fixture manifest or generation parameters.",
    ...built.body,
  ].join("\n").trimEnd() + "\n";
  return { source, manifest };
}
