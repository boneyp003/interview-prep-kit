import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson } from "./json.js";

test("parses clean JSON", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test("strips code fences", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test("ignores prose around the object", () => {
  assert.deepEqual(extractJson('Sure! Here you go:\n{"a":[1,2]}\nHope that helps.'), { a: [1, 2] });
});

test("removes trailing commas", () => {
  assert.deepEqual(extractJson('{"a":1,"b":[1,2,],}'), { a: 1, b: [1, 2] });
});

test("closes a truncated object", () => {
  const value = extractJson('{"a":1,"b":"unterminated');
  assert.deepEqual(value, { a: 1, b: "unterminated" });
});

test("throws when there is no JSON at all", () => {
  assert.throws(() => extractJson("no json here"));
});
