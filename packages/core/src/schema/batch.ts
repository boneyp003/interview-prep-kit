import { z } from "zod";
import { kitSchema } from "./kit.js";

/** Appendix B — batch input and output. */

export const caseInputSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string(),
  days: z.number().int().positive(),
});

export const casesFileSchema = z.array(caseInputSchema);

export type CaseInput = z.infer<typeof caseInputSchema>;

/** Machine-readable failure codes. `failed` is reserved for "no kit at all". */
export const BATCH_ERROR_CODES = [
  "INVALID_URL",
  "COMPANY_UNREACHABLE",
  "LLM_UNAVAILABLE",
  "GENERATION_FAILED",
  "VALIDATION_FAILED",
  "UNKNOWN",
] as const;
export type BatchErrorCode = (typeof BATCH_ERROR_CODES)[number];

export const batchErrorSchema = z.object({
  code: z.enum(BATCH_ERROR_CODES),
  message: z.string(),
});

export const batchKitEntrySchema = z.discriminatedUnion("status", [
  z.object({
    id: z.string(),
    status: z.literal("ok"),
    kit: kitSchema,
    error: z.null(),
  }),
  z.object({
    id: z.string(),
    status: z.literal("failed"),
    kit: z.null(),
    error: batchErrorSchema,
  }),
]);

export const batchOutputSchema = z.object({
  version: z.literal("1.0"),
  generated_at: z.string(),
  kits: z.array(batchKitEntrySchema),
});

export type BatchOutput = z.infer<typeof batchOutputSchema>;
export type BatchKitEntry = z.infer<typeof batchKitEntrySchema>;
