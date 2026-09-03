import type { QuestionCategory, Requirement } from "../schema/kit.js";
import type { HiringProcess } from "./hiring-process.js";

/**
 * DETERMINISTIC routing: which question categories each requirement should
 * produce, and how many. This is code, not a prompt — it is the mechanism
 * behind "5 years of React leads to technical questions while mentoring junior
 * engineers leads to behavioural ones; the two should not come from the same
 * call with the same instructions" (brief Section 3).
 */

const SYSTEM_DESIGN_HINT =
  /\b(architect|architecture|scal(e|ing|able)|distributed|microservice|infrastructure|throughput|latency|high[- ]availability|system design|platform)\b/i;

export interface PlannedItem {
  requirementId: string;
  text: string;
  priority: Requirement["priority"];
  targetCount: number;
  difficultyFloor: number;
  difficultyCeiling: number;
}

export interface CategoryPlan {
  category: QuestionCategory;
  items: PlannedItem[];
}

export function categoriesForRequirement(
  req: Requirement,
  hiring: HiringProcess,
): QuestionCategory[] {
  const categories = new Set<QuestionCategory>();

  if (req.kind === "technical") {
    categories.add("technical");
    if (hiring.formats.includes("system-design") || SYSTEM_DESIGN_HINT.test(req.text)) {
      categories.add("system-design");
    }
  } else if (req.kind === "behavioural") {
    categories.add("behavioural");
    if (hiring.formats.includes("values-interview") || hiring.formats.includes("behavioural")) {
      categories.add("company-fit");
    }
  } else {
    // domain knowledge is probed both for depth and for fit
    categories.add("technical");
    categories.add("company-fit");
  }

  return [...categories];
}

export function planQuestionGeneration(
  requirements: Requirement[],
  hiring: HiringProcess,
  opts: { firstPassBudget?: number } = {},
): CategoryPlan[] {
  const budget = opts.firstPassBudget ?? 24;

  // must-haves first, then nice-to-haves, so a tight budget still covers musts.
  const ordered = [...requirements].sort((a, b) => rank(b) - rank(a));

  const byCategory = new Map<QuestionCategory, PlannedItem[]>();
  let planned = 0;

  for (const req of ordered) {
    const isMust = req.priority === "must";
    const perCategory = isMust ? 2 : 1;
    for (const category of categoriesForRequirement(req, hiring)) {
      if (planned >= budget && !isMust) continue; // always keep musts
      const item: PlannedItem = {
        requirementId: req.id,
        text: req.text,
        priority: req.priority,
        targetCount: perCategory,
        difficultyFloor: isMust ? 2 : 1,
        difficultyCeiling: isMust ? 3 : 2,
      };
      const list = byCategory.get(category) ?? [];
      list.push(item);
      byCategory.set(category, list);
      planned += perCategory;
    }
  }

  return [...byCategory.entries()].map(([category, items]) => ({ category, items }));
}

function rank(req: Requirement): number {
  return req.priority === "must" ? 10 : 0;
}
