import { runPipeline, initialItemState, type CoreConfig } from "@ipk/core";
import { KitModel, type KitDoc, type ProgressEntry } from "../db/models/kit.js";
import { jobRegistry } from "./registry.js";

/**
 * Runs the full pipeline for one kit, persisting progress as it goes so the kit
 * can be reopened mid-flight. Progress is flushed to Mongo at most every ~1.5s
 * (and always on the terminal event) to avoid a write per step.
 */
export function startGeneration(kitId: string, core: CoreConfig): Promise<void> {
  return jobRegistry.start(kitId, async (report) => {
    const doc = await KitModel.findById(kitId);
    if (!doc) return;

    doc.status = "running";
    doc.error = null;
    doc.progress = [];
    await doc.save();

    let buffer: ProgressEntry[] = [];
    let lastFlush = 0;
    const flush = async (force = false): Promise<void> => {
      if (buffer.length === 0 && !force) return;
      const now = Date.now();
      if (!force && now - lastFlush < 1500) return;
      lastFlush = now;
      const batch = buffer;
      buffer = [];
      await KitModel.updateOne({ _id: kitId }, { $push: { progress: { $each: batch } } });
    };

    try {
      const outcome = await runPipeline(
        { jd: doc.input.jd, companyUrl: doc.input.companyUrl, days: doc.input.days },
        {
          config: core,
          onProgress: (event) => {
            const entry: ProgressEntry = {
              step: event.step,
              status: event.status,
              at: event.at,
              ...(event.detail ? { detail: event.detail } : {}),
            };
            report(entry);
            buffer.push(entry);
            void flush();
          },
        },
      );

      await flush(true);
      await KitModel.updateOne(
        { _id: kitId },
        {
          $set: {
            status: "ready",
            kit: outcome.kit,
            itemState: initialItemState({
              questions: outcome.kit.questions,
              flashcards: outcome.kit.flashcards,
            }),
            warnings: outcome.warnings.map((w) => `${w.step}: ${w.message}`),
            error: null,
          },
        },
      );
    } catch (err) {
      await flush(true);
      const code = (err as { code?: string }).code ?? "GENERATION_FAILED";
      const message = err instanceof Error ? err.message : String(err);
      await KitModel.updateOne(
        { _id: kitId },
        { $set: { status: "failed", error: { code, message } } },
      );
    }
  });
}

/** Boot-time recovery: any kit still `running` lost its in-process job. */
export async function sweepInterruptedJobs(): Promise<number> {
  const result = await KitModel.updateMany(
    { status: "running" },
    {
      $set: {
        status: "failed",
        error: {
          code: "INTERRUPTED",
          message: "Generation was interrupted by a server restart. Retry to regenerate.",
        },
      },
    },
  );
  return result.modifiedCount ?? 0;
}

export type { KitDoc };
