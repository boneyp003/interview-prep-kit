import { test } from "node:test";
import assert from "node:assert/strict";
import { validateKit, checkKitIntegrity, type Kit } from "./kit.js";

function baseKit(): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "http://localhost:8099/acme/",
      role: "Senior Backend Engineer",
      location: "Remote",
      jd_chars: 1200,
      pages_used: ["http://localhost:8099/acme/"],
      researched_at: "2026-09-01T09:12:44Z",
    },
    company_brief: {
      summary: "Acme builds widgets.",
      what_they_do: "Widget manufacturing SaaS.",
      sources: ["http://localhost:8099/acme/"],
    },
    role: {
      title: "Senior Backend Engineer",
      seniority: "senior",
      responsibilities: ["Own the API"],
      requirements: [
        { id: "r1", text: "5+ years Node.js", kind: "technical", priority: "must" },
        { id: "r2", text: "Mentor juniors", kind: "behavioural", priority: "nice" },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Explain the event loop.",
        answer_outline: "Phases, microtasks...",
        difficulty: 2,
      },
    ],
    flashcards: [
      { id: "f1", front: "Event loop?", back: "Phases...", requirement_ids: ["r1"] },
    ],
    schedule: {
      days_available: 1,
      days: [{ day: 1, focus: "Node fundamentals", question_ids: ["q1"], minutes: 60 }],
    },
    coverage: { uncovered_requirement_ids: ["r2"], passes: 2 },
  };
}

test("a well-formed kit passes", () => {
  const result = validateKit(baseKit());
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("rejects a float difficulty", () => {
  const kit = baseKit() as unknown as Record<string, unknown>;
  (kit.questions as any)[0].difficulty = 2.5;
  assert.equal(validateKit(kit).ok, false);
});

test("catches a question referencing an unknown requirement", () => {
  const kit = baseKit();
  kit.questions[0]!.requirement_ids = ["r9"];
  const issues = checkKitIntegrity(kit);
  assert.ok(issues.some((i) => i.message.includes("r9")));
});

test("catches an uncovered must-have requirement", () => {
  const kit = baseKit();
  kit.questions = [];
  kit.flashcards = [];
  kit.schedule.days[0]!.question_ids = [];
  kit.coverage.uncovered_requirement_ids = ["r1", "r2"];
  const issues = checkKitIntegrity(kit);
  assert.ok(issues.some((i) => i.message.includes('"r1"')));
});

test("catches schedule length mismatch", () => {
  const kit = baseKit();
  kit.schedule.days_available = 3;
  const issues = checkKitIntegrity(kit);
  assert.ok(issues.some((i) => i.path === "schedule.days"));
});

test("catches inconsistent coverage.uncovered_requirement_ids", () => {
  const kit = baseKit();
  kit.coverage.uncovered_requirement_ids = [];
  const issues = checkKitIntegrity(kit);
  assert.ok(issues.some((i) => i.path === "coverage.uncovered_requirement_ids"));
});
