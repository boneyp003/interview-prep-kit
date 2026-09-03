"use client";

import type { ProgressResponse } from "@/lib/types";
import { Spinner } from "@/components/ui";

const STEP_LABELS: Record<string, string> = {
  "extract-requirements": "Reading the job description",
  "crawl-company": "Crawling the company site",
  "find-interview-discussion": "Looking for interview discussion",
  "analyse-hiring-process": "Working out how they hire",
  "company-brief": "Writing the company brief",
  "plan-questions": "Planning the question bank",
  "generate-questions": "Generating questions",
  "coverage-pass": "Checking every requirement is covered",
  "generate-flashcards": "Building flashcards",
  "build-schedule": "Laying out the study schedule",
  assemble: "Assembling the kit",
  validate: "Validating",
};

export function GenerationProgress({ progress }: { progress: ProgressResponse | null }) {
  const events = progress?.progress ?? [];
  const seen = new Map<string, { status: string; detail?: string }>();
  for (const e of events) {
    const prev = seen.get(e.step);
    if (!prev || rank(e.status) >= rank(prev.status)) seen.set(e.step, { status: e.status, detail: e.detail });
  }

  return (
    <div className="space-y-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-center gap-2">
        <Spinner />
        <p className="font-medium">Building your kit…</p>
      </div>
      <ol className="space-y-1.5 text-sm">
        {Object.keys(STEP_LABELS).map((step) => {
          const s = seen.get(step);
          return (
            <li key={step} className="flex items-start gap-2">
              <span aria-hidden className="mt-0.5">
                {!s ? "○" : s.status === "error" ? "✗" : s.status === "skip" ? "◑" : s.status === "done" ? "●" : "◔"}
              </span>
              <span className={!s ? "text-black/40 dark:text-white/40" : undefined}>
                {STEP_LABELS[step]}
                {s?.detail && <span className="text-black/50 dark:text-white/50"> — {s.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {progress?.warnings && progress.warnings.length > 0 && (
        <details className="text-xs text-black/60 dark:text-white/60">
          <summary>{progress.warnings.length} note(s)</summary>
          <ul className="mt-1 list-disc pl-5">
            {progress.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function rank(status: string): number {
  return { start: 1, info: 2, skip: 3, error: 3, done: 4 }[status] ?? 0;
}
