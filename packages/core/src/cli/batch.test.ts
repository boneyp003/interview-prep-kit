import { test } from "node:test";
import assert from "node:assert/strict";
import type { ZodType } from "zod";
import { runBatch } from "./batch.js";
import { loadCoreConfig } from "../config/index.js";
import { batchOutputSchema, type CaseInput } from "../schema/batch.js";
import { validateKit } from "../schema/kit.js";
import { LlmError, type GenerateOptions, type LlmCallLog, type LlmClientLike } from "../generation/llm/index.js";
import type { Retrieval } from "../retrieval/index.js";

class FakeLlm implements LlmClientLike {
  readonly log: LlmCallLog[] = [];
  async generateText(): Promise<string> {
    return "";
  }
  async generateJson<T>(schema: ZodType<T>, options: GenerateOptions): Promise<T> {
    this.log.push({ purpose: options.purpose, attempts: 1, promptTokens: 5, outputTokens: 5, ms: 1 });
    if (options.prompt.includes("FAIL_ME")) {
      throw new LlmError("AUTH", "simulated auth failure for this case");
    }
    return schema.parse(this.payload(options.purpose)) as T;
  }
  private payload(purpose: string): unknown {
    if (purpose === "extract-requirements") {
      return {
        title: "Engineer",
        seniority: "mid",
        responsibilities: ["Ship features"],
        requirements: [{ text: "TypeScript", kind: "technical", priority: "must" }],
        thin: false,
      };
    }
    if (purpose === "analyse-hiring-process") {
      return { found: false, stages: [], formats: [], themes: [], summary: "" };
    }
    if (purpose === "company-brief") {
      return { summary: "A company.", what_they_do: "Software.", confident: true };
    }
    if (purpose === "flashcards") {
      return { flashcards: [{ requirement_id: "r1", front: "TS?", back: "Typed JS." }] };
    }
    if (purpose.startsWith("questions:")) {
      return {
        questions: [
          { requirement_id: "r1", prompt: "Explain TS generics.", answer_outline: "Bounds, inference.", difficulty: 2 },
        ],
      };
    }
    throw new Error(`unscripted: ${purpose}`);
  }
}

function fakeRetrieval(): Retrieval {
  return {
    async fetchPage(url) {
      return { url, title: "", description: "", text: "", links: [] };
    },
    async crawlSite(entryUrl) {
      return {
        entryUrl,
        entry: { url: entryUrl, title: "Co", description: "", text: "We build software tools.".repeat(8), links: [], intent: "entry", depth: 0 },
        pages: [{ url: entryUrl, title: "Co", description: "", text: "We build software tools.".repeat(8), links: [], intent: "entry", depth: 0 }],
        skipped: [],
      };
    },
    async searchInterviewDiscussion() {
      return { results: [], skipped: [] };
    },
  };
}

const config = loadCoreConfig({ GEMINI_API_KEY: "test" });
const now = () => new Date("2026-09-01T09:12:44Z");

const cases: CaseInput[] = [
  { id: "case-01", jd: "Backend Engineer. TypeScript required. Ship features.", company_url: "http://localhost:9/a/", days: 3 },
  { id: "case-02", jd: "Frontend Engineer. FAIL_ME please. TypeScript.", company_url: "http://localhost:9/b/", days: 1 },
  { id: "case-03", jd: "Platform Engineer. TypeScript required.", company_url: "http://localhost:9/c/", days: 7 },
];

test("produces an Appendix B document, one entry per case, order preserved", async () => {
  const out = await runBatch(cases, { config, llm: new FakeLlm(), retrieval: fakeRetrieval(), now, concurrency: 2 });
  assert.equal(batchOutputSchema.safeParse(out).success, true);
  assert.equal(out.version, "1.0");
  assert.equal(out.generated_at, "2026-09-01T09:12:44.000Z");
  assert.deepEqual(out.kits.map((k) => k.id), ["case-01", "case-02", "case-03"]);
});

test("a failing case is recorded, the rest still succeed", async () => {
  const out = await runBatch(cases, { config, llm: new FakeLlm(), retrieval: fakeRetrieval(), now, concurrency: 3 });
  const byId = Object.fromEntries(out.kits.map((k) => [k.id, k]));

  assert.equal(byId["case-01"]!.status, "ok");
  assert.equal(byId["case-03"]!.status, "ok");
  assert.equal(validateKit(byId["case-01"]!.kit).ok, true);

  const failed = byId["case-02"]!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.kit, null);
  assert.equal(failed.error?.code, "LLM_UNAVAILABLE");
});

test("uses each case's own day count for its schedule", async () => {
  const out = await runBatch(cases, { config, llm: new FakeLlm(), retrieval: fakeRetrieval(), now });
  const byId = Object.fromEntries(out.kits.map((k) => [k.id, k]));
  assert.equal(byId["case-01"]!.kit?.schedule.days.length, 3);
  assert.equal(byId["case-03"]!.kit?.schedule.days.length, 7);
});

test("a per-case timeout is reported as a failure, not an abort", async () => {
  const slow: Retrieval = {
    ...fakeRetrieval(),
    async crawlSite(entryUrl) {
      await new Promise((r) => setTimeout(r, 50));
      return { entryUrl, entry: null, pages: [], skipped: [] };
    },
  };
  const out = await runBatch([cases[0]!], {
    config,
    llm: new FakeLlm(),
    retrieval: slow,
    now,
    caseTimeoutMs: 10,
  });
  assert.equal(out.kits[0]!.status, "failed");
  assert.equal(out.kits[0]!.error?.code, "GENERATION_FAILED");
  assert.match(out.kits[0]!.error!.message, /exceeded/);
});
