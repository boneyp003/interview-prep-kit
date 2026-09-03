import type { KitDoc } from "../db/models/kit.js";

/** Shape returned to the client. Full kit + builder overlay + status. */
export function serializeKit(doc: KitDoc) {
  return {
    id: doc.id,
    status: doc.status,
    input: doc.input,
    kit: doc.kit,
    itemState: doc.itemState ?? {},
    sectionState: doc.sectionState,
    practice: doc.practice ?? {},
    warnings: doc.warnings ?? [],
    error: doc.error ?? null,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt,
    updatedAt: (doc as unknown as { updatedAt: Date }).updatedAt,
  };
}

/** Lightweight shape for list views. */
export function serializeKitSummary(doc: KitDoc) {
  return {
    id: doc.id,
    status: doc.status,
    company: doc.kit?.source.company ?? hostOf(doc.input.companyUrl),
    role: doc.kit?.role.title ?? firstLine(doc.input.jd),
    days: doc.input.days,
    questionCount: doc.kit?.questions.length ?? 0,
    uncovered: doc.kit?.coverage.uncovered_requirement_ids.length ?? 0,
    error: doc.error ?? null,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt,
    updatedAt: (doc as unknown as { updatedAt: Date }).updatedAt,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function firstLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 80) ?? "Untitled role";
}
