import { Schema, model, Types, type HydratedDocument } from "mongoose";
import type { Kit } from "@ipk/core";
import type { ItemStateMap } from "@ipk/core";

/** Lifecycle of a kit record. */
export type KitStatus = "queued" | "running" | "ready" | "failed";

export interface ProgressEntry {
  step: string;
  status: string;
  detail?: string;
  at: string;
}

export interface PracticeRecord {
  /** 1 (blank) .. 5 (confident) — from the user during practice. */
  lastConfidence: number;
  reviews: number;
  lastReviewedAt: string;
  /** Due timestamp for the lightweight spaced-repetition ordering. */
  dueAt: string;
}

export interface KitRecord {
  userId: Types.ObjectId;
  status: KitStatus;
  input: { jd: string; companyUrl: string; days: number };
  /** sha256 of normalised (jd + companyUrl) — dedupe key per user. */
  inputHash: string;
  kit: Kit | null;
  itemState: ItemStateMap;
  sectionState: { companyBrief: { edited: boolean }; schedule: { edited: boolean } };
  practice: Record<string, PracticeRecord>;
  progress: ProgressEntry[];
  warnings: string[];
  error: { code: string; message: string } | null;
}

const kitSchema = new Schema<KitRecord>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["queued", "running", "ready", "failed"],
      default: "queued",
      index: true,
    },
    input: {
      jd: { type: String, required: true },
      companyUrl: { type: String, required: true },
      days: { type: Number, required: true, min: 1 },
    },
    inputHash: { type: String, required: true, index: true },
    kit: { type: Schema.Types.Mixed, default: null },
    itemState: { type: Schema.Types.Mixed, default: {} },
    sectionState: {
      companyBrief: { edited: { type: Boolean, default: false } },
      schedule: { edited: { type: Boolean, default: false } },
    },
    practice: { type: Schema.Types.Mixed, default: {} },
    progress: { type: Schema.Types.Mixed, default: [] },
    warnings: { type: [String], default: [] },
    error: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false },
);

kitSchema.index({ userId: 1, inputHash: 1 });

export type KitDoc = HydratedDocument<KitRecord>;

export const KitModel = model<KitRecord>("Kit", kitSchema);
