/**
 * Environment configuration for the core library.
 *
 * `loadCoreConfig()` reads from `process.env` once and returns a frozen object.
 * Callers (API, CLI) may also construct a config by hand for tests. Nothing in
 * core reads `process.env` outside this file.
 */

export interface CoreConfig {
  gemini: {
    apiKey: string;
    model: string;
    /** Client-side pacing so we stay under the free-tier limits. */
    requestsPerMinute: number;
    tokensPerMinute: number;
    maxRetries: number;
  };
  retrieval: {
    blockPrivateAddresses: boolean;
    crawlMaxPages: number;
    requestsPerSecond: number;
    maxBodyBytes: number;
    requestTimeoutMs: number;
    userAgent: string;
  };
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

export function loadCoreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  return Object.freeze({
    gemini: {
      apiKey: env.GEMINI_API_KEY ?? "",
      model: env.GEMINI_MODEL?.trim() || "gemini-flash-latest",
      requestsPerMinute: num(env.GEMINI_RPM, 10),
      tokensPerMinute: num(env.GEMINI_TPM, 250_000),
      maxRetries: num(env.GEMINI_MAX_RETRIES, 3),
    },
    retrieval: {
      blockPrivateAddresses: bool(env.BLOCK_PRIVATE_ADDRESSES, true),
      crawlMaxPages: num(env.CRAWL_MAX_PAGES, 12),
      requestsPerSecond: num(env.CRAWL_REQUESTS_PER_SECOND, 2),
      maxBodyBytes: num(env.HTTP_MAX_BODY_BYTES, 2_000_000),
      requestTimeoutMs: num(env.HTTP_TIMEOUT_MS, 15_000),
      userAgent:
        env.CRAWL_USER_AGENT?.trim() ||
        "InterviewPrepKitBot/0.1 (+https://example.invalid/bot; research use)",
    },
  });
}
