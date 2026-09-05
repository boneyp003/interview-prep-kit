import { z } from "zod";
import type { Flashcard, Requirement } from "../schema/kit.js";
import type { IdAllocator } from "../util/ids.js";
import type { GenerationContext } from "./questions.js";
import type { LlmClientLike } from "./llm/index.js";
import { UNTRUSTED_CONTENT_SYSTEM_CLAUSE } from "./prompts/untrusted.js";
import { isPostingFramed, mentionsPostingFraming } from "./content-guard.js";

/**
 * Flashcards are recall prompts for the concrete knowledge behind each
 * requirement. Card ids are assigned in code; each card references the
 * requirement id(s) it drills so practice-mode coverage is checkable.
 *
 * A denylist alone was not enough to stop cards that quiz the job posting's
 * own screening line ("What degree is required for this role?") instead of
 * the knowledge it implies — the model kept finding new meta-framing that no
 * regex had anticipated. So generation is two calls instead of one:
 *
 *   1. deriveTopics  — reduce each requirement to a short, job-free topic
 *      phrase ("Bachelor's in Statistics..." -> "hypothesis testing,
 *      probability distributions"). This call sees the original wording.
 *   2. draftCardsFromTopics — write the actual cards from ONLY those topic
 *      phrases. This call never sees the word "degree", "role", "candidate",
 *      or "years" at all, so it structurally cannot reference them.
 *
 * content-guard's denylist still runs on both outputs as a cheap backstop,
 * and a requirement left with no card after one retry is honestly skipped —
 * see generateFlashcards below.
 */

const topicsOutput = z.object({
  topics: z.array(
    z.object({
      requirement_id: z.string().min(1),
      topic: z.string().max(200),
      skip: z.boolean().default(false),
    }),
  ),
});

const cardsOutput = z.object({
  flashcards: z.array(
    z.object({
      requirement_id: z.string().min(1),
      front: z.string().min(4).max(300),
      back: z.string().min(4).max(800),
    }),
  ),
});

const TOPIC_SYSTEM = [
  "You reduce a job-posting screening line to the underlying subject-matter it",
  "implies, so study material can be built from it. For each requirement, output",
  "a short topic phrase (5-15 words) naming the concrete knowledge domain or",
  "skill it points to — specific enough to write real study questions from —",
  "with NO reference to jobs, roles, positions, degrees, years of experience,",
  "candidates, or the posting itself.",
  '  "Bachelor\'s degree in Statistics, Mathematics, ... or a related',
  '   quantitative field" -> "hypothesis testing, probability distributions,',
  '   statistical inference"',
  '  "5 years of experience with SQL and Python" -> "SQL query optimisation',
  '   and joins; Python data manipulation (pandas)"',
  "If a requirement is purely administrative with no knowledge domain you can",
  "reasonably infer (visa status, willingness to travel, bare years-of-experience",
  "with no named skill attached), set skip=true and leave topic empty.",
  UNTRUSTED_CONTENT_SYSTEM_CLAUSE,
  "Every entry must reference exactly one provided requirement id. Do not invent requirements.",
].join("\n");

const CARD_SYSTEM = [
  "You write study flashcards for interview preparation from a list of topics.",
  "Each card: 'front' is a question or cue, 'back' is a tight, correct answer (2-4 sentences).",
  "Target durable concepts a candidate should recall on the spot, not trivia.",
  "Write as if for a general subject-matter study deck. Never reference a job,",
  "role, position, company, candidate, applicant, requirement, qualification,",
  "or posting of any kind, even indirectly — you were given a topic, not a",
  "job description, and the card should read that way.",
  UNTRUSTED_CONTENT_SYSTEM_CLAUSE,
  "Every card must reference exactly one of the provided requirement ids. Do not invent topics.",
].join("\n");

