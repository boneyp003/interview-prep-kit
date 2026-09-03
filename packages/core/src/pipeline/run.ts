import type { CoreConfig } from "../config/index.js";
import {
  assessKitQuality,
  validateKit,
  type Coverage,
  type Kit,
  type Question,
  type Requirement,
} from "../schema/kit.js";
import { createRetrieval, type CrawledPage, type SkippedSource } from "../retrieval/index.js";
import { createLlm, LlmError, type LlmClientLike } from "../generation/llm/index.js";
import { extractRequirements } from "../extraction/requirements.js";
import { analyseHiringProcess, type HiringProcess } from "../generation/hiring-process.js";
import { generateCompanyBrief } from "../generation/company-brief.js";
import { planQuestionGeneration } from "../generation/question-plan.js";
import {
  generateQuestionsForCategory,
  generateQuestionsForRequirement,
  type GenerationContext,
} from "../generation/questions.js";
import { generateFlashcards } from "../generation/flashcards.js";
import { checkCoverage, planGapFill } from "../coverage/index.js";
import { buildSchedule } from "../scheduling/index.js";
import { IdAllocator } from "../util/ids.js";
import {
  PIPELINE_STEPS,
  PipelineError,
  type PipelineDeps,
  type PipelineInput,
  type PipelineOutcome,
  type PipelineStep,
  type PipelineWarning,
  type ProgressEvent,
} from "./types.js";

const MAX_COVERAGE_PASSES = 3;

/**
 * The orchestrator. Runs the steps in a deliberate order where each step
 * consumes what the previous ones actually found:
 *
 *   1. requirements come from the pasted JD alone (no retrieval)
 *   2. the company site is crawled and its links ranked
 *   3. public interview discussion is searched for
 *   4. hiring pages + discussion are distilled into a structured process
 *   5. that process changes which question categories step 6 generates
 *   6. questions are generated per (requirement-set, category)
 *   7. a deterministic coverage check finds gaps; step 6 is re-run for them,
 *      looping until must-haves are covered or MAX_COVERAGE_PASSES
 *   8-10. flashcards, then the deterministic schedule
 *   11-12. assemble and structurally validate
 *
 * A retrieval source that fails is skipped and recorded, never fatal. The only
 * fatal outcomes: the LLM is unavailable/unauthorised, or the assembled kit
 * fails structural validation and cannot be repaired.
 */
