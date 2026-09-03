import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseWeakSpots } from "./weak-spots.js";
import { recordReview, type PracticeMap } from "../practice/index.js";
import type { Kit } from "../schema/kit.js";

function kit(): Kit {
  return {
    source: { company: "C", company_url: "u", role: "R", location: "", jd_chars: 1, pages_used: [], researched_at: "2026-09-01T00:00:00Z" },
    company_brief: { summary: "", what_they_do: "", sources: [] },
    role: {
      title: "R", seniority: "", responsibilities: [],
      requirements: [
        { id: "r1", text: "React", kind: "technical", priority: "must" },
        { id: "r2", text: "GraphQL", kind: "technical", priority: "must" },
        { id: "r3", text: "Mentoring", kind: "behavioural", priority: "nice" },
      ],
    },
    questions: [
      { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "?", answer_outline: "...", difficulty: 2 },
      { id: "q2", requirement_ids: ["r1"], category: "technical", prompt: "?", answer_outline: "...", difficulty: 2 },
      { id: "q3", requirement_ids: ["r3"], category: "behavioural", prompt: "?", answer_outline: "...", difficulty: 1 },
      // r2 has no questions
    ],
    flashcards: [
      { id: "f1", front: "a", back: "b", requirement_ids: ["r1"] },
      { id: "f3", front: "a", back: "b", requirement_ids: ["r3"] },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "", question_ids: ["q1", "q2"], minutes: 50 },
        { day: 2, focus: "", question_ids: ["q3"], minutes: 15 },
      ],
    },
    coverage: { uncovered_requirement_ids: ["r2"], passes: 2 },
  };
}

test("an uncovered must-have requirement ranks as the top weak spot", () => {
  const spots = analyseWeakSpots(kit(), {});
  assert.equal(spots[0]!.requirementId, "r2");
  assert.ok(spots[0]!.reasons.some((r) => /no questions/.test(r)));
});

test("low practice confidence raises a requirement's score", () => {
  const practice: PracticeMap = { f1: recordReview(undefined, 1, new Date("2026-09-01T00:00:00Z")) };
  const spots = analyseWeakSpots(kit(), practice);
  const r1 = spots.find((s) => s.requirementId === "r1")!;
  assert.equal(r1.averageConfidence, 1);
  assert.ok(r1.reasons.some((r) => /low practice confidence/.test(r)));
  assert.ok(r1.score > 0);
});

test("a well-covered, well-practised requirement scores ~0", () => {
  const practice: PracticeMap = { f1: recordReview(undefined, 5, new Date("2026-09-01T00:00:00Z")) };
  const spots = analyseWeakSpots(kit(), practice);
  assert.equal(spots.find((s) => s.requirementId === "r1")!.score, 0);
});

test("scheduledDays reports where each requirement appears", () => {
  const spots = analyseWeakSpots(kit(), {});
  assert.deepEqual(spots.find((s) => s.requirementId === "r1")!.scheduledDays, [1]);
  assert.deepEqual(spots.find((s) => s.requirementId === "r3")!.scheduledDays, [2]);
});
