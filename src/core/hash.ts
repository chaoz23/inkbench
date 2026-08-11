import { createHash } from "node:crypto";

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function hash(value: unknown, length = 16): string {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex").slice(0, length);
}

export function variableValueTokens(variables: Record<string, unknown>): string[] {
  return Object.entries(variables)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${stableJson(value)}`);
}
