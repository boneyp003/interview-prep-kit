import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generatedState,
  initialItemState,
  isProtected,
  reconcileScheduleQuestionIds,
  regenerateQuestionCategory,
  userState,
} from "./state.js";
import type { Question } from "../schema/kit.js";

const q = (id: string, category: Question["category"], text = "?"): Question => ({
  id,
  requirement_ids: ["r1"],
  category,
  prompt: text,
  answer_outline: "...",
  difficulty: 2,
});

test("isProtected keeps user-authored, edited, pinned, and unknown items", () => {
  assert.equal(isProtected(userState()), true);
  assert.equal(isProtected({ ...generatedState(), edited: true }), true);
  assert.equal(isProtected({ ...generatedState(), pinned: true }), true);
  assert.equal(isProtected(generatedState()), false);
  assert.equal(isProtected(undefined), true);
});

test("regenerating a category drops untouched generated questions and keeps the rest", () => {
  const existing = [
    q("q1", "technical", "generated, untouched"),
    q("q2", "technical", "generated, edited by user"),
    q("q3", "technical", "user wrote this"),
    q("q4", "behavioural", "different category"),
  ];
  const itemState = initialItemState({ questions: existing, flashcards: [] });
  itemState.q2 = { ...itemState.q2!, edited: true };
  itemState.q3 = userState();

  const result = regenerateQuestionCategory({
    existing,
    itemState,
    category: "technical",
    fresh: [
      { requirement_ids: ["r1"], category: "technical", prompt: "fresh 1", answer_outline: "...", difficulty: 2 },
      { requirement_ids: ["r1"], category: "technical", prompt: "fresh 2", answer_outline: "...", difficulty: 3 },
    ],
  });

  const ids = result.questions.map((x) => x.id);
  assert.ok(!ids.includes("q1"), "untouched generated q1 should be dropped");
  assert.ok(ids.includes("q2"), "edited q2 kept");
  assert.ok(ids.includes("q3"), "user q3 kept");
  assert.ok(ids.includes("q4"), "other-category q4 untouched");
  assert.deepEqual(result.removedIds, ["q1"]);
  assert.equal(result.addedIds.length, 2);
  // new ids don't collide
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(result.addedIds.every((id) => result.itemState[id]?.origin === "generated"));
});

test("a hand-edited question survives regeneration of its category (Section 6)", () => {
  const existing = [q("q1", "technical", "user's careful rewrite")];
  const itemState = initialItemState({ questions: existing, flashcards: [] });
  itemState.q1 = { ...itemState.q1!, edited: true };

  const result = regenerateQuestionCategory({
    existing,
    itemState,
    category: "technical",
    fresh: [{ requirement_ids: ["r1"], category: "technical", prompt: "new", answer_outline: "...", difficulty: 2 }],
  });

  const q1 = result.questions.find((x) => x.id === "q1");
  assert.equal(q1?.prompt, "user's careful rewrite");
});

test("schedule reconciliation prunes dead ids and appends new ones to the lightest day", () => {
  const schedule = {
    days: [
      { question_ids: ["q1", "q2", "gone"], minutes: 60 },
      { question_ids: ["q3"], minutes: 30 },
    ],
  };
  reconcileScheduleQuestionIds({
    schedule,
    validQuestionIds: new Set(["q1", "q2", "q3", "q10", "q11"]),
    newQuestionIds: ["q10", "q11"],
    scheduleEdited: false,
  });
  assert.deepEqual(schedule.days[0]!.question_ids, ["q1", "q2"]);
  assert.deepEqual(schedule.days[1]!.question_ids, ["q3", "q10", "q11"]);
});

test("an edited schedule only gets dead ids pruned, no appends", () => {
  const schedule = { days: [{ question_ids: ["q1", "gone"], minutes: 60 }] };
  reconcileScheduleQuestionIds({
    schedule,
    validQuestionIds: new Set(["q1", "q9"]),
    newQuestionIds: ["q9"],
    scheduleEdited: true,
  });
  assert.deepEqual(schedule.days[0]!.question_ids, ["q1"]);
});
