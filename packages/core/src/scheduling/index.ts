import type { Question, Requirement, Schedule, ScheduleDay } from "../schema/kit.js";

/**
 * DETERMINISTIC schedule allocation (brief Section 8). No model involvement:
 * this is arithmetic over the questions and the day count.
 *
 * Guarantees:
 *   - exactly `daysAvailable` days, numbered 1..N
 *   - every question is placed on some day
 *   - every `must` requirement is represented (follows from placing every
 *     question, given coverage has already run)
 *   - harder / higher-priority questions land on earlier days
 *   - each day has a focus, question ids, and an integer minute total
 *
 * Two extremes the brief calls out:
 *   - 1 day  -> everything on day 1 (honest, possibly long)
 *   - 60 day -> the study material front-loads; later days become spaced
 *               revision days that revisit earlier questions
 */

export interface ScheduleInput {
  daysAvailable: number;
  questions: Question[];
  requirements: Requirement[];
}

const MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 15, 2: 25, 3: 40 };
const SYSTEM_DESIGN_BONUS = 15;
const REVISION_MINUTES = 20;

interface Weighted {
  question: Question;
  weight: number;
  minutes: number;
}

export function buildSchedule(input: ScheduleInput): Schedule {
  const days = Math.max(1, Math.floor(input.daysAvailable));
  const priorityById = new Map(input.requirements.map((r) => [r.id, r.priority]));

  const weighted: Weighted[] = input.questions
    .map((question) => {
      const isMust = question.requirement_ids.some((id) => priorityById.get(id) === "must");
      const minutes =
        (MINUTES_BY_DIFFICULTY[question.difficulty] ?? 25) +
        (question.category === "system-design" ? SYSTEM_DESIGN_BONUS : 0);
      // higher-priority first, then harder first, then a stable tiebreak
      const weight = (isMust ? 100 : 0) + question.difficulty * 10;
      return { question, weight, minutes };
    })
    .sort((a, b) => b.weight - a.weight || a.question.id.localeCompare(b.question.id));

  const buckets: Weighted[][] = Array.from({ length: days }, () => []);

  if (weighted.length > 0) {
    const studyDays = Math.min(days, weighted.length);

    // Balance by count first (so no day is dumped with the remainder), then let
    // minutes fall out. Walking the weight-sorted list into day 1, day 2, … in
    // rounds keeps the hardest / highest-priority material on the earliest days.
    const base = Math.floor(weighted.length / studyDays);
    const remainder = weighted.length % studyDays;
    let cursor = 0;
    for (let d = 0; d < studyDays; d++) {
      const take = base + (d < remainder ? 1 : 0); // extra items go to the earliest days
      for (let n = 0; n < take; n++) buckets[d]!.push(weighted[cursor++]!);
    }

    fillRevisionDays(buckets, weighted, studyDays);
  }

  const scheduleDays: ScheduleDay[] = buckets.map((items, i) => {
    const isRevision = items.length > 0 && i >= Math.min(days, weighted.length);
    const minutes = isRevision
      ? items.length * REVISION_MINUTES
      : items.reduce((sum, w) => sum + w.minutes, 0);
    return {
      day: i + 1,
      focus: focusFor(items, input.requirements, isRevision, items.length === 0),
      question_ids: items.map((w) => w.question.id),
      minutes,
    };
  });

  return { days_available: days, days: scheduleDays };
}

/**
 * When there are more days than questions, later days revisit earlier questions
 * on an expanding interval (a light spaced-repetition pass) so no day is empty
 * and hard material gets a second look.
 */
function fillRevisionDays(buckets: Weighted[][], weighted: Weighted[], studyDays: number): void {
  const extraDays = buckets.length - studyDays;
  if (extraDays <= 0) return;

  // Revisit hardest-first, cycling through the pool.
  const pool = [...weighted].sort((a, b) => b.weight - a.weight);
  const perRevisionDay = Math.max(1, Math.ceil(pool.length / Math.max(1, extraDays)));
  let cursor = 0;
  for (let d = studyDays; d < buckets.length; d++) {
    for (let k = 0; k < perRevisionDay && pool.length > 0; k++) {
      buckets[d]!.push(pool[cursor % pool.length]!);
      cursor++;
    }
  }
}

function focusFor(
  items: Weighted[],
  requirements: Requirement[],
  isRevision: boolean,
  isEmpty: boolean,
): string {
  if (isEmpty) return "Rest / light review";
  const reqText = new Map(requirements.map((r) => [r.id, r.text]));
  const topics: string[] = [];
  for (const w of items) {
    for (const rid of w.question.requirement_ids) {
      const text = reqText.get(rid);
      if (text && !topics.includes(text)) topics.push(text);
    }
    if (topics.length >= 2) break;
  }
  const label = topics.length ? topics.map(shorten).join(" · ") : dominantCategory(items);
  return isRevision ? `Revision: ${label}` : label;
}

function dominantCategory(items: Weighted[]): string {
  const counts = new Map<string, number>();
  for (const w of items) counts.set(w.question.category, (counts.get(w.question.category) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "review";
  return `${top} practice`;
}

function shorten(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= 48 ? trimmed : trimmed.slice(0, 45).trimEnd() + "…";
}
