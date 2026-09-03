import type { CompanyBrief, Kit, Question, QuestionCategory, Schedule } from "../schema/kit.js";
import { checkCoverage } from "../coverage/index.js";
import { buildSchedule } from "../scheduling/index.js";
import { generateCompanyBrief } from "../generation/company-brief.js";
import {
  categoriesForRequirement,
  planQuestionGeneration,
  type CategoryPlan,
} from "../generation/question-plan.js";
import { generateQuestionsForCategory, type GenerationContext } from "../generation/questions.js";
import type { LlmClientLike } from "../generation/llm/index.js";
import type { ResearchSnapshot } from "../pipeline/types.js";
import { IdAllocator } from "../util/ids.js";
import {
  regenerateQuestionCategory,
  reconcileScheduleQuestionIds,
  type ItemStateMap,
} from "./state.js";

/**
 * Section 6: "Regenerate a single section on its own — the company brief, one
 * question category, or the schedule" without discarding edits elsewhere.
 *
 * The research snapshot captured at first generation is reused so a single
 * section can be redone without re-crawling.
 */

function contextFrom(research: ResearchSnapshot): GenerationContext {
  return {
    companyName: research.companyName,
    roleTitle: research.roleTitle,
    hiring: research.hiring,
  };
}

export async function regenerateBrief(
  research: ResearchSnapshot,
  llm: LlmClientLike,
): Promise<CompanyBrief> {
  return generateCompanyBrief(
    research.companyName,
    research.pages.map((p) => ({ ...p, links: [], intent: "about" as const, depth: 1 })),
    llm,
  );
}

/** Deterministic — rebuild the schedule from the current questions. */
export function regenerateSchedule(kit: Kit): Schedule {
  return buildSchedule({
    daysAvailable: kit.schedule.days_available,
    questions: kit.questions,
    requirements: kit.role.requirements,
  });
}

export interface RegenerateCategoryResult {
  questions: Question[];
  itemState: ItemStateMap;
  schedule: Schedule;
  coverage: Kit["coverage"];
  removedIds: string[];
  addedIds: string[];
}

export async function regenerateCategory(params: {
  kit: Kit;
  itemState: ItemStateMap;
  category: QuestionCategory;
  research: ResearchSnapshot;
  scheduleEdited: boolean;
  llm: LlmClientLike;
  now?: Date;
}): Promise<RegenerateCategoryResult> {
  const { kit, category, research } = params;

  const requirementsForCategory = kit.role.requirements.filter((r) =>
    categoriesForRequirement(r, research.hiring).includes(category),
  );

  let fresh: Omit<Question, "id">[] = [];
  if (requirementsForCategory.length > 0) {
    const fullPlan = planQuestionGeneration(requirementsForCategory, research.hiring);
    const plan: CategoryPlan | undefined = fullPlan.find((p) => p.category === category);
    if (plan) {
      const throwaway = new IdAllocator();
      const generated = await generateQuestionsForCategory(
        plan,
        contextFrom(research),
        params.llm,
        throwaway,
      );
      fresh = generated.map(({ id: _id, ...rest }) => rest);
    }
  }

  const merged = regenerateQuestionCategory({
    existing: kit.questions,
    itemState: params.itemState,
    category,
    fresh,
    ...(params.now ? { now: params.now } : {}),
  });

  const validIds = new Set(merged.questions.map((q) => q.id));
  const schedule: Schedule = {
    days_available: kit.schedule.days_available,
    days: kit.schedule.days.map((d) => ({ ...d, question_ids: [...d.question_ids] })),
  };
  reconcileScheduleQuestionIds({
    schedule,
    validQuestionIds: validIds,
    newQuestionIds: merged.addedIds,
    scheduleEdited: params.scheduleEdited,
  });
  recomputeDayMinutes(schedule, merged.questions);

  const cov = checkCoverage(kit.role.requirements, merged.questions);

  return {
    questions: merged.questions,
    itemState: merged.itemState,
    schedule,
    coverage: { uncovered_requirement_ids: cov.uncoveredRequirementIds, passes: kit.coverage.passes },
    removedIds: merged.removedIds,
    addedIds: merged.addedIds,
  };
}

const MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 15, 2: 25, 3: 40 };

/** Keep each day's minute total consistent with the questions now on it. */
export function recomputeDayMinutes(schedule: Schedule, questions: Question[]): void {
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const day of schedule.days) {
    let minutes = 0;
    for (const qid of day.question_ids) {
      const q = byId.get(qid);
      if (!q) continue;
      minutes += (MINUTES_BY_DIFFICULTY[q.difficulty] ?? 25) + (q.category === "system-design" ? 15 : 0);
    }
    day.minutes = minutes;
  }
}