export async function generateFlashcards(
  requirements: Requirement[],
  // Company/role context is deliberately not threaded into either prompt below —
  // it's a source of the same job-framing leakage this module exists to avoid,
  // and flashcards are meant to be general recall of the underlying skill, not
  // company-specific flavour (that's what company-fit questions are for).
  _ctx: GenerationContext,
  llm: LlmClientLike,
  alloc: IdAllocator,
  perRequirement = 2,
): Promise<Flashcard[]> {
  const targets = requirements.slice(0, 12);
  if (targets.length === 0) return [];

  const cards = await attempt(targets, llm, alloc, perRequirement, false);

  const covered = new Set(cards.map((c) => c.requirement_ids[0]));
  const stillMissing = targets.filter((r) => !covered.has(r.id));
  if (stillMissing.length > 0) {
    const retried = await attempt(stillMissing, llm, alloc, perRequirement, true);
    cards.push(...retried);
  }

  return cards;
}

async function attempt(
  targets: Requirement[],
  llm: LlmClientLike,
  alloc: IdAllocator,
  perRequirement: number,
  isRetry: boolean,
): Promise<Flashcard[]> {
  const topics = await deriveTopics(targets, llm, isRetry);
  return draftCardsFromTopics(topics, llm, alloc, perRequirement, isRetry);
}

async function deriveTopics(
  targets: Requirement[],
  llm: LlmClientLike,
  isRetry: boolean,
): Promise<Map<string, string>> {
  const prompt = [
    "Reduce each requirement to its underlying knowledge topic:",
    targets.map((r) => `- ${r.id} [${r.priority}] "${r.text}"`).join("\n"),
    ...(isRetry
      ? [
          "",
          "Your previous topic for one or more of these still referenced the job,",
          "role, degree, or posting, or you skipped one that does have an",
          "inferable domain. A degree in a named field always implies that",
          "field's core concepts as a fair topic — try again.",
        ]
      : []),
    'Return JSON: {"topics": [{"requirement_id": string, "topic": string, "skip": boolean}]}',
  ].join("\n");

  const out = await llm.generateJson(topicsOutput, {
    purpose: isRetry ? "flashcard-topics:retry" : "flashcard-topics",
    system: TOPIC_SYSTEM,
    prompt,
    maxOutputTokens: 1500,
  });

  const valid = new Set(targets.map((r) => r.id));
  const topics = new Map<string, string>();
  for (const t of out.topics) {
    if (!valid.has(t.requirement_id) || t.skip) continue;
    const topic = t.topic.trim();
    if (!topic || mentionsPostingFraming(topic)) continue; // failed extraction, not a card to write
    topics.set(t.requirement_id, topic);
  }
  return topics;
}

async function draftCardsFromTopics(
  topics: Map<string, string>,
  llm: LlmClientLike,
  alloc: IdAllocator,
  perRequirement: number,
  isRetry: boolean,
): Promise<Flashcard[]> {
  if (topics.size === 0) return [];

  const prompt = [
    "Write flashcards for these topics:",
    [...topics.entries()].map(([id, topic]) => `- ${id}: ${topic}`).join("\n"),
    "",
    `About ${perRequirement} cards per topic.`,
    ...(isRetry
      ? [
          "",
          "Your previous cards for these topics still referenced a job, role, or",
          "posting and were rejected. Write only about the subject matter itself.",
        ]
      : []),
    'Return JSON: {"flashcards": [{"requirement_id": string, "front": string, "back": string}]}',
  ].join("\n");

  const out = await llm.generateJson(cardsOutput, {
    purpose: isRetry ? "flashcards:retry" : "flashcards",
    system: CARD_SYSTEM,
    prompt,
    maxOutputTokens: 3000,
  });

  const valid = new Set(topics.keys());
  return out.flashcards
    .filter((c) => valid.has(c.requirement_id) && !isPostingFramed([c.front, c.back]))
    .map((c) => ({
      id: alloc.next("f"),
      front: c.front.trim(),
      back: c.back.trim(),
      requirement_ids: [c.requirement_id],
    }));
}
