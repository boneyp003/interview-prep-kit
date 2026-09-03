import type { Question, QuestionCategory, Requirement } from "../schema/kit.js";
import { categoriesForRequirement } from "../generation/question-plan.js";
import type { HiringProcess } from "../generation/hiring-process.js";
import type { PlannedItem } from "../generation/question-plan.js";

/**
 * DETERMINISTIC coverage check (brief Section 3/4). This is our code's
 * decision, never the model's: a requirement is "covered" when at least one
 * question lists its id in `requirement_ids`. The gap list this produces is
 * what drives the second pass.
 */

export interface CoverageReport {
  /** All requirements with no question against them. */
  uncoveredRequirementIds: string[];
  /** The subset that are `must` — these must be closed before the kit ships. */
  uncoveredMustIds: string[];
  /** requirementId -> number of questions referencing it. */
  countsByRequirement: Record<string, number>;
}

export function checkCoverage(requirements: Requirement[], questions: Question[]): CoverageReport {
  const counts: Record<string, number> = {};
  for (const r of requirements) counts[r.id] = 0;
  for (const q of questions) {
    for (const rid of q.requirement_ids) {
      if (rid in counts) counts[rid] = (counts[rid] ?? 0) + 1;
    }
  }

  const uncovered = requirements.filter((r) => (counts[r.id] ?? 0) === 0);
  return {
    uncoveredRequirementIds: uncovered.map((r) => r.id),
    uncoveredMustIds: uncovered.filter((r) => r.priority === "must").map((r) => r.id),
    countsByRequirement: counts,
  };
}

export interface GapTask {
  item: PlannedItem;
  category: QuestionCategory;
}

/**
 * For each uncovered requirement, choose ONE category and a small count to
 * generate against in the next pass. Deterministic: the category is the first
 * one the routing table assigns to that requirement.
 */
export function planGapFill(
  uncovered: Requirement[],
  hiring: HiringProcess,
): GapTask[] {
  return uncovered.map((req) => {
    const category = categoriesForRequirement(req, hiring)[0] ?? "technical";
    const isMust = req.priority === "must";
    return {
      category,
      item: {
        requirementId: req.id,
        text: req.text,
        priority: req.priority,
        targetCount: isMust ? 2 : 1,
        difficultyFloor: isMust ? 2 : 1,
        difficultyCeiling: isMust ? 3 : 2,
      },
    };
  });
}
