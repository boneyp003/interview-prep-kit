import { test } from "node:test";
import assert from "node:assert/strict";
import type { ZodType } from "zod";
import { generateFlashcards } from "./flashcards.js";
import { IdAllocator } from "../util/ids.js";
import type { Requirement } from "../schema/kit.js";
import type { GenerateOptions, LlmCallLog, LlmClientLike } from "./llm/index.js";
import type { GenerationContext } from "./questions.js";

const requirements: Requirement[] = [
  { id: "r1", text: "Bachelor's degree in Statistics, Mathematics, or a related field.", kind: "domain", priority: "must" },
  { id: "r2", text: "5 years of experience with SQL and Python.", kind: "technical", priority: "must" },
];

const ctx: GenerationContext = {
  companyName: "Google",
  roleTitle: "Data Scientist III",
  hiring: { found: false, stages: [], formats: [], themes: [], summary: "", sources: [] },
};

test("a card that quizzes the posting is dropped, not shipped", async () => {
  class FramedLlm implements LlmClientLike {
    readonly log: LlmCallLog[] = [];
    async generateText() {
      return "";
    }
    async generateJson<T>(schema: ZodType<T>, opts: GenerateOptions): Promise<T> {
      this.log.push({ purpose: opts.purpose, attempts: 1, promptTokens: 1, outputTokens: 1, ms: 1 });
      return schema.parse({
        flashcards: [
          { requirement_id: "r1", front: "What educational background is required for this role?", back: "A bachelor's degree in a quantitative field." },
          { requirement_id: "r2", front: "What is the difference between a SQL JOIN and a UNION?", back: "A JOIN combines columns; a UNION stacks result sets." },
        ],
      }) as T;
    }
  }

  const llm = new FramedLlm();
  const cards = await generateFlashcards(requirements, ctx, llm, new IdAllocator());

  // r1's only card was posting-framed and got filtered; a retry was attempted.
  assert.ok(llm.log.some((l) => l.purpose === "flashcards:retry"));
  assert.ok(!cards.some((c) => /required for this role/i.test(c.front)));
  // r2's genuine card survives untouched.
  assert.ok(cards.some((c) => c.requirement_ids[0] === "r2" && /JOIN/.test(c.front)));
});

test("a retry that is still framed leaves the requirement honestly uncovered", async () => {
  class AlwaysFramedLlm implements LlmClientLike {
    readonly log: LlmCallLog[] = [];
    async generateText() {
      return "";
    }
    async generateJson<T>(schema: ZodType<T>, opts: GenerateOptions): Promise<T> {
      this.log.push({ purpose: opts.purpose, attempts: 1, promptTokens: 1, outputTokens: 1, ms: 1 });
      return schema.parse({
        flashcards: [
          { requirement_id: "r1", front: "Why is this degree required for this role?", back: "It is a job requirement." },
        ],
      }) as T;
    }
  }

  const cards = await generateFlashcards([requirements[0]!], ctx, new AlwaysFramedLlm(), new IdAllocator());
  assert.equal(cards.length, 0);
});

test("genuine content passes straight through with no retry", async () => {
  class CleanLlm implements LlmClientLike {
    readonly log: LlmCallLog[] = [];
    async generateText() {
      return "";
    }
    async generateJson<T>(schema: ZodType<T>, opts: GenerateOptions): Promise<T> {
      this.log.push({ purpose: opts.purpose, attempts: 1, promptTokens: 1, outputTokens: 1, ms: 1 });
      return schema.parse({
        flashcards: [
          { requirement_id: "r1", front: "What is a Type I error?", back: "Rejecting a true null hypothesis." },
          { requirement_id: "r2", front: "What does a Python generator do?", back: "Lazily yields values one at a time." },
        ],
      }) as T;
    }
  }

  const llm = new CleanLlm();
  const cards = await generateFlashcards(requirements, ctx, llm, new IdAllocator());
  assert.equal(cards.length, 2);
  assert.ok(!llm.log.some((l) => l.purpose === "flashcards:retry"));
});
