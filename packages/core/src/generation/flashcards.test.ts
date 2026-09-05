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

// Flashcards no longer take company/role context into their prompts (that was
// itself a leakage source), so this is just here to satisfy the signature.
const ctx: GenerationContext = {
  companyName: "Google",
  roleTitle: "Data Scientist III",
  hiring: { found: false, stages: [], formats: [], themes: [], summary: "", sources: [] },
};

function cleanTopics(ids: string[]) {
  return {
    topics: ids.map((id) => ({ requirement_id: id, topic: `general knowledge for ${id}`, skip: false })),
  };
}

/** A fake that dispatches on purpose: topics vs. cards, first attempt vs. retry. */
class DispatchLlm implements LlmClientLike {
  readonly log: LlmCallLog[] = [];
  constructor(
    private readonly cardsByAttempt: {
      first: Array<{ requirement_id: string; front: string; back: string }>;
      retry?: Array<{ requirement_id: string; front: string; back: string }>;
    },
  ) {}

  async generateText() {
    return "";
  }

  async generateJson<T>(schema: ZodType<T>, opts: GenerateOptions): Promise<T> {
    this.log.push({ purpose: opts.purpose, attempts: 1, promptTokens: 1, outputTokens: 1, ms: 1 });

    if (opts.purpose.startsWith("flashcard-topics")) {
      const requested = [...opts.prompt.matchAll(/- (r\d+) /g)].map((m) => m[1]!);
      return schema.parse(cleanTopics(requested)) as T;
    }

    const isRetry = opts.purpose.endsWith(":retry");
    const cards = isRetry ? (this.cardsByAttempt.retry ?? []) : this.cardsByAttempt.first;
    return schema.parse({ flashcards: cards }) as T;
  }
}

test("a card that quizzes the posting is dropped, not shipped, and a retry recovers it", async () => {
  const llm = new DispatchLlm({
    first: [
      { requirement_id: "r1", front: "What educational background is required for this role?", back: "A bachelor's degree in a quantitative field." },
      { requirement_id: "r2", front: "What is the difference between a SQL JOIN and a UNION?", back: "A JOIN combines columns; a UNION stacks result sets." },
    ],
    retry: [{ requirement_id: "r1", front: "What is a Type I error?", back: "Rejecting a true null hypothesis." }],
  });

  const cards = await generateFlashcards(requirements, ctx, llm, new IdAllocator());

  assert.ok(llm.log.some((l) => l.purpose === "flashcard-topics:retry"));
  assert.ok(llm.log.some((l) => l.purpose === "flashcards:retry"));
  assert.ok(!cards.some((c) => /required for this role/i.test(c.front)));
  assert.ok(cards.some((c) => c.requirement_ids[0] === "r1" && /Type I error/.test(c.front)));
  assert.ok(cards.some((c) => c.requirement_ids[0] === "r2" && /JOIN/.test(c.front)));
});

test("a retry that is still framed leaves the requirement honestly uncovered", async () => {
  const llm = new DispatchLlm({
    first: [{ requirement_id: "r1", front: "Why is this degree required for this role?", back: "It is a job requirement." }],
    retry: [{ requirement_id: "r1", front: "Why is this degree preferred for the position?", back: "It is still about the job." }],
  });

  const cards = await generateFlashcards([requirements[0]!], ctx, llm, new IdAllocator());
  assert.equal(cards.length, 0);
});

test("genuine content passes straight through with no retry", async () => {
  const llm = new DispatchLlm({
    first: [
      { requirement_id: "r1", front: "What is a Type I error?", back: "Rejecting a true null hypothesis." },
      { requirement_id: "r2", front: "What does a Python generator do?", back: "Lazily yields values one at a time." },
    ],
  });

  const cards = await generateFlashcards(requirements, ctx, llm, new IdAllocator());
  assert.equal(cards.length, 2);
  assert.ok(!llm.log.some((l) => l.purpose.endsWith(":retry")));
});

test("a topic the model marks skip=true never gets a card written", async () => {
  class SkipLlm implements LlmClientLike {
    readonly log: LlmCallLog[] = [];
    async generateText() {
      return "";
    }
    async generateJson<T>(schema: ZodType<T>, opts: GenerateOptions): Promise<T> {
      this.log.push({ purpose: opts.purpose, attempts: 1, promptTokens: 1, outputTokens: 1, ms: 1 });
      if (opts.purpose.startsWith("flashcard-topics")) {
        return schema.parse({
          topics: [{ requirement_id: "r1", topic: "", skip: true }],
        }) as T;
      }
      // Should never be called for r1 since it has no topic — assert via absence.
      return schema.parse({ flashcards: [] }) as T;
    }
  }

  const llm = new SkipLlm();
  const cards = await generateFlashcards([requirements[0]!], ctx, llm, new IdAllocator());
  assert.equal(cards.length, 0);
  // Still tried a retry once (the requirement never got a card either attempt).
  assert.ok(llm.log.some((l) => l.purpose === "flashcard-topics:retry"));
});
