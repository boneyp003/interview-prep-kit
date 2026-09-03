import type { Kit, ItemStateMap } from "@ipk/core";

export type { Kit } from "@ipk/core";

export type KitStatus = "queued" | "running" | "ready" | "failed";

export interface KitSummary {
  id: string;
  status: KitStatus;
  company: string;
  role: string;
  days: number;
  questionCount: number;
  uncovered: number;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface KitRecord {
  id: string;
  status: KitStatus;
  input: { jd: string; companyUrl: string; days: number };
  kit: Kit | null;
  itemState: ItemStateMap;
  sectionState: { companyBrief: { edited: boolean }; schedule: { edited: boolean } };
  practice: Record<string, PracticeRecord>;
  warnings: string[];
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeRecord {
  lastConfidence: number;
  reviews: number;
  lastReviewedAt: string;
  dueAt: string;
}

export interface ProgressEntry {
  step: string;
  status: string;
  detail?: string;
  at: string;
}

export interface ProgressResponse {
  status: KitStatus;
  progress: ProgressEntry[];
  error: { code: string; message: string } | null;
  warnings: string[];
}
