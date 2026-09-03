import type { CoreConfig } from "../config/index.js";
import {
  batchOutputSchema,
  type BatchErrorCode,
  type BatchKitEntry,
  type BatchOutput,
  type CaseInput,
} from "../schema/batch.js";
import { createLlm, type LlmClientLike } from "../generation/llm/index.js";
import { createRetrieval, type Retrieval } from "../retrieval/index.js";
import { runPipeline } from "../pipeline/run.js";
import { PipelineError } from "../pipeline/types.js";

/**
 * The batch runner behind `npm run evaluate`. Pure logic: takes parsed cases,
 * returns an Appendix B document. No filesystem, no argv — the CLI shell and
 * (potentially) the API both call this.
 *
 * One LLM client and one retrieval bundle are shared across every case so the
 * per-minute budget and rate limiter govern the whole run.
 */

export interface BatchOptions {
  config: CoreConfig;
  concurrency?: number;
  caseTimeoutMs?: number;
  /** Off in production; on for local-fixture eval runs. */
  allowPrivateAddresses?: boolean;
  onLog?: (message: string) => void;
  /** Emit each pipeline step as it happens (per case). */
  verbose?: boolean;
  /** Injected for tests. */
  llm?: LlmClientLike;
  retrieval?: Retrieval;
  now?: () => Date;
}

export async function runBatch(cases: CaseInput[], options: BatchOptions): Promise<BatchOutput> {
  const log = options.onLog ?? (() => {});
  const now = options.now ?? (() => new Date());
  const allowPrivate = options.allowPrivateAddresses ?? false;
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const caseTimeoutMs = options.caseTimeoutMs ?? 240_000;

  const llm = options.llm ?? createLlm(options.config);
  const retrieval =
    options.retrieval ?? createRetrieval(options.config, { allowPrivateAddresses: allowPrivate });

  const entries = await mapWithConcurrency(cases, concurrency, async (input) => {
    const t0 = Date.now();
    log(`▶ ${input.id} — ${input.days}-day, ${input.company_url}`);
    try {
      const outcome = await withTimeout(
        runPipeline(
          { jd: input.jd, companyUrl: input.company_url, days: input.days },
          {
            config: options.config,
            llm,
            retrieval,
            allowPrivateAddresses: allowPrivate,
            now,
            ...(options.verbose
              ? {
                  onProgress: (e) =>
                    log(`  ${input.id} · ${e.step} ${e.status}${e.detail ? ` — ${e.detail}` : ""}`),
                }
              : {}),
          },
        ),
        caseTimeoutMs,
        `case exceeded ${Math.round(caseTimeoutMs / 1000)}s`,
      );
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      log(
        `✔ ${input.id} — ${outcome.kit.questions.length} questions, ${outcome.coveragePasses} pass(es), ` +
          `${outcome.kit.coverage.uncovered_requirement_ids.length} uncovered, ${outcome.skipped.length} skipped, ${secs}s`,
      );
      return { id: input.id, status: "ok", kit: outcome.kit, error: null } satisfies BatchKitEntry;
    } catch (err) {
      const { code, message } = classifyBatchError(err);
      log(`✗ ${input.id} FAILED — ${code}: ${message}`);
      return { id: input.id, status: "failed", kit: null, error: { code, message } } satisfies BatchKitEntry;
    }
  });

  const output: BatchOutput = {
    version: "1.0",
    generated_at: now().toISOString(),
    kits: entries,
  };
  return batchOutputSchema.parse(output);
}

export function classifyBatchError(err: unknown): { code: BatchErrorCode; message: string } {
  if (err instanceof PipelineError) {
    const map: Record<string, BatchErrorCode> = {
      VALIDATION_FAILED: "VALIDATION_FAILED",
      LLM_UNAVAILABLE: "LLM_UNAVAILABLE",
      LLM_RATE_LIMITED: "LLM_UNAVAILABLE",
      GENERATION_FAILED: "GENERATION_FAILED",
      INVALID_URL: "INVALID_URL",
      COMPANY_UNREACHABLE: "COMPANY_UNREACHABLE",
    };
    return { code: map[err.code] ?? "UNKNOWN", message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/timed out|timeout|exceeded \d+s/i.test(message)) return { code: "GENERATION_FAILED", message };
  return { code: "UNKNOWN", message };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!);
    }
  });
  await Promise.all(runners);
  return results;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolvePromise(v);
      },
      (e) => {
        clearTimeout(timer);
        rejectPromise(e);
      },
    );
  });
}
