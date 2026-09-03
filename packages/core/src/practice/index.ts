import type { Flashcard } from "../schema/kit.js";

/**
 * Practice-mode scheduling (brief Section 7).
 *
 * Choice: a **confidence-weighted Leitner interval**. Each card sits in a box
 * (1..5) equal to the last confidence rating. The review interval grows with
 * the box; a low rating drops the card back to box 1. This is simpler than a
 * full SM-2 (no per-card ease factor to store or tune) but still spaces
 * well-known cards out and keeps shaky ones coming back — which is what a few
 * days of interview prep actually needs.
 *
 * Session ordering: cards the user was least confident about come first
 * (never-seen cards rank as "confidence 0"), then whatever is most overdue.
 */

export type Confidence = 1 | 2 | 3 | 4 | 5;

export interface PracticeRecord {
  lastConfidence: number;
  reviews: number;
  lastReviewedAt: string;
  dueAt: string;
}

export type PracticeMap = Record<string, PracticeRecord>;

const DAY = 24 * 60 * 60 * 1000;

/** Interval until a card is next due, by the confidence just given. */
export function nextIntervalMs(confidence: Confidence): number {
  switch (confidence) {
    case 1:
      return 10 * 60 * 1000; // 10 minutes — see it again this session
    case 2:
      return 1 * DAY;
    case 3:
      return 2 * DAY;
    case 4:
      return 4 * DAY;
    case 5:
      return 8 * DAY;
  }
}

export function recordReview(
  previous: PracticeRecord | undefined,
  confidence: Confidence,
  now: Date = new Date(),
): PracticeRecord {
  return {
    lastConfidence: confidence,
    reviews: (previous?.reviews ?? 0) + 1,
    lastReviewedAt: now.toISOString(),
    dueAt: new Date(now.getTime() + nextIntervalMs(confidence)).toISOString(),
  };
}

export interface SessionCard {
  card: Flashcard;
  record: PracticeRecord | null;
  due: boolean;
}

/**
 * Order the flashcards for the next practice session: least-confident first
 * (unseen = 0), then most overdue, then a stable id tiebreak. Cards that are
 * not yet due are still included but ranked last, so a session is never empty.
 */
export function orderForSession(
  flashcards: Flashcard[],
  practice: PracticeMap,
  now: Date = new Date(),
): SessionCard[] {
  const nowMs = now.getTime();
  return flashcards
    .map((card) => {
      const record = practice[card.id] ?? null;
      const due = !record || Date.parse(record.dueAt) <= nowMs;
      return { card, record, due };
    })
    .sort((a, b) => {
      const ca = a.record?.lastConfidence ?? 0;
      const cb = b.record?.lastConfidence ?? 0;
      if (ca !== cb) return ca - cb;
      if (a.due !== b.due) return a.due ? -1 : 1;
      const da = a.record ? Date.parse(a.record.dueAt) : 0;
      const db = b.record ? Date.parse(b.record.dueAt) : 0;
      if (da !== db) return da - db;
      return a.card.id.localeCompare(b.card.id);
    });
}

export interface PracticeSummary {
  total: number;
  reviewed: number;
  due: number;
  byConfidence: Record<string, number>;
  /** Requirement ids that have at least one reviewed flashcard. */
  practisedRequirementIds: string[];
  /** Requirement ids with flashcards none of which have been reviewed. */
  unpractisedRequirementIds: string[];
}

export function summarisePractice(
  flashcards: Flashcard[],
  practice: PracticeMap,
  now: Date = new Date(),
): PracticeSummary {
  const nowMs = now.getTime();
  const byConfidence: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let reviewed = 0;
  let due = 0;
  const practised = new Set<string>();
  const withCards = new Set<string>();

  for (const card of flashcards) {
    for (const rid of card.requirement_ids) withCards.add(rid);
    const record = practice[card.id];
    const level = record?.lastConfidence ?? 0;
    byConfidence[String(level)] = (byConfidence[String(level)] ?? 0) + 1;
    if (record) {
      reviewed++;
      if (Date.parse(record.dueAt) <= nowMs) due++;
      for (const rid of card.requirement_ids) practised.add(rid);
    } else {
      due++;
    }
  }

  return {
    total: flashcards.length,
    reviewed,
    due,
    byConfidence,
    practisedRequirementIds: [...practised].sort(),
    unpractisedRequirementIds: [...withCards].filter((r) => !practised.has(r)).sort(),
  };
}
