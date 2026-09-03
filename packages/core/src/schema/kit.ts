import { z } from "zod";

/**
 * Appendix A — Kit Structure.
 *
 * Field names match the brief exactly. The brief allows extension but not
 * renaming or removal, so every named field below is required. Extensions we
 * add (e.g. builder state) live OUTSIDE this schema and are stripped before a
 * kit is validated or exported for evaluation.
 */

export const REQUIREMENT_KINDS = ["technical", "behavioural", "domain"] as const;
export const REQUIREMENT_PRIORITIES = ["must", "nice"] as const;
export const QUESTION_CATEGORIES = [
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

const isoString = z.string().min(1);
const url = z.string().url();

export const sourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().nonnegative(),
  pages_used: z.array(z.string()),
  researched_at: isoString,
});

export const companyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
});

export const requirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(REQUIREMENT_PRIORITIES),
});

export const roleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(requirementSchema),
});

export const questionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: z.string(),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
});

export const flashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string(),
  back: z.string(),
  requirement_ids: z.array(z.string().min(1)),
});

export const scheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(z.string().min(1)),
  minutes: z.number().int().nonnegative(),
});

export const scheduleSchema = z.object({
  days_available: z.number().int().positive(),
  days: z.array(scheduleDaySchema),
});

export const coverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().nonnegative(),
});

export const kitSchema = z.object({
  source: sourceSchema,
  company_brief: companyBriefSchema,
  role: roleSchema,
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: scheduleSchema,
  coverage: coverageSchema,
});

export type Kit = z.infer<typeof kitSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type CompanyBrief = z.infer<typeof companyBriefSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
export type ScheduleDay = z.infer<typeof scheduleDaySchema>;

export interface StructuralIssue {
  path: string;
  message: string;
}

/**
 * Cross-field integrity checks the brief calls out explicitly:
 *  - every id is unique within its collection
 *  - every question.requirement_ids entry references a real requirement
 *  - every flashcard.requirement_ids entry references a real requirement
 *  - every schedule question_id references a real question
 *  - schedule length equals days_available
 *  - every `must` requirement is covered by at least one question AND
 *    appears somewhere in the schedule
 *  - coverage.uncovered_requirement_ids is consistent with the questions
 *
 * Kept separate from the Zod shape so callers can run shape and integrity
 * checks independently and report precise reasons.
 */
export function checkKitIntegrity(kit: Kit): StructuralIssue[] {
  const issues: StructuralIssue[] = [];

  const dupes = (ids: string[], label: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push({ path: label, message: `duplicate id "${id}"` });
      seen.add(id);
    }
  };

  const reqIds = kit.role.requirements.map((r) => r.id);
  const qIds = kit.questions.map((q) => q.id);
  dupes(reqIds, "role.requirements");
  dupes(qIds, "questions");
  dupes(kit.flashcards.map((f) => f.id), "flashcards");

  const reqIdSet = new Set(reqIds);
  const qIdSet = new Set(qIds);

  kit.questions.forEach((q, i) => {
    for (const rid of q.requirement_ids) {
      if (!reqIdSet.has(rid)) {
        issues.push({ path: `questions[${i}]`, message: `unknown requirement_id "${rid}"` });
      }
    }
  });

  kit.flashcards.forEach((f, i) => {
    for (const rid of f.requirement_ids) {
      if (!reqIdSet.has(rid)) {
        issues.push({ path: `flashcards[${i}]`, message: `unknown requirement_id "${rid}"` });
      }
    }
  });

  if (kit.schedule.days.length !== kit.schedule.days_available) {
    issues.push({
      path: "schedule.days",
      message: `expected ${kit.schedule.days_available} days, got ${kit.schedule.days.length}`,
    });
  }

  const scheduledQuestionIds = new Set<string>();
  kit.schedule.days.forEach((d, i) => {
    if (d.day !== i + 1) {
      issues.push({ path: `schedule.days[${i}]`, message: `day should be ${i + 1}, got ${d.day}` });
    }
    for (const qid of d.question_ids) {
      scheduledQuestionIds.add(qid);
      if (!qIdSet.has(qid)) {
        issues.push({ path: `schedule.days[${i}]`, message: `unknown question_id "${qid}"` });
      }
    }
  });

  // Coverage: which requirements have at least one question?
  const coveredReqIds = new Set<string>();
  for (const q of kit.questions) for (const rid of q.requirement_ids) coveredReqIds.add(rid);

  for (const r of kit.role.requirements) {
    if (r.priority !== "must") continue;
    if (!coveredReqIds.has(r.id)) {
      issues.push({ path: "coverage", message: `must-have requirement "${r.id}" has no question` });
      continue;
    }
    const inSchedule = kit.questions
      .filter((q) => q.requirement_ids.includes(r.id))
      .some((q) => scheduledQuestionIds.has(q.id));
    if (!inSchedule) {
      issues.push({
        path: "schedule",
        message: `must-have requirement "${r.id}" is not represented in the schedule`,
      });
    }
  }

  // coverage.uncovered_requirement_ids must equal the true set of uncovered reqs.
  const actuallyUncovered = reqIds.filter((id) => !coveredReqIds.has(id)).sort();
  const declaredUncovered = [...kit.coverage.uncovered_requirement_ids].sort();
  if (JSON.stringify(actuallyUncovered) !== JSON.stringify(declaredUncovered)) {
    issues.push({
      path: "coverage.uncovered_requirement_ids",
      message: `declared ${JSON.stringify(declaredUncovered)} but computed ${JSON.stringify(actuallyUncovered)}`,
    });
  }

  return issues;
}

export interface KitValidation {
  ok: boolean;
  issues: StructuralIssue[];
}

/** Full gate used before persisting or emitting a kit. */
export function validateKit(value: unknown): KitValidation {
  const parsed = kitSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }
  const issues = checkKitIntegrity(parsed.data);
  return { ok: issues.length === 0, issues };
}
