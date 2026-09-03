import { test } from "node:test";
import assert from "node:assert/strict";
import { nextIntervalMs, orderForSession, recordReview, summarisePractice, type PracticeMap } from "./index.js";
import type { Flashcard } from "../schema/kit.js";

const cards: Flashcard[] = [
  { id: "f1", front: "a", back: "a", requirement_ids: ["r1"] },
  { id: "f2", front: "b", back: "b", requirement_ids: ["r1"] },
  { id: "f3", front: "c", back: "c", requirement_ids: ["r2"] },
];

test("interval grows with confidence", () => {
  assert.ok(nextIntervalMs(1) < nextIntervalMs(2));
  assert.ok(nextIntervalMs(4) < nextIntervalMs(5));
});

test("recordReview increments the review count and sets a future due date", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  const first = recordReview(undefined, 3, now);
  assert.equal(first.reviews, 1);
  assert.equal(first.lastConfidence, 3);
  assert.ok(Date.parse(first.dueAt) > now.getTime());
  const second = recordReview(first, 5, now);
  assert.equal(second.reviews, 2);
});

test("session order puts unseen and low-confidence cards first", () => {
  const now = new Date("2026-09-10T00:00:00Z");
  const practice: PracticeMap = {
    f1: recordReview(undefined, 5, new Date("2026-09-09T00:00:00Z")), // confident, not due
    f2: recordReview(undefined, 1, new Date("2026-09-09T00:00:00Z")), // shaky
    // f3 never seen
  };
  const order = orderForSession(cards, practice, now).map((s) => s.card.id);
  assert.deepEqual(order.slice(0, 2).sort(), ["f2", "f3"]); // both rank ahead of the confident f1
  assert.equal(order[2], "f1");
});

test("summary reports practised vs unpractised requirements", () => {
  const now = new Date("2026-09-10T00:00:00Z");
  const practice: PracticeMap = { f1: recordReview(undefined, 4, now) };
  const summary = summarisePractice(cards, practice, now);
  assert.equal(summary.total, 3);
  assert.equal(summary.reviewed, 1);
  assert.deepEqual(summary.practisedRequirementIds, ["r1"]);
  assert.deepEqual(summary.unpractisedRequirementIds, ["r2"]);
});
