import type { ProgressEntry } from "../db/models/kit.js";

interface RunningJob {
  kitId: string;
  startedAt: number;
  latest: ProgressEntry[];
  promise: Promise<void>;
}

/**
 * In-process registry of active generations. The brief does not want a Redis /
 * queue dependency on a free tier; generation runs in the API process and its
 * state is persisted to Mongo as it goes. The registry exists to (a) stop the
 * same kit being generated twice concurrently and (b) serve live progress
 * without a DB round-trip.
 *
 * Jobs do not survive a process restart — `sweepInterruptedJobs` (called on
 * boot) marks any kit left `running` as failed/interrupted so it can be retried.
 */
class JobRegistry {
  private jobs = new Map<string, RunningJob>();

  has(kitId: string): boolean {
    return this.jobs.has(kitId);
  }

  start(kitId: string, run: (report: (entry: ProgressEntry) => void) => Promise<void>): Promise<void> {
    if (this.jobs.has(kitId)) return this.jobs.get(kitId)!.promise;

    const job: RunningJob = { kitId, startedAt: Date.now(), latest: [], promise: Promise.resolve() };
    const report = (entry: ProgressEntry): void => {
      job.latest.push(entry);
      if (job.latest.length > 200) job.latest.shift();
    };
    job.promise = run(report).finally(() => {
      this.jobs.delete(kitId);
    });
    this.jobs.set(kitId, job);
    return job.promise;
  }

  progress(kitId: string): ProgressEntry[] | null {
    return this.jobs.get(kitId)?.latest ?? null;
  }
}

export const jobRegistry = new JobRegistry();
