import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSchedule } from "./index.js";
import type { Question, Requirement } from "../schema/kit.js";

const requirements: Requirement[] = [
  { id: "r1", text: "Distributed systems", kind: "technical", priority: "must" },
  { id: "r2", text: "React", kind: "technical", priority: "must" },
  { id: "r3", text: "Mentoring", kind: "behavioural", priority: "nice" },
];

function makeQuestions(): Question[] {
  return [
    mk("q1", ["r1"], "system-design", 3),
    mk("q2", ["r1"], "technical", 2),
    mk("q3", ["r2"], "technical", 2),
    mk("q4", ["r2"], "technical", 1),
    mk("q5", ["r3"], "behavioural", 1),
    mk("q6", ["r3"], "behavioural", 2),
  ];
}

function mk(id: string, rids: string[], category: Question["category"], difficulty: number): Question {
  return { id, requirement_ids: rids, category, prompt: "?", answer_outline: "...", difficulty: difficulty as 1 | 2 | 3 };
}

function allInts(ns: number[]): boolean {
  return ns.every((n) => Number.isInteger(n));
}

test("produces exactly the requested number of days", () => {
  for (const days of [1, 2, 3, 7, 60]) {
    const s = buildSchedule({ daysAvailable: days, questions: makeQuestions(), requirements });
    assert.equal(s.days.length, days);
    assert.equal(s.days_available, days);
    assert.deepEqual(
      s.days.map((d) => d.day),
      Array.from({ length: days }, (_, i) => i + 1),
    );
  }
});

test("every question is scheduled and all durations are integers", () => {
  const s = buildSchedule({ daysAvailable: 3, questions: makeQuestions(), requirements });
  const scheduled = new Set(s.days.flatMap((d) => d.question_ids));
  for (const q of makeQuestions()) assert.ok(scheduled.has(q.id), `${q.id} missing`);
  assert.ok(allInts(s.days.map((d) => d.minutes)));
});

test("every must-have requirement is represented in the schedule", () => {
  const s = buildSchedule({ daysAvailable: 5, questions: makeQuestions(), requirements });
  const scheduledQ = new Set(s.days.flatMap((d) => d.question_ids));
  for (const r of requirements.filter((r) => r.priority === "must")) {
    const covered = makeQuestions().some(
      (q) => q.requirement_ids.includes(r.id) && scheduledQ.has(q.id),
    );
    assert.ok(covered, `must ${r.id} not represented`);
  }
});

test("harder and higher-priority material lands earlier", () => {
  const s = buildSchedule({ daysAvailable: 3, questions: makeQuestions(), requirements });
  const dayOf = new Map<string, number>();
  s.days.forEach((d) => d.question_ids.forEach((id) => { if (!dayOf.has(id)) dayOf.set(id, d.day); }));
  // q1 is a must + difficulty 3; q5 is nice + difficulty 1
  assert.ok(dayOf.get("q1")! <= dayOf.get("q5")!);
  assert.ok(dayOf.get("q1")! <= dayOf.get("q4")!);
});

test("1-day schedule puts everything on day 1", () => {
  const s = buildSchedule({ daysAvailable: 1, questions: makeQuestions(), requirements });
  assert.equal(s.days[0]!.question_ids.length, 6);
  assert.ok(s.days[0]!.minutes > 0);
});

test("60-day schedule front-loads study and fills later days with revision", () => {
  const s = buildSchedule({ daysAvailable: 60, questions: makeQuestions(), requirements });
  assert.equal(s.days.length, 60);
  const firstSix = s.days.slice(0, 6).flatMap((d) => d.question_ids);
  for (const q of makeQuestions()) assert.ok(firstSix.includes(q.id));
  assert.ok(s.days.every((d) => d.question_ids.length > 0 || d.focus.length > 0));
});

test("thin kit with no questions still yields the right number of non-negative days", () => {
  const s = buildSchedule({ daysAvailable: 4, questions: [], requirements: [] });
  assert.equal(s.days.length, 4);
  assert.ok(s.days.every((d) => d.minutes >= 0 && d.question_ids.length === 0));
});
