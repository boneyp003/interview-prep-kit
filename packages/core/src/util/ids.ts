/**
 * Monotonic id allocator for a single kit. Ids are stable within a kit and
 * assigned by our code (never by the model), so `r3`, `q7`, `f2` mean the same
 * thing every time and the coverage check can rely on them.
 *
 * Seeded with the max existing number for a prefix so regeneration never reuses
 * an id that a still-present hand-edited item already holds.
 */
export class IdAllocator {
  private counters = new Map<string, number>();

  constructor(existing: Iterable<string> = []) {
    for (const id of existing) this.observe(id);
  }

  observe(id: string): void {
    const match = /^([a-z]+)(\d+)$/.exec(id);
    if (!match) return;
    const [, prefix, num] = match;
    const n = Number(num);
    this.counters.set(prefix!, Math.max(this.counters.get(prefix!) ?? 0, n));
  }

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}${n}`;
  }
}