export async function runPipeline(
  input: PipelineInput,
  deps: PipelineDeps,
): Promise<PipelineOutcome> {
  const now = deps.now ?? (() => new Date());
  const warnings: PipelineWarning[] = [];
  const skipped: SkippedSource[] = [];

  const emit = (
    step: PipelineStep,
    status: ProgressEvent["status"],
    detail?: string,
  ): void => {
    deps.onProgress?.({ step, status, at: now().toISOString(), ...(detail ? { detail } : {}) });
  };
  const warn = (step: PipelineStep, message: string): void => {
    warnings.push({ step, message });
    emit(step, "info", message);
  };

  const retrieval =
    deps.retrieval ??
    createRetrieval(deps.config, {
      ...(deps.allowPrivateAddresses !== undefined
        ? { allowPrivateAddresses: deps.allowPrivateAddresses }
        : {}),
    });
  const llm: LlmClientLike = deps.llm ?? createLlm(deps.config);

  // ── 1. Requirements from the JD ──────────────────────────────────────────
  emit("extract-requirements", "start");
  const role = await guardLlm("extract-requirements", () => extractRequirements(input.jd, llm));
  for (const note of role.notes) warn("extract-requirements", note);
  emit("extract-requirements", "done", `${role.requirements.length} requirements`);

  // ── 2. Crawl the company site ────────────────────────────────────────────
  emit("crawl-company", "start", input.companyUrl);
  let crawlPages: CrawledPage[] = [];
  let companyName = guessCompanyName(input.companyUrl, "");
  try {
    const crawl = await retrieval.crawlSite(input.companyUrl);
    skipped.push(...crawl.skipped);
    crawlPages = crawl.pages;
    companyName = guessCompanyName(input.companyUrl, crawl.entry?.title ?? "");
    if (!crawl.entry) {
      warn("crawl-company", `Company site could not be retrieved (${input.companyUrl}).`);
      emit("crawl-company", "skip");
    } else {
      emit("crawl-company", "done", `${crawlPages.length} pages`);
    }
  } catch (err) {
    warn("crawl-company", `Crawl failed: ${errText(err)}`);
    emit("crawl-company", "skip");
  }

  const hiringPages = crawlPages.filter((p) => p.intent === "hiring");
  const aboutPages = crawlPages.filter((p) => p.intent === "entry" || p.intent === "about");

  // ── 3. Public interview discussion ──────────────────────────────────────
  emit("find-interview-discussion", "start", companyName);
  let discussion: Awaited<ReturnType<typeof retrieval.searchInterviewDiscussion>>["results"] = [];
  try {
    const out = await retrieval.searchInterviewDiscussion(companyName);
    skipped.push(...out.skipped);
    discussion = out.results;
    emit(
      "find-interview-discussion",
      discussion.length ? "done" : "skip",
      `${discussion.length} results`,
    );
    if (discussion.length === 0) {
      warn("find-interview-discussion", "No public discussion of the interview process was found.");
    }
  } catch (err) {
    warn("find-interview-discussion", `Search failed: ${errText(err)}`);
    emit("find-interview-discussion", "skip");
  }

  // ── 4. Distil the hiring process ────────────────────────────────────────
  emit("analyse-hiring-process", "start");
  let hiring: HiringProcess = {
    found: false,
    stages: [],
    formats: [],
    themes: [],
    summary: "",
    sources: [],
  };
  if (hiringPages.length > 0 || discussion.length > 0) {
    try {
      hiring = await analyseHiringProcess(hiringPages, discussion, llm);
      emit(
        "analyse-hiring-process",
        hiring.found ? "done" : "skip",
        hiring.found ? hiring.formats.join(", ") : "no process described",
      );
    } catch (err) {
      if (fatalLlm(err)) throw toPipelineError(err);
      warn("analyse-hiring-process", `Could not analyse hiring process: ${errText(err)}`);
      emit("analyse-hiring-process", "skip");
    }
  } else {
    emit("analyse-hiring-process", "skip", "nothing to analyse");
  }

  // ── 5. Company brief ────────────────────────────────────────────────────
  emit("company-brief", "start");
  const briefPages = dedupePages([...aboutPages, ...crawlPages]).slice(0, 6);
  const companyBrief = await guardLlm("company-brief", () =>
    generateCompanyBrief(companyName, briefPages, llm),
  );
  if (companyBrief.sources.length === 0) {
    warn("company-brief", "Company brief is based on no retrieved pages; treat it as incomplete.");
  }
  emit("company-brief", "done");

  const ctx: GenerationContext = {
    companyName,
    roleTitle: role.title || guessRoleFromJd(input.jd),
    hiring,
  };

  // ── 6. Plan + generate questions ───────────────────────────────────────
  const alloc = new IdAllocator([
    ...role.requirements.map((r) => r.id),
  ]);
  let questions: Question[] = [];

  if (role.requirements.length === 0) {
    warn("generate-questions", "No requirements to generate questions from; kit will be minimal.");
    emit("plan-questions", "skip");
    emit("generate-questions", "skip");
  } else {
    emit("plan-questions", "start");
    const plans = planQuestionGeneration(role.requirements, hiring);
    emit("plan-questions", "done", plans.map((p) => `${p.category}×${p.items.length}`).join(" "));

    emit("generate-questions", "start");
    for (const plan of plans) {
      try {
        const generated = await generateQuestionsForCategory(plan, ctx, llm, alloc);
        questions.push(...generated);
        emit("generate-questions", "info", `${plan.category}: ${generated.length}`);
      } catch (err) {
        if (fatalLlm(err)) throw toPipelineError(err);
        warn("generate-questions", `Category "${plan.category}" failed: ${errText(err)}`);
      }
    }
    emit("generate-questions", "done", `${questions.length} questions`);
  }

  // ── 7. Coverage second pass ────────────────────────────────────────────
  const coveragePasses = await closeCoverageGaps(
    role.requirements,
    questions,
    hiring,
    ctx,
    llm,
    alloc,
    (message) => warn("coverage-pass", message),
    (status, detail) => emit("coverage-pass", status, detail),
  );

  // ── 8. Flashcards ─────────────────────────────────────────────────────
  emit("generate-flashcards", "start");
  let flashcards: Kit["flashcards"] = [];
  if (role.requirements.length > 0) {
    try {
      flashcards = await generateFlashcards(role.requirements, ctx, llm, alloc);
      emit("generate-flashcards", "done", `${flashcards.length} cards`);
    } catch (err) {
      if (fatalLlm(err)) throw toPipelineError(err);
      warn("generate-flashcards", `Flashcard generation failed: ${errText(err)}`);
      emit("generate-flashcards", "skip");
    }
  } else {
    emit("generate-flashcards", "skip");
  }

  // ── 9. Deterministic schedule ─────────────────────────────────────────
  emit("build-schedule", "start", `${input.days} days`);
  const schedule = buildSchedule({
    daysAvailable: input.days,
    questions,
    requirements: role.requirements,
  });
  emit("build-schedule", "done");

  // ── 10. Assemble ─────────────────────────────────────────────────────
  emit("assemble", "start");
  const finalCoverage = checkCoverage(role.requirements, questions);
  const coverage: Coverage = {
    uncovered_requirement_ids: finalCoverage.uncoveredRequirementIds,
    passes: coveragePasses,
  };
  const pagesUsed = dedupe([
    ...crawlPages.map((p) => p.url),
    ...discussion.map((d) => d.url),
  ]);

  const kit: Kit = {
    source: {
      company: companyName,
      company_url: input.companyUrl,
      role: role.title || ctx.roleTitle,
      location: guessLocation(input.jd),
      jd_chars: input.jd.length,
      pages_used: pagesUsed,
      researched_at: now().toISOString(),
    },
    company_brief: companyBrief,
    role: {
      title: role.title || ctx.roleTitle,
      seniority: role.seniority,
      responsibilities: role.responsibilities,
      requirements: role.requirements,
    },
    questions,
    flashcards,
    schedule,
    coverage,
  };
  emit("assemble", "done");

  // ── 11. Validate ─────────────────────────────────────────────────────
  emit("validate", "start");
  const validation = validateKit(kit);
  if (!validation.ok) {
    emit("validate", "error", validation.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    throw new PipelineError(
      "VALIDATION_FAILED",
      `Assembled kit failed structural validation: ${validation.issues
        .map((i) => `${i.path} ${i.message}`)
        .join("; ")}`,
    );
  }
  for (const w of assessKitQuality(kit)) warn("validate", w);
  emit("validate", "done");

  if (finalCoverage.uncoveredMustIds.length > 0) {
    warn(
      "coverage-pass",
      `${finalCoverage.uncoveredMustIds.length} must-have requirement(s) remain uncovered after ${coveragePasses} passes: ${finalCoverage.uncoveredMustIds.join(", ")}`,
    );
  }

  return {
    kit,
    warnings,
    skipped,
    llmCalls: llm.log,
    coveragePasses,
    research: {
      companyName,
      roleTitle: ctx.roleTitle,
      pages: dedupePages(crawlPages).map((p) => ({
        url: p.url,
        title: p.title,
        description: p.description,
        text: p.text,
      })),
      discussion,
      hiring,
    },
  };
}

/**
 * The loop the coverage check exists to force. Each pass generates questions for
 * every currently-uncovered requirement, then re-checks. Stops when nothing is
 * uncovered, when a pass makes no progress, or at MAX_COVERAGE_PASSES.
 * Returns the number of coverage checks performed (>= 1).
 */
async function closeCoverageGaps(
  requirements: Requirement[],
  questions: Question[],
  hiring: HiringProcess,
  ctx: GenerationContext,
  llm: LlmClientLike,
  alloc: IdAllocator,
  warn: (message: string) => void,
  emit: (status: ProgressEvent["status"], detail?: string) => void,
): Promise<number> {
  if (requirements.length === 0) return 0;

  emit("start");
  let passes = 1;
  let report = checkCoverage(requirements, questions);
  emit("info", `pass ${passes}: ${report.uncoveredRequirementIds.length} uncovered`);

  while (report.uncoveredRequirementIds.length > 0 && passes < MAX_COVERAGE_PASSES) {
    const before = report.uncoveredRequirementIds.length;
    const uncoveredReqs = requirements.filter((r) =>
      report.uncoveredRequirementIds.includes(r.id),
    );
    const tasks = planGapFill(uncoveredReqs, hiring);

    for (const task of tasks) {
      try {
        const generated = await generateQuestionsForRequirement(
          task.item,
          task.category,
          ctx,
          llm,
          alloc,
          task.item.targetCount,
        );
        questions.push(...generated);
      } catch (err) {
        if (fatalLlm(err)) throw toPipelineError(err);
        warn(`Gap fill for "${task.item.requirementId}" failed: ${errText(err)}`);
      }
    }

    passes++;
    report = checkCoverage(requirements, questions);
    emit("info", `pass ${passes}: ${report.uncoveredRequirementIds.length} uncovered`);

    if (report.uncoveredRequirementIds.length >= before) {
      warn(`Coverage pass ${passes} made no progress; stopping.`);
      break;
    }
  }

  emit("done", `${passes} passes, ${report.uncoveredRequirementIds.length} uncovered`);
  return passes;
}

// ── helpers ──────────────────────────────────────────────────────────────

async function guardLlm<T>(step: PipelineStep, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toPipelineError(err, step);
  }
}

