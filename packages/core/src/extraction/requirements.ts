import { z } from "zod";
import type { LlmClient } from "../generation/llm/index.js";
import { UNTRUSTED_CONTENT_SYSTEM_CLAUSE, untrustedBlock } from "../generation/prompts/untrusted.js";
import { REQUIREMENT_KINDS, REQUIREMENT_PRIORITIES, type Requirement } from "../schema/kit.js";

/**
 * Pipeline step: "Extract the relevant requirements from the job description."
 *
 * The model classifies text it is shown; it does NOT invent. Stable ids
 * (`r1`, `r2`, …) are assigned here in code, not by the model, so they are
 * deterministic and the coverage check can rely on them.
 *
 * Thin postings: the prompt forbids inflating a stub into a full spec. A
 * two-line JD should yield one or two requirements and `thin: true`.
 */

const modelRequirement = z.object({
  text: z.string().min(1).max(300),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(REQUIREMENT_PRIORITIES),
  rationale: z.string().max(300).optional(),
});

const modelOutput = z.object({
  title: z.string().max(200),
  seniority: z.string().max(80),
  responsibilities: z.array(z.string().min(1).max(300)).max(15),
  requirements: z.array(modelRequirement).max(30),
  thin: z.boolean(),
});

export interface ExtractedRole {
  title: string;
  seniority: string;
  responsibilities: string[];
  requirements: Requirement[];
  /** True when the posting had too little to extract a real spec from. */
  thin: boolean;
  notes: string[];
}

const SYSTEM = [
  "You extract structured hiring requirements from a job description for interview preparation.",
  UNTRUSTED_CONTENT_SYSTEM_CLAUSE,
  "Rules:",
  "- Only list requirements the posting actually states or clearly implies. Never add plausible-sounding requirements that are not there. Inventing requirements is worse than reporting few.",
  "- priority: 'must' for hard requirements (\"required\", \"must have\", \"X years of\"), 'nice' for anything phrased as bonus / preferred / plus / nice to have.",
  "- kind: 'technical' (tools, languages, systems), 'behavioural' (collaboration, mentoring, communication, ownership), 'domain' (industry / product knowledge).",
  "- If the description is a short stub with little to go on, extract only what is there and set thin=true.",
].join("\n");

export async function extractRequirements(jd: string, llm: LlmClient): Promise<ExtractedRole> {
  const trimmed = jd.trim();
  const notes: string[] = [];

  if (trimmed.length < 40) {
    notes.push("Job description is nearly empty; extracted minimal requirements.");
    return {
      title: "",
      seniority: "",
      responsibilities: [],
      requirements: [],
      thin: true,
      notes,
    };
  }

  const prompt = [
    "Extract the role summary and requirements from this job description.",
    untrustedBlock("job description", trimmed),
    "",
    'Return JSON: {"title": string, "seniority": string, "responsibilities": string[], "requirements": [{"text": string, "kind": "technical|behavioural|domain", "priority": "must|nice", "rationale": string}], "thin": boolean}',
  ].join("\n");

  const out = await llm.generateJson(modelOutput, {
    purpose: "extract-requirements",
    system: SYSTEM,
    prompt,
    maxOutputTokens: 2048,
  });

  const requirements: Requirement[] = dedupeByText(out.requirements).map((r, i) => ({
    id: `r${i + 1}`,
    text: r.text.trim(),
    kind: r.kind,
    priority: r.priority,
  }));

  if (requirements.length === 0) {
    notes.push("No explicit requirements found in the job description.");
  }
  const thin = out.thin || requirements.length <= 2 || trimmed.length < 300;
  if (thin) notes.push("Job description is thin; kit scope is limited to what it contains.");

  return {
    title: out.title.trim(),
    seniority: out.seniority.trim(),
    responsibilities: out.responsibilities.map((r) => r.trim()).filter(Boolean),
    requirements,
    thin,
    notes,
  };
}

function dedupeByText<T extends { text: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = item.text.trim().toLowerCase().replace(/\s+/g, " ");
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}
