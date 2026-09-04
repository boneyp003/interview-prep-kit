import { createHash } from "node:crypto";
import type { CoreConfig } from "@ipk/core";
import { KitModel, type KitDoc } from "../db/models/kit.js";
import { AppError } from "../http/errors.js";
import { runGeneration } from "../jobs/index.js";

export interface KitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export function inputHash(jd: string, companyUrl: string): string {
  const normalised = `${jd.trim().replace(/\s+/g, " ").toLowerCase()}::${companyUrl.trim().replace(/\/+$/, "").toLowerCase()}`;
  return createHash("sha256").update(normalised).digest("hex");
}

/**
 * Create a kit and kick off generation. If the same user already has a kit for
 * the same (jd, company) that is queued/running/ready, that existing kit is
 * returned instead of starting a duplicate run (brief Section 10 — "the same
 * description and company are submitted twice"). A previously *failed* kit for
 * the same input is retried in place.
 */
export async function createKit(
  userId: string,
  input: KitInput,
  core: CoreConfig,
): Promise<{ kit: KitDoc; deduped: boolean }> {
  const hash = inputHash(input.jd, input.companyUrl);
  const existing = await KitModel.findOne({ userId, inputHash: hash }).sort({ createdAt: -1 });

  if (existing && existing.status !== "failed") {
    return { kit: existing, deduped: true };
  }
  if (existing && existing.status === "failed") {
    existing.status = "queued";
    existing.error = null;
    existing.progress = [];
    existing.input = input;
    await existing.save();
    void runGeneration(existing.id, core);
    return { kit: existing, deduped: false };
  }

  const doc = await KitModel.create({
    userId,
    status: "queued",
    input,
    inputHash: hash,
    kit: null,
    itemState: {},
    sectionState: { companyBrief: { edited: false }, schedule: { edited: false } },
    practice: {},
    progress: [],
    warnings: [],
    error: null,
  });

  void runGeneration(doc.id, core);
  return { kit: doc, deduped: false };
}

export async function createKitsBatch(
  userId: string,
  inputs: KitInput[],
  core: CoreConfig,
): Promise<Array<{ id: string; deduped: boolean }>> {
  const results: Array<{ id: string; deduped: boolean }> = [];
  for (const input of inputs) {
    const { kit, deduped } = await createKit(userId, input, core);
    results.push({ id: kit.id, deduped });
  }
  return results;
}

export async function listKits(userId: string): Promise<KitDoc[]> {
  return KitModel.find({ userId }).sort({ createdAt: -1 });
}

/** Fetch a kit the user owns, or 404 (never reveal another user's kit exists). */
export async function getOwnedKit(userId: string, kitId: string): Promise<KitDoc> {
  if (!kitId.match(/^[a-f\d]{24}$/i)) throw AppError.notFound("Kit not found");
  const doc = await KitModel.findById(kitId);
  if (!doc || String(doc.userId) !== userId) throw AppError.notFound("Kit not found");
  return doc;
}

export async function deleteKit(userId: string, kitId: string): Promise<void> {
  const doc = await getOwnedKit(userId, kitId);
  await doc.deleteOne();
}

/**
 * Re-run full generation after a failure. Deliberately restricted to
 * `status === "failed"` — a `ready` kit may carry hand-edits (itemState,
 * pinned/edited items, a hand-edited schedule), and a full regeneration
 * discards all of that. That is exactly the "triggered twice" failure mode
 * Section 13 warns about, so this is not merely a running/queued guard: a
 * ready kit is retried by deleting it and creating a fresh one, never by
 * calling retry on it in place.
 */
export async function retryKit(userId: string, kitId: string, core: CoreConfig): Promise<KitDoc> {
  const doc = await getOwnedKit(userId, kitId);
  if (doc.status !== "failed") {
    throw AppError.conflict(
      doc.status === "ready"
        ? "This kit already has a result. Delete it and create a new one to regenerate from scratch."
        : "This kit is already generating",
    );
  }
  doc.status = "queued";
  doc.error = null;
  doc.progress = [];
  await doc.save();
  void runGeneration(doc.id, core);
  return doc;
}