/**
 * Only a bad/absent API key is fatal to the whole run. A rate-limit that
 * survives every retry fails just the current step; whether that sinks the kit
 * depends on the step (a failed requirement extraction leaves nothing to build;
 * a failed question category only degrades coverage).
 */
function fatalLlm(err: unknown): boolean {
  return err instanceof LlmError && err.code === "AUTH";
}

function toPipelineError(err: unknown, step?: PipelineStep): PipelineError {
  if (err instanceof PipelineError) return err;
  if (err instanceof LlmError) {
    const code =
      err.code === "AUTH"
        ? "LLM_UNAVAILABLE"
        : err.code === "RATE_LIMITED"
          ? "LLM_RATE_LIMITED"
          : "GENERATION_FAILED";
    return new PipelineError(code, `${step ? step + ": " : ""}${err.message}`);
  }
  return new PipelineError("GENERATION_FAILED", `${step ? step + ": " : ""}${errText(err)}`);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function guessCompanyName(companyUrl: string, pageTitle: string): string {
  // Prefer the part of the <title> before a separator; fall back to the host.
  const fromTitle = pageTitle.split(/[|–—\-:·]/)[0]?.trim();
  if (fromTitle && fromTitle.length >= 2 && fromTitle.length <= 40) return fromTitle;
  try {
    const host = new URL(companyUrl).hostname.replace(/^www\./, "");
    const label = host.split(".")[0] ?? host;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return "";
  }
}

function guessRoleFromJd(jd: string): string {
  const firstLine = jd.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return firstLine.length > 0 && firstLine.length <= 80 ? firstLine : "";
}

function guessLocation(jd: string): string {
  const match = jd.match(/\b(remote|hybrid|on-?site)\b/i);
  return match ? match[1]!.toLowerCase() : "";
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)];
}

function dedupePages(pages: CrawledPage[]): CrawledPage[] {
  const seen = new Set<string>();
  const out: CrawledPage[] = [];
  for (const p of pages) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p);
  }
  return out;
}

export { PIPELINE_STEPS };
