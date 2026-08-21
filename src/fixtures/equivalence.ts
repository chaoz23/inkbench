import { hash } from "../core/hash.js";
import type { BugFamily, GeneratedFixture } from "../core/types.js";
import { generateFixture } from "./generate.js";

/**
 * Reduce generated Ink to a decision-structure skeleton. Identifiers, prose,
 * numeric targets, and private instrumentation are deliberately erased while
 * control-flow punctuation and statement classes remain. This is an audit
 * signature, not a semantic proof of graph isomorphism.
 */
export function fixtureTopologyFingerprint(source: string): string {
  const identifiers = new Map<string, string>();
  let nextIdentifier = 0;
  const normalized = source
    .split(/\r?\n/)
    .map((raw) => raw.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("# INKBENCH"))
    .map((line) => {
      if (!/^(?:VAR\b|===|=|\+|\*|~|->|\{|\-|END\b)/.test(line)) return "PROSE";
      return line
        .replace(/\[[^\]]*\]/g, "[CHOICE]")
        .replace(/"(?:[^"\\]|\\.)*"/g, "STRING")
        .replace(/\b\d+(?:\.\d+)?\b/g, "NUMBER")
        .replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (name) => {
          if (["VAR", "END", "else", "true", "false", "not", "or", "and"].includes(name)) return name;
          let token = identifiers.get(name);
          if (!token) {
            token = `ID${nextIdentifier++}`;
            identifiers.set(name, token);
          }
          return token;
        });
    });
  return hash(normalized, 64);
}

export interface FixtureEquivalenceGroup {
  topologyFingerprint: string;
  seeds: number[];
  fixtureIds: string[];
}

export interface FixtureEquivalenceAudit {
  schemaVersion: 1;
  family: BugFamily;
  difficulty: number;
  fixtureSeeds: number[];
  uniqueTopologies: number;
  groups: FixtureEquivalenceGroup[];
}

export function auditFixtureEquivalence(family: BugFamily, seeds: number[], difficulty: number): FixtureEquivalenceAudit {
  const groups = new Map<string, GeneratedFixture[]>();
  for (const seed of seeds) {
    const fixture = generateFixture(family, seed, difficulty);
    const fingerprint = fixtureTopologyFingerprint(fixture.source);
    const values = groups.get(fingerprint) ?? [];
    values.push(fixture);
    groups.set(fingerprint, values);
  }
  return {
    schemaVersion: 1,
    family,
    difficulty,
    fixtureSeeds: [...seeds],
    uniqueTopologies: groups.size,
    groups: [...groups.entries()].map(([topologyFingerprint, fixtures]) => ({
      topologyFingerprint,
      seeds: fixtures.map((fixture) => fixture.manifest.seed),
      fixtureIds: fixtures.map((fixture) => fixture.manifest.fixtureId),
    })).sort((left, right) => left.topologyFingerprint.localeCompare(right.topologyFingerprint)),
  };
}

export function assertFixtureSeedPartition(
  seeds: number[],
  partition: "development" | "validation" | "evaluation" | undefined,
): void {
  if (!partition) return;
  const accepted = partition === "development"
    ? (seed: number) => seed >= 1 && seed <= 99
    : partition === "validation"
      ? (seed: number) => seed >= 101 && seed <= 199
      : (seed: number) => seed >= 201 && seed <= 999_999;
  const invalid = seeds.filter((seed) => !accepted(seed));
  if (invalid.length > 0) {
    const ranges = { development: "1..99", validation: "101..199", evaluation: "201..999999" };
    throw new RangeError(`${partition} fixture seeds must be in ${ranges[partition]}; received ${invalid.join(", ")}`);
  }
}
