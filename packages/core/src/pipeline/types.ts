import type { CoreConfig } from "../config/index.js";
import type { Kit } from "../schema/kit.js";
import type { Retrieval, SkippedSource } from "../retrieval/index.js";
import type { LlmCallLog, LlmClientLike } from "../generation/llm/index.js";

export interface PipelineInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export const PIPELINE_STEPS = [
  "extract-requirements",
  "crawl-company",
  "find-interview-discussion",
  "analyse-hiring-process",
  "company-brief",
  "plan-questions",
  "generate-questions",
  "coverage-pass",
  "generate-flashcards",
  "build-schedule",
  "assemble",
  "validate",
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export interface ProgressEvent {
  step: PipelineStep;
  status: "start" | "done" | "skip" | "error" | "info";
  detail?: string;
  at: string;
}

export type ProgressListener = (event: ProgressEvent) => void;

export interface PipelineDeps {
  config: CoreConfig;
  /** Overrides for the retrieval SSRF policy (batch localhost fixtures). */
  allowPrivateAddresses?: boolean;
  onProgress?: ProgressListener;
  /** Injected clock, for deterministic tests. */
  now?: () => Date;
  /** Inject a shared/fake LLM client. Defaults to createLlm(config). */
  llm?: LlmClientLike;
  /** Inject a shared/fake retrieval bundle. Defaults to createRetrieval(config). */
  retrieval?: Retrieval;
}

export interface PipelineWarning {
  step: PipelineStep;
  message: string;
}

export interface PipelineOutcome {
  kit: Kit;
  warnings: PipelineWarning[];
  skipped: SkippedSource[];
  llmCalls: LlmCallLog[];
  coveragePasses: number;
}

/** Thrown only when no kit could be produced at all (Appendix B `failed`). */
export class PipelineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
  }
}
