import type { Flashcard, Question, QuestionCategory } from "../schema/kit.js";
import { IdAllocator } from "../util/ids.js";

/**
 * Builder state model (brief Section 6 — "the hardest state problem").
 *
 * The kit itself always stays in canonical Appendix A shape. Provenance lives
 * in a parallel overlay keyed by item id:
 *
 *   origin  "generated" | "user"   — who created this item
 *   edited  boolean                — a generated item the user has since changed
 *   pinned  boolean                — user asked to keep this across regenerations
 *
 * Regenerating a section replaces only the items that are `generated && !edited
 * && !pinned`. A hand-written question (`origin: "user"`) or a generated one the
 * user touched (`edited`) survives a regeneration of its category. Items in
 * other sections are never looked at.
 */

export type ItemOrigin = "generated" | "user";

export interface ItemState {
  origin: ItemOrigin;
  edited: boolean;
  pinned: boolean;
  updatedAt: string;
}

export type ItemStateMap = Record<string, ItemState>;

export interface SectionFlags {
  /** The user has hand-edited this derived section (currently: schedule, brief). */
  edited: boolean;
}

export function generatedState(now = new Date()): ItemState {
  return { origin: "generated", edited: false, pinned: false, updatedAt: now.toISOString() };
}

export function userState(now = new Date()): ItemState {
  return { origin: "user", edited: false, pinned: false, updatedAt: now.toISOString() };
}

/** Overlay for a freshly generated kit — every question and flashcard is generated. */
export function initialItemState(
  ids: { questions: Question[]; flashcards: Flashcard[] },
  now = new Date(),
): ItemStateMap {
  const map: ItemStateMap = {};
  for (const q of ids.questions) map[q.id] = generatedState(now);
  for (const f of ids.flashcards) map[f.id] = generatedState(now);
  return map;
}

export function isProtected(state: ItemState | undefined): boolean {
  if (!state) return true; // unknown provenance -> never silently drop
  return state.origin === "user" || state.edited || state.pinned;
}

export interface RegenerateQuestionsResult {
  questions: Question[];
  itemState: ItemStateMap;
  removedIds: string[];
  addedIds: string[];
}

/**
 * Merge a fresh batch of generated questions for one category into the kit.
 *
 * Kept: every question outside `category`, plus in-category questions the user
 * wrote, edited, or pinned. Dropped: in-category questions that are still
 * untouched generated output. Added: the fresh questions, with new stable ids.
 */
export function regenerateQuestionCategory(params: {
  existing: Question[];
  itemState: ItemStateMap;
  category: QuestionCategory;
  fresh: Omit<Question, "id">[];
  now?: Date;
}): RegenerateQuestionsResult {
  const now = params.now ?? new Date();
  const nextState: ItemStateMap = { ...params.itemState };

  const kept: Question[] = [];
  const removedIds: string[] = [];

  for (const q of params.existing) {
    if (q.category !== params.category) {
      kept.push(q);
      continue;
    }
    if (isProtected(nextState[q.id])) {
      kept.push(q);
      continue;
    }
    removedIds.push(q.id);
    delete nextState[q.id];
  }

  const alloc = new IdAllocator([
    ...params.existing.map((q) => q.id),
    ...Object.keys(params.itemState),
  ]);
  const added: Question[] = [];
  const addedIds: string[] = [];
  for (const draft of params.fresh) {
    const id = alloc.next("q");
    added.push({ ...draft, id });
    addedIds.push(id);
    nextState[id] = generatedState(now);
  }

  return {
    questions: [...kept, ...added],
    itemState: nextState,
    removedIds,
    addedIds,
  };
}

/**
 * After questions change, the schedule may reference ids that no longer exist,
 * and new questions may be unscheduled. This prunes dangling references and
 * appends genuinely new question ids to the lightest day — but only when the
 * user has not hand-edited the schedule. An edited schedule is left alone except
 * for pruning dead refs (which would otherwise fail structural validation).
 */
export function reconcileScheduleQuestionIds(params: {
  schedule: { days: { question_ids: string[]; minutes: number }[] };
  validQuestionIds: Set<string>;
  newQuestionIds: string[];
  scheduleEdited: boolean;
}): void {
  for (const day of params.schedule.days) {
    day.question_ids = day.question_ids.filter((id) => params.validQuestionIds.has(id));
  }
  if (params.scheduleEdited || params.newQuestionIds.length === 0 || params.schedule.days.length === 0) {
    return;
  }
  let lightest = params.schedule.days[0]!;
  for (const day of params.schedule.days) {
    if (day.question_ids.length < lightest.question_ids.length) lightest = day;
  }
  lightest.question_ids.push(...params.newQuestionIds);
}
