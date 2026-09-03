import { test } from "node:test";
import assert from "node:assert/strict";
import type { ZodType } from "zod";
import { regenerateCategory, regenerateSchedule } from "./regenerate.js";
import { initialItemState, userState } from "./state.js";
import { validateKit, type Kit } from "../schema/kit.js";
import type { GenerateOptions, LlmCallLog, LlmClientLike } from "../generation/llm/index.js";
import type { ResearchSnapshot } from "../pipeline/types.js";

class FakeLlm implements LlmClientLike {
  readonly log: LlmCallLog[] = [];
  async generateText() {
    return "";
  }
  async generateJson<T>(schema: ZodType<T>, opts: GenerateOptions): Promise<T> {
    this.log.push({ purpose: opts.purpose, attempts: 1, promptTokens: 1, outputTokens: 1, ms: 1 });
    if (opts.purpose.startsWith("questions:")) {
      return schema.parse({
        questions: [
          { requirement_id: "r1", prompt: "fresh technical q", answer_outline: "Discuss tradeoffs and key points.", difficulty: 3 },
        ],
      }) as T;
    }
    throw new Error(`unscripted ${opts.purpose}`);
  }
}

const research: ResearchSnapshot = {
  companyName: "Acme",
  roleTitle: "Engineer",
  pages: [],
  discussion: [],
  hiring: { found: false, stages: [], formats: [], themes: [], summary: "", sources: [] },
};

function kit(): Kit {
  return {
    source: {
      company: "Acme", company_url: "https://acme.example/", role: "Engineer", location: "remote",
      jd_chars: 100, pages_used: [], researched_at: "2026-09-01T00:00:00Z",
    },
    company_brief: { summary: "s", what_they_do: "w", sources: [] },
    role: {
      title: "Engineer", seniority: "senior", responsibilities: [],
      requirements: [{ id: "r1", text: "TypeScript", kind: "technical", priority: "must" }],
    },
    questions: [
      { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "old generated", answer_outline: "...", difficulty: 2 },
      { id: "q2", requirement_ids: ["r1"], category: "technical", prompt: "user's own", answer_outline: "...", difficulty: 2 },
      { id: "q3", requirement_ids: ["r1"], category: "behavioural", prompt: "behavioural one", answer_outline: "...", difficulty: 1 },
    ],
    flashcards: [{ id: "f1", front: "a", back: "b", requirement_ids: ["r1"] }],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "tech", question_ids: ["q1", "q2"], minutes: 50 },
        { day: 2, focus: "behav", question_ids: ["q3"], minutes: 15 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

test("regenerating a category keeps user questions, drops generated, stays valid", async () => {
  const k = kit();
  const itemState = initialItemState({ questions: k.questions, flashcards: k.flashcards });
  itemState.q2 = userState();

  const result = await regenerateCategory({
    kit: k,
    itemState,
    category: "technical",
    research,
    scheduleEdited: false,
    llm: new FakeLlm(),
  });

  const ids = result.questions.map((q) => q.id);
  assert.ok(!ids.includes("q1"), "generated q1 dropped");
  assert.ok(ids.includes("q2"), "user q2 kept");
  assert.ok(ids.includes("q3"), "behavioural q3 untouched");
  assert.deepEqual(result.removedIds, ["q1"]);
  assert.equal(result.addedIds.length, 1);

  const rebuilt: Kit = {
    ...k,
    questions: result.questions,
    schedule: result.schedule,
    coverage: result.coverage,
  };
  assert.equal(validateKit(rebuilt).ok, true, JSON.stringify(validateKit(rebuilt).issues));
  // the dropped q1 is gone from the schedule; the new question was slotted in
  const scheduled = new Set(result.schedule.days.flatMap((d) => d.question_ids));
  assert.ok(!scheduled.has("q1"));
  assert.ok(result.addedIds.every((id) => scheduled.has(id)));
});

test("regenerateSchedule is deterministic and rebuilds from current questions", () => {
  const k = kit();
  const s = regenerateSchedule(k);
  assert.equal(s.days.length, 2);
  const scheduled = new Set(s.days.flatMap((d) => d.question_ids));
  for (const q of k.questions) assert.ok(scheduled.has(q.id));
});
