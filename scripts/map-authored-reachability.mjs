#!/usr/bin/env node
import { loadAuthoredFixture } from "../dist/corpus/load.js";
import { InstrumentedController } from "../dist/core/runtime.js";
import { getSearcher } from "../dist/searchers/index.js";
import { writeFileSync } from "node:fs";

function value(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : process.argv[index + 1];
}

const storyId = value("--story", "heresy2");
const algorithm = value("--algorithm", "coverage");
const budget = Number(value("--budget", "10000"));
const searchSeed = Number(value("--seed", "101"));
const storySeed = Number(value("--story-seed", "1"));
const outputPath = value("--out", null);
if (!Number.isSafeInteger(budget) || budget < 1) throw new RangeError("--budget must be a positive safe integer");
if (!Number.isSafeInteger(searchSeed) || searchSeed < 0) throw new RangeError("--seed must be a non-negative safe integer");
if (!Number.isSafeInteger(storySeed) || storySeed < 1) throw new RangeError("--story-seed must be a positive safe integer");

const fixture = loadAuthoredFixture(storyId);
const firstPaths = new Map();
const controller = new InstrumentedController(fixture, budget, storySeed, {
  onTransition(result) {
    const observation = result.after;
    if (!firstPaths.has(observation.location)) {
      firstPaths.set(observation.location, {
        transition: result.transition,
        depth: observation.depth,
        choicePath: observation.choicePath,
        choiceTextPath: observation.choiceTextPath,
      });
    }
  },
});
const root = controller.launch();
firstPaths.set(root.location, {
  transition: 0,
  depth: root.depth,
  choicePath: root.choicePath,
  choiceTextPath: root.choiceTextPath,
});
getSearcher(algorithm).run(controller, searchSeed);

const locations = Object.fromEntries([...firstPaths.entries()].sort(([left], [right]) => left.localeCompare(right)));
const output = `${JSON.stringify({
  storyId,
  algorithm,
  budget,
  searchSeed,
  storySeed,
  transitions: controller.transitions,
  coverage: controller.coverage,
  locations,
}, null, 2)}\n`;
if (outputPath) writeFileSync(outputPath, output);
else process.stdout.write(output);
