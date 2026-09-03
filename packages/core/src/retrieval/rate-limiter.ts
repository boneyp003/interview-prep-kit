/**
 * Serialises outbound requests and paces them at a target rate. On upstream
 * pushback (`penalize`) it adds a cooldown that decays back to the base rate.
 *
 * One limiter instance is shared by all crawl/search fetches in a run so the
 * whole pipeline slows down together when a host says "slow down".
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private queue: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;
  private penaltyUntil = 0;

  constructor(requestsPerSecond: number) {
    this.minIntervalMs = requestsPerSecond > 0 ? 1000 / requestsPerSecond : 0;
  }

  /** Run `fn` once it is this caller's turn and the pacing gate is open. */
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const now = Date.now();
      const waitUntil = Math.max(now, this.nextAllowedAt, this.penaltyUntil);
      if (waitUntil > now) await delay(waitUntil - now);
      this.nextAllowedAt = Date.now() + this.minIntervalMs;
    });
    // keep the chain alive even if a job throws
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run.then(fn);
  }

  /** Add a cooldown before the next request (e.g. Retry-After from a 429). */
  penalize(ms: number): void {
    this.penaltyUntil = Math.max(this.penaltyUntil, Date.now() + ms);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt: number, baseMs = 500, capMs = 20_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.random() * exp;
}
