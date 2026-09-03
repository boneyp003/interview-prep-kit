import { validateKit, type Kit } from "@ipk/core";
import type { KitDoc } from "../db/models/kit.js";
import { AppError } from "../http/errors.js";

/**
 * Apply a mutation to a ready kit under a structural-validity gate. The mutator
 * works on a deep clone; only if the result still validates is it written back.
 * A mutation that would corrupt the kit is rejected with 422 and the stored kit
 * is untouched.
 */
export async function mutateKit(
  doc: KitDoc,
  mutator: (kit: Kit, doc: KitDoc) => void | Promise<void>,
): Promise<KitDoc> {
  if (doc.status !== "ready" || !doc.kit) {
    throw AppError.conflict("This kit is not ready to edit yet");
  }
  const draft: Kit = structuredClone(doc.kit);
  await mutator(draft, doc);

  const validation = validateKit(draft);
  if (!validation.ok) {
    throw AppError.unprocessable("The edit would make the kit invalid", {
      issues: validation.issues,
    });
  }

  doc.kit = draft;
  doc.markModified("kit");
  doc.markModified("itemState");
  doc.markModified("sectionState");
  doc.markModified("practice");
  await doc.save();
  return doc;
}

export function requireQuestion(kit: Kit, id: string) {
  const q = kit.questions.find((x) => x.id === id);
  if (!q) throw AppError.notFound(`Question ${id} not found`);
  return q;
}

export function requireFlashcard(kit: Kit, id: string) {
  const f = kit.flashcards.find((x) => x.id === id);
  if (!f) throw AppError.notFound(`Flashcard ${id} not found`);
  return f;
}
