import { z } from "zod";
import type { Flashcard, Requirement } from "../schema/kit.js";
import type { IdAllocator } from "../util/ids.js";
import type { GenerationContext } from "./questions.js";
import type { LlmClientLike } from "./llm/index.js";
import { UNTRUSTED_CONTENT_SYSTEM_CLAUSE } from "./prompts/untrusted.js";

/**
 * Flashcards are recall prompts for the concrete knowledge behind each
 * requirement. Card ids are assigned in code; each card references the
 * requirement id(s) it drills so practice-mode coverage is checkable.
 */

const modelOutput = z.object({
  flashcards: z.array(
    z.object({
      requirement_id: z.string().min(1),
      front: z.string().min(4).max(300),
      back: z.string().min(4).max(800),
    }),
  ),
});

const SYSTEM = [
  "You write study flashcards for interview preparation.",
  "Each card: 'front' is a question or cue, 'back' is a tight, correct answer (2-4 sentences).",
  "Target durable concepts a candidate should recall on the spot, not trivia.",
  UNTRUSTED_CONTENT_SYSTEM_CLAUSE,
  "Every card targets exactly one provided requirement id. Do not invent requirements.",
].join("\n");

export async function generateFlashcards(
  requirements: Requirement[],
  ctx: GenerationContext,
  llm: LlmClientLike,
  alloc: IdAllocator,
  perRequirement = 2,
): Promise<Flashcard[]> {
  const targets = requirements.slice(0, 12);
  if (targets.length === 0) return [];

  const prompt = [
    `Company: ${ctx.companyName || "(unknown)"} — Role: ${ctx.roleTitle || "(unspecified)"}`,
    "",
    "Write flashcards for these requirements:",
    targets.map((r) => `- ${r.id} [${r.priority}] "${r.text}"`).join("\n"),
    "",
    `About ${perRequirement} cards per requirement.`,
    'Return JSON: {"flashcards": [{"requirement_id": string, "front": string, "back": string}]}',
  ].join("\n");

  const out = await llm.generateJson(modelOutput, {
    purpose: "flashcards",
    system: SYSTEM,
    prompt,
    maxOutputTokens: 3000,
  });

  const valid = new Set(targets.map((r) => r.id));
  return out.flashcards
    .filter((c) => valid.has(c.requirement_id))
    .map((c) => ({
      id: alloc.next("f"),
      front: c.front.trim(),
      back: c.back.trim(),
      requirement_ids: [c.requirement_id],
    }));
}
