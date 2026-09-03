import { z } from "zod";
import type { Question, QuestionCategory } from "../schema/kit.js";
import type { IdAllocator } from "../util/ids.js";
import type { HiringProcess } from "./hiring-process.js";
import type { CategoryPlan, PlannedItem } from "./question-plan.js";
import type { LlmClient } from "./llm/index.js";
import { UNTRUSTED_CONTENT_SYSTEM_CLAUSE } from "./prompts/untrusted.js";

export interface GenerationContext {
  companyName: string;
  roleTitle: string;
  hiring: HiringProcess;
}

const CATEGORY_GUIDANCE: Record<QuestionCategory, string> = {
  technical:
    "Practical technical questions that probe real depth on the specific skill named. Prefer 'how would you' and 'walk me through' over trivia. The answer_outline lists the key points a strong answer hits.",
  "system-design":
    "One open-ended design scenario per question, sized to a 30-45 minute discussion and tied to the named skill and this company's product/scale. answer_outline sketches the components, trade-offs, and follow-up probes.",
  behavioural:
    "Behavioural questions in STAR form about the specific behaviour named (e.g. mentoring, conflict, ownership). answer_outline describes what a credible story demonstrates.",
  "company-fit":
    "Questions about motivation, values alignment, and domain fit specific to THIS company and role. answer_outline notes what a well-prepared candidate references.",
};

const modelOutput = z.object({
  questions: z.array(
    z.object({
      requirement_id: z.string().min(1),
      prompt: z.string().min(8).max(600),
      answer_outline: z.string().min(8).max(1200),
      difficulty: z.number().int().min(1).max(3),
    }),
  ),
});

function systemFor(category: QuestionCategory): string {
  return [
    `You write ${category} interview questions for a candidate preparing for a specific role.`,
    CATEGORY_GUIDANCE[category],
    UNTRUSTED_CONTENT_SYSTEM_CLAUSE,
    "Every question must target exactly one of the provided requirement ids. Do not invent requirements. Do not produce questions for skills that are not listed.",
  ].join("\n");
}

function contextBlock(ctx: GenerationContext): string {
  const lines = [
    `Company: ${ctx.companyName || "(unknown)"}`,
    `Role: ${ctx.roleTitle || "(unspecified)"}`,
  ];
  if (ctx.hiring.found) {
    if (ctx.hiring.formats.length) lines.push(`Interview formats used: ${ctx.hiring.formats.join(", ")}`);
    if (ctx.hiring.themes.length) lines.push(`Process emphasises: ${ctx.hiring.themes.join("; ")}`);
  } else {
    lines.push("No public information about this company's interview process was found; keep questions role-driven.");
  }
  return lines.join("\n");
}

function itemsBlock(items: PlannedItem[]): string {
  return items
    .map(
      (it) =>
        `- ${it.requirementId} [${it.priority}] "${it.text}" -> ${it.targetCount} question(s), difficulty ${it.difficultyFloor}-${it.difficultyCeiling}`,
    )
    .join("\n");
}

/** One LLM call for a whole category; per-requirement targeting preserved via ids. */
export async function generateQuestionsForCategory(
  plan: CategoryPlan,
  ctx: GenerationContext,
  llm: LlmClient,
  alloc: IdAllocator,
): Promise<Question[]> {
  if (plan.items.length === 0) return [];
  const total = plan.items.reduce((n, it) => n + it.targetCount, 0);

  const prompt = [
    contextBlock(ctx),
    "",
    `Write ${plan.category} questions for these requirements:`,
    itemsBlock(plan.items),
    "",
    `Produce about ${total} questions total, respecting each requirement's count and difficulty range.`,
    'Return JSON: {"questions": [{"requirement_id": string, "prompt": string, "answer_outline": string, "difficulty": 1-3}]}',
  ].join("\n");

  const out = await llm.generateJson(modelOutput, {
    purpose: `questions:${plan.category}`,
    system: systemFor(plan.category),
    prompt,
    maxOutputTokens: 3000,
  });

  return materialise(out.questions, plan.category, plan.items, alloc);
}

/** Targeted call for a single requirement — used by the coverage second pass. */
export async function generateQuestionsForRequirement(
  item: PlannedItem,
  category: QuestionCategory,
  ctx: GenerationContext,
  llm: LlmClient,
  alloc: IdAllocator,
  count = 1,
): Promise<Question[]> {
  const prompt = [
    contextBlock(ctx),
    "",
    `Write ${count} ${category} question(s) for this requirement, which currently has no coverage:`,
    `- ${item.requirementId} [${item.priority}] "${item.text}" (difficulty ${item.difficultyFloor}-${item.difficultyCeiling})`,
    "",
    'Return JSON: {"questions": [{"requirement_id": string, "prompt": string, "answer_outline": string, "difficulty": 1-3}]}',
  ].join("\n");

  const out = await llm.generateJson(modelOutput, {
    purpose: `questions:gap:${category}`,
    system: systemFor(category),
    prompt,
    maxOutputTokens: 1200,
  });

  return materialise(out.questions, category, [item], alloc);
}

function materialise(
  raw: z.infer<typeof modelOutput>["questions"],
  category: QuestionCategory,
  items: PlannedItem[],
  alloc: IdAllocator,
): Question[] {
  const byId = new Map(items.map((it) => [it.requirementId, it]));
  const out: Question[] = [];
  for (const q of raw) {
    const item = byId.get(q.requirement_id);
    if (!item) continue; // model referenced a requirement not in this plan -> drop
    const difficulty = clamp(
      Math.round(q.difficulty),
      item.difficultyFloor,
      item.difficultyCeiling,
    );
    out.push({
      id: alloc.next("q"),
      requirement_ids: [item.requirementId],
      category,
      prompt: q.prompt.trim(),
      answer_outline: q.answer_outline.trim(),
      difficulty,
    });
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
