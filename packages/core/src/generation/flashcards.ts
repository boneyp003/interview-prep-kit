import { z } from "zod";
import type { Flashcard, Requirement } from "../schema/kit.js";
import type { IdAllocator } from "../util/ids.js";
import type { GenerationContext } from "./questions.js";
import type { LlmClientLike } from "./llm/index.js";
import { UNTRUSTED_CONTENT_SYSTEM_CLAUSE } from "./prompts/untrusted.js";
import { isPostingFramed } from "./content-guard.js";

/**
 * Flashcards are recall prompts for the concrete knowledge behind each
 * requirement. Card ids are assigned in code; each card references the
 * requirement id(s) it drills so practice-mode coverage is checkable.
 *
 * A card that just paraphrases the job posting's own screening line ("What
 * degree is required for this role?") is a real failure mode a prompt
 * instruction alone did not reliably prevent — see content-guard.ts. Cards
 * are filtered deterministically after generation, and a requirement left
 * with zero cards gets one targeted retry that names the banned phrasing
 * explicitly, mirroring the coverage second pass.
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

const FRAMING_RULE = [
  "The requirement text is a screening line from a job posting, not the subject",
  "to quiz. Extract the knowledge or skill it implies and test THAT — never write",
  "a card whose answer is just a paraphrase of the requirement's own wording.",
  '  BAD:  requirement "Bachelor\'s degree in Statistics, Mathematics, ... or a',
  '         related quantitative field" -> front: "What educational background',
  '         is required for this role?" (tests recall of the posting itself)',
  '  GOOD: same requirement -> a card on an actual statistics concept the degree',
  '         implies, e.g. "What is the difference between Type I and Type II',
  '         error?" GOOD: requirement "5 years with SQL and Python" -> a card on',
  "         a real SQL/Python technique, never on the '5 years' figure.",
  "Never use these words/phrases anywhere in front or back, in any form: role,",
  "position, job, posting, listing, candidate, applicant, qualify, qualifying,",
  "qualification, requirement(s), nice-to-have, preferred, evaluation process.",
  "A card that names the job, the role, or the posting has failed, even if the",
  "rest of its content is accurate.",
  "If a requirement is purely administrative with no knowledge domain you can",
  "reasonably infer (visa status, willingness to travel, years-of-experience",
  "with no named skill attached), skip it rather than writing a hollow card.",
].join("\n");

const SYSTEM = [
  "You write study flashcards for interview preparation.",
  "Each card: 'front' is a question or cue, 'back' is a tight, correct answer (2-4 sentences).",
  "Target durable concepts a candidate should recall on the spot, not trivia.",
  "",
  FRAMING_RULE,
  "",
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

  const cards = await draftCards(targets, ctx, llm, alloc, perRequirement, false);

  const covered = new Set(cards.map((c) => c.requirement_ids[0]));
  const stillMissing = targets.filter((r) => !covered.has(r.id));
  if (stillMissing.length > 0) {
    const retried = await draftCards(stillMissing, ctx, llm, alloc, perRequirement, true);
    cards.push(...retried);
  }

  return cards;
}

async function draftCards(
  targets: Requirement[],
  ctx: GenerationContext,
  llm: LlmClientLike,
  alloc: IdAllocator,
  perRequirement: number,
  isRetry: boolean,
): Promise<Flashcard[]> {
  const prompt = [
    `Company: ${ctx.companyName || "(unknown)"} — Role: ${ctx.roleTitle || "(unspecified)"}`,
    "",
    "Write flashcards for these requirements:",
    targets.map((r) => `- ${r.id} [${r.priority}] "${r.text}"`).join("\n"),
    "",
    `About ${perRequirement} cards per requirement.`,
    ...(isRetry
      ? [
          "",
          "Your previous attempt at these same requirements named the job, the",
          "role, or the posting somewhere in the card and was rejected. Write only",
          "about the underlying knowledge — nothing here should be inferable as",
          "coming from a job posting at all.",
        ]
      : []),
    'Return JSON: {"flashcards": [{"requirement_id": string, "front": string, "back": string}]}',
  ].join("\n");

  const out = await llm.generateJson(modelOutput, {
    purpose: isRetry ? "flashcards:retry" : "flashcards",
    system: SYSTEM,
    prompt,
    maxOutputTokens: 3000,
  });

  const valid = new Set(targets.map((r) => r.id));
  return out.flashcards
    .filter((c) => valid.has(c.requirement_id) && !isPostingFramed([c.front, c.back]))
    .map((c) => ({
      id: alloc.next("f"),
      front: c.front.trim(),
      back: c.back.trim(),
      requirement_ids: [c.requirement_id],
    }));
}
