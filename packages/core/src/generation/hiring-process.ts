import { z } from "zod";
import type { CrawledPage } from "../retrieval/crawl.js";
import type { SearchResult } from "../retrieval/search.js";
import type { LlmClient } from "./llm/index.js";
import { UNTRUSTED_CONTENT_SYSTEM_CLAUSE, untrustedBlock } from "./prompts/untrusted.js";

/**
 * Pipeline step: "Look for public discussion of how the company interviews" +
 * making use of a hiring page once the crawler finds one.
 *
 * The output is a structured signal that steers question generation. If nothing
 * usable was retrieved, `found` is false and downstream generation falls back to
 * a role-only question mix — it does not fabricate a process.
 */

export const INTERVIEW_FORMATS = [
  "recruiter-screen",
  "hiring-manager-screen",
  "take-home",
  "live-coding",
  "system-design",
  "behavioural",
  "values-interview",
  "pair-programming",
  "presentation",
  "panel",
  "paid-trial-day",
] as const;

const modelOutput = z.object({
  found: z.boolean(),
  stages: z.array(z.string().min(1).max(160)).max(12),
  formats: z.array(z.enum(INTERVIEW_FORMATS)).max(11),
  themes: z.array(z.string().min(1).max(160)).max(12),
  summary: z.string().max(1200),
});

export interface HiringProcess {
  found: boolean;
  stages: string[];
  formats: string[];
  themes: string[];
  summary: string;
  sources: string[];
}

const SYSTEM = [
  "You analyse how a specific company runs its interview process, for a candidate preparing.",
  UNTRUSTED_CONTENT_SYSTEM_CLAUSE,
  "Rules:",
  "- Use only the provided company pages and public discussion snippets. Do not use outside knowledge about the company.",
  "- If the sources do not actually describe an interview process, set found=false and leave the arrays empty.",
  "- 'formats' must be drawn from the given enum; map what you read onto the closest values.",
  "- 'themes' are specific topics the process emphasises (e.g. 'distributed systems tradeoffs', 'writing skills', 'customer empathy').",
].join("\n");

export async function analyseHiringProcess(
  hiringPages: CrawledPage[],
  discussion: SearchResult[],
  llm: LlmClient,
): Promise<HiringProcess> {
  const sources = [
    ...hiringPages.map((p) => p.url),
    ...discussion.map((d) => d.url),
  ];

  if (hiringPages.length === 0 && discussion.length === 0) {
    return { found: false, stages: [], formats: [], themes: [], summary: "", sources: [] };
  }

  const pageBlocks = hiringPages
    .slice(0, 4)
    .map((p) => untrustedBlock(`company page: ${p.url}`, `${p.title}\n${p.text}`, 4000))
    .join("\n\n");
  const discussionBlock = discussion.length
    ? untrustedBlock(
        "public discussion snippets",
        discussion.map((d) => `- ${d.title} (${d.url})\n  ${d.snippet}`).join("\n"),
        3000,
      )
    : "(no public discussion found)";

  const prompt = [
    "Analyse how this company interviews, based only on the material below.",
    "",
    pageBlocks || "(no company hiring pages retrieved)",
    "",
    discussionBlock,
    "",
    'Return JSON: {"found": boolean, "stages": string[], "formats": string[], "themes": string[], "summary": string}',
  ].join("\n");

  const out = await llm.generateJson(modelOutput, {
    purpose: "analyse-hiring-process",
    system: SYSTEM,
    prompt,
    maxOutputTokens: 1200,
  });

  return {
    found: out.found && (out.stages.length > 0 || out.formats.length > 0),
    stages: out.stages,
    formats: [...new Set(out.formats)],
    themes: out.themes,
    summary: out.summary.trim(),
    sources,
  };
}
