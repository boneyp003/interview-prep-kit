import type { ZodType } from "zod";
import type { CoreConfig } from "../../config/index.js";
import { backoffDelay, delay } from "../../retrieval/rate-limiter.js";
import { LlmBudget } from "./budget.js";
import { LlmError } from "./errors.js";
import { callGemini, retryDelayMs, type GeminiResponse } from "./gemini.js";
import { extractJson } from "./json.js";

export { LlmError } from "./errors.js";
export type { LlmErrorCode } from "./errors.js";

export interface GenerateOptions {
  /** Short label for logs / progress events. */
  purpose: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmCallLog {
  purpose: string;
  attempts: number;
  promptTokens: number;
  outputTokens: number;
  ms: number;
}

/**
 * The generation-facing LLM client. Responsibilities:
 *   - draw every call through the shared per-minute budget (RPM + TPM)
 *   - retry transient failures (429 / 5xx / network) with backoff, honouring a
 *     server-provided retryDelay
 *   - for JSON calls, parse + schema-validate, with one corrective retry
 *
 * Nothing above this layer talks to Gemini directly.
 */
export class LlmClient {
  private readonly budget: LlmBudget;
  readonly log: LlmCallLog[] = [];

  constructor(
    private readonly config: CoreConfig["gemini"],
    private readonly timeoutMs = 45_000,
  ) {
    this.budget = new LlmBudget(config.requestsPerMinute, config.tokensPerMinute);
  }

  async generateText(opts: GenerateOptions): Promise<string> {
    const res = await this.run(opts, false);
    return res.text;
  }

  /**
   * Generate a value and validate it against `schema`. On a validation failure
   * we retry once, showing the model exactly what was wrong. A second failure
   * throws LlmError("INVALID_OUTPUT") for the pipeline to handle.
   */
  async generateJson<T>(schema: ZodType<T>, opts: GenerateOptions): Promise<T> {
    const jsonOpts: GenerateOptions = {
      ...opts,
      temperature: opts.temperature ?? 0.2,
      system: `${opts.system ? opts.system + "\n\n" : ""}Respond with a single valid JSON value and nothing else. No markdown fences, no commentary.`,
    };

    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt =
        attempt === 0
          ? jsonOpts.prompt
          : `${jsonOpts.prompt}\n\nYour previous response was rejected: ${lastError}\nReturn corrected JSON only.`;

      const res = await this.run({ ...jsonOpts, prompt }, true);
      let value: unknown;
      try {
        value = extractJson(res.text);
      } catch (err) {
        lastError = err instanceof Error ? err.message : "unparseable JSON";
        continue;
      }
      const parsed = schema.safeParse(value);
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues
        .slice(0, 6)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
    }
    throw new LlmError("INVALID_OUTPUT", `Schema validation failed after retry: ${lastError}`);
  }

  private async run(opts: GenerateOptions, json: boolean): Promise<GeminiResponse> {
    const started = Date.now();
    const estimate =
      LlmBudget.estimate((opts.system ?? "") + opts.prompt) + (opts.maxOutputTokens ?? 2048);
    const lease = await this.budget.acquire(estimate);

    let attempt = 0;
    for (;;) {
      try {
        const res = await callGemini(
          this.config.model,
          this.config.apiKey,
          {
            system: opts.system ?? "",
            prompt: opts.prompt,
            temperature: opts.temperature ?? 0.3,
            maxOutputTokens: opts.maxOutputTokens ?? 2048,
            json,
          },
          this.timeoutMs,
        );
        lease.settle(res.totalTokens || estimate);
        this.log.push({
          purpose: opts.purpose,
          attempts: attempt + 1,
          promptTokens: res.promptTokens,
          outputTokens: res.outputTokens,
          ms: Date.now() - started,
        });
        return res;
      } catch (err) {
        if (!(err instanceof LlmError) || !err.retryable || attempt >= this.config.maxRetries) {
          lease.settle(estimate);
          throw err;
        }
        const hinted = retryDelayMs(err.message);
        await delay(hinted ?? backoffDelay(attempt, 1000, 30_000));
        attempt++;
      }
    }
  }
}

export function createLlm(config: CoreConfig): LlmClient {
  return new LlmClient(config.gemini);
}
