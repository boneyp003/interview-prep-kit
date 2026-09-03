import { test } from "node:test";
import assert from "node:assert/strict";
import { IdAllocator } from "./ids.js";

test("allocates sequential ids per prefix", () => {
  const a = new IdAllocator();
  assert.equal(a.next("q"), "q1");
  assert.equal(a.next("q"), "q2");
  assert.equal(a.next("r"), "r1");
});

test("never collides with pre-existing ids", () => {
  const a = new IdAllocator(["q1", "q2", "q7", "r3"]);
  assert.equal(a.next("q"), "q8");
  assert.equal(a.next("r"), "r4");
});

test("ignores ids that do not match the prefix+number shape", () => {
  const a = new IdAllocator(["custom-slug", "q4"]);
  assert.equal(a.next("q"), "q5");
});
