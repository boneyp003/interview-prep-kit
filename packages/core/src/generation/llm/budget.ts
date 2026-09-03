import { delay } from "../../retrieval/rate-limiter.js";

interface Spend {
  at: number;
  tokens: number;
}

/**
 * Client-side pacing for a free LLM tier that limits BOTH requests-per-minute
 * and tokens-per-minute (the brief calls this out specifically). We keep a
 * rolling 60s window of spend and, before each call, wait until admitting the
 * estimated token cost would keep both ceilings satisfied. After the call the
 * estimate is reconciled with the provider's reported usage.
 *
 * One instance is shared across a whole run so every generation step draws from
 * the same budget.
 */
export class LlmBudget {
  private readonly windowMs = 60_000;
  private history: Spend[] = [];
  private chain: Promise<void> = Promise.resolve();
  private penaltyUntil = 0;

  constructor(
    private readonly rpm: number,
    private readonly tpm: number,
  ) {}

  /** Estimate tokens for a piece of text (~4 chars/token, deliberately high). */
  static estimate(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  /** Acquire a slot for a call estimated at `estimatedTokens`. Serialised. */
  async acquire(estimatedTokens: number): Promise<BudgetLease> {
    const gate = this.chain.then(() => this.waitForSlot(estimatedTokens));
    this.chain = gate.then(
      () => undefined,
      () => undefined,
    );
    await gate;
    const spend: Spend = { at: Date.now(), tokens: estimatedTokens };
    this.history.push(spend);
    return {
      settle: (actualTokens: number) => {
        spend.tokens = actualTokens;
      },
    };
  }

  /**
   * Register upstream pushback (a 429). Every subsequent acquire waits until the
   * penalty clears, so the whole run — including other concurrent kits sharing
   * this budget — slows down together.
   */
  penalize(ms: number): void {
    this.penaltyUntil = Math.max(this.penaltyUntil, Date.now() + ms);
  }

  private async waitForSlot(estimatedTokens: number): Promise<void> {
    for (;;) {
      if (this.penaltyUntil > Date.now()) {
        await delay(this.penaltyUntil - Date.now() + 50);
        continue;
      }
      this.prune();
      const requests = this.history.length;
      const tokens = this.history.reduce((sum, s) => sum + s.tokens, 0);

      const rpmOk = requests < this.rpm;
      const tpmOk = tokens + estimatedTokens <= this.tpm;
      if (rpmOk && tpmOk) return;

      const oldest = this.history[0];
      const waitMs = oldest ? oldest.at + this.windowMs - Date.now() + 50 : 1000;
      await delay(Math.max(250, waitMs));
    }
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    this.history = this.history.filter((s) => s.at >= cutoff);
  }
}

export interface BudgetLease {
  /** Report the provider's actual token count once the call returns. */
  settle(actualTokens: number): void;
}
