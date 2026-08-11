import assert from "node:assert/strict";
import test from "node:test";
import { parseInkJson } from "../dist/core/ink-json.js";

test("portable Ink JSON parsing preserves explicit floats without corrupting decimals", () => {
  const parsed = parseInkJson('{"integer":2,"explicit":100.0,"fraction":0.059091173,"negative":-2.0,"text":",0.0,"}', true);
  assert.deepEqual(parsed, {
    integer: 2,
    explicit: "100.0f",
    fraction: 0.059091173,
    negative: "-2.0f",
    text: ",0.0,",
  });
});

test("native and portable Ink JSON paths agree", () => {
  const source = '{"root":[0.059091173,100.0,{"value":-2.0,"text":"100.0"}],"inkVersion":21}';
  assert.deepEqual(parseInkJson(source), parseInkJson(source, true));
});
