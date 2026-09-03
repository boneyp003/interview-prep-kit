import { test } from "node:test";
import assert from "node:assert/strict";
import type { ZodType } from "zod";
import { runPipeline } from "./run.js";
import { validateKit } from "../schema/kit.js";
import { loadCoreConfig } from "../config/index.js";
import type { GenerateOptions, LlmCallLog, LlmClientLike } from "../generation/llm/index.js";
import type { Retrieval } from "../retrieval/index.js";
import type { ProgressEvent } from "./types.js";

/** A scripted LLM: returns purpose-appropriate JSON, no network. */
class FakeLlm implements LlmClientLike {
  readonly log: LlmCallLog[] = [];
  constructor(private readonly opts: { coverFirstPass?: boolean } = {}) {}

  async generateText(): Promise<string> {
    return "";
  }

  async generateJson<T>(schema: ZodType<T>, options: GenerateOptions): Promise<T> {
    this.log.push({ purpose: options.purpose, attempts: 1, promptTokens: 10, outputTokens: 10, ms: 1 });
    return schema.parse(this.payload(options.purpose)) as T;
  }

  private payload(purpose: string): unknown {
    if (purpose === "extract-requirements") {
      return {
        title: "Senior Backend Engineer",
        seniority: "senior",
        responsibilities: ["Own the payments service"],
        requirements: [
          { text: "5+ years with Node.js", kind: "technical", priority: "must" },
          { text: "Design distributed systems", kind: "technical", priority: "must" },
          { text: "Mentor junior engineers", kind: "behavioural", priority: "nice" },
        ],
        thin: false,
      };
    }
    if (purpose === "analyse-hiring-process") {
      return {
        found: true,
        stages: ["recruiter screen", "take-home", "system design"],
        formats: ["recruiter-screen", "take-home", "system-design"],
        themes: ["distributed systems", "code quality"],
        summary: "Screen, take-home, then a system design round.",
      };
    }
    if (purpose === "company-brief") {
      return { summary: "Acme runs payments infra.", what_they_do: "Payments API.", confident: true };
    }
    if (purpose === "flashcards") {
      return {
        flashcards: [
          { requirement_id: "r1", front: "Event loop?", back: "Phases and microtasks." },
          { requirement_id: "r2", front: "CAP?", back: "Consistency, availability, partition tolerance." },
        ],
      };
    }
    if (purpose.startsWith("questions:gap")) {
      return {
        questions: [
          { requirement_id: "r3", prompt: "Tell me about mentoring someone.", answer_outline: "STAR story.", difficulty: 2 },
        ],
      };
    }
    if (purpose.startsWith("questions:")) {
      const category = purpose.split(":")[1];
      const ids = this.opts.coverFirstPass ? ["r1", "r2", "r3"] : ["r1", "r2"];
      return {
        questions: ids
          .filter(() => category === "technical" || category === "system-design" || category === "behavioural" || category === "company-fit")
          .map((rid) => ({
            requirement_id: rid,
            prompt: `A ${category} question for ${rid}`,
            answer_outline: "Key points.",
            difficulty: 2,
          })),
      };
    }
    throw new Error(`unscripted purpose: ${purpose}`);
  }
}

function fakeRetrieval(): Retrieval {
  return {
    async fetchPage(url: string) {
      return { url, title: "", description: "", text: "", links: [] };
    },
    async crawlSite(entryUrl: string) {
      return {
        entryUrl,
        entry: {
          url: entryUrl, title: "Acme", description: "", text: "Acme builds payments infrastructure for platforms.".repeat(6), links: [], intent: "entry" as const, depth: 0,
        },
        pages: [
          { url: entryUrl, title: "Acme", description: "", text: "Acme builds payments infrastructure.".repeat(6), links: [], intent: "entry" as const, depth: 0 },
          { url: `${entryUrl}handbook/hiring`, title: "How we hire", description: "", text: "We run a take-home then a system design interview.".repeat(6), links: [], intent: "hiring" as const, depth: 1 },
        ],
        skipped: [],
      };
    },
    async searchInterviewDiscussion() {
      return { results: [], skipped: [] };
    },
  };
}

const config = loadCoreConfig({ GEMINI_API_KEY: "test", BLOCK_PRIVATE_ADDRESSES: "false" });

test("assembles a structurally valid kit from a full run", async () => {
  const events: ProgressEvent[] = [];
  const outcome = await runPipeline(
    { jd: "Senior Backend Engineer\n\nWe need Node.js and distributed systems experience.", companyUrl: "http://localhost:9/acme/", days: 5 },
    { config, llm: new FakeLlm({ coverFirstPass: true }), retrieval: fakeRetrieval(), onProgress: (e) => events.push(e), now: () => new Date("2026-09-01T00:00:00Z") },
  );

  assert.equal(validateKit(outcome.kit).ok, true, JSON.stringify(validateKit(outcome.kit).issues));
  assert.equal(outcome.kit.schedule.days.length, 5);
  assert.equal(outcome.kit.source.jd_chars, 76);
  assert.ok(outcome.kit.source.pages_used.length >= 2);
  assert.ok(outcome.kit.questions.length >= 3);
  assert.equal(outcome.kit.coverage.uncovered_requirement_ids.length, 0);
  assert.ok(events.some((e) => e.step === "generate-questions" && e.status === "done"));
});

test("the coverage second pass closes a gap left by the first pass", async () => {
  const outcome = await runPipeline(
    { jd: "Senior Backend Engineer with Node.js, distributed systems, and mentoring.", companyUrl: "http://localhost:9/acme/", days: 3 },
    { config, llm: new FakeLlm({ coverFirstPass: false }), retrieval: fakeRetrieval(), now: () => new Date("2026-09-01T00:00:00Z") },
  );

  // r3 (mentoring) is skipped on the first pass, filled on the second.
  assert.ok(outcome.coveragePasses >= 2);
  assert.equal(outcome.kit.coverage.passes, outcome.coveragePasses);
  assert.equal(outcome.kit.coverage.uncovered_requirement_ids.length, 0);
  const covered = new Set(outcome.kit.questions.flatMap((q) => q.requirement_ids));
  assert.ok(covered.has("r3"));
});

test("a thin JD produces a thin but valid kit that says so", async () => {
  class ThinLlm extends FakeLlm {
    async generateJson<T>(schema: ZodType<T>, options: GenerateOptions): Promise<T> {
      if (options.purpose === "extract-requirements") {
        return schema.parse({ title: "Engineer", seniority: "", responsibilities: [], requirements: [], thin: true }) as T;
      }
      return super.generateJson(schema, options);
    }
  }
  const outcome = await runPipeline(
    { jd: "Backend engineer wanted. Node.js.", companyUrl: "http://localhost:9/acme/", days: 2 },
    { config, llm: new ThinLlm(), retrieval: fakeRetrieval(), now: () => new Date("2026-09-01T00:00:00Z") },
  );

  assert.equal(validateKit(outcome.kit).ok, true);
  assert.equal(outcome.kit.questions.length, 0);
  assert.equal(outcome.kit.schedule.days.length, 2);
  assert.ok(outcome.warnings.some((w) => /thin/i.test(w.message)));
});
