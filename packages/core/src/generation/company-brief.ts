import { z } from "zod";
import type { CrawledPage } from "../retrieval/crawl.js";
import type { CompanyBrief } from "../schema/kit.js";
import type { LlmClientLike } from "./llm/index.js";
import { UNTRUSTED_CONTENT_SYSTEM_CLAUSE, untrustedBlock } from "./prompts/untrusted.js";

/**
 * Pipeline step: the company brief. `sources` is set in code to the URLs we
 * actually fed the model — the model does not choose citations. When no usable
 * pages were retrieved we return an honest "little could be found" brief rather
 * than inventing one (brief Section 10).
 */

const modelOutput = z.object({
  summary: z.string().max(1500),
  what_they_do: z.string().max(1500),
  confident: z.boolean(),
});

const SYSTEM = [
  "You write a short, factual company brief for someone interviewing there.",
  UNTRUSTED_CONTENT_SYSTEM_CLAUSE,
  "Rules:",
  "- Use only the provided pages. Do not add facts from outside knowledge.",
  "- 'summary' (2-4 sentences): who they are, size/stage if stated, what matters about them for a candidate.",
  "- 'what_they_do' (1-3 sentences): the product / service in plain terms.",
  "- If the pages are thin or off-topic, say so plainly and set confident=false. Never fill gaps with speculation.",
].join("\n");

export async function generateCompanyBrief(
  companyName: string,
  pages: CrawledPage[],
  llm: LlmClientLike,
): Promise<CompanyBrief> {
  const usable = pages.filter((p) => p.text.trim().length > 120);
  const sources = usable.map((p) => p.url);

  if (usable.length === 0) {
    const who = companyName.trim() || "This company";
    return {
      summary: `${who} could not be researched from the provided website — the pages were unreachable or contained too little information. Treat this brief as incomplete and verify details directly.`,
      what_they_do: "Not established from the available sources.",
      sources: [],
    };
  }

  const blocks = usable
    .slice(0, 5)
    .map((p) => untrustedBlock(`page: ${p.url}`, `${p.title}\n${p.description}\n${p.text}`, 3500))
    .join("\n\n");

  const prompt = [
    `Write a company brief for ${companyName || "the company"} using only these pages.`,
    "",
    blocks,
    "",
    'Return JSON: {"summary": string, "what_they_do": string, "confident": boolean}',
  ].join("\n");

  const out = await llm.generateJson(modelOutput, {
    purpose: "company-brief",
    system: SYSTEM,
    prompt,
    maxOutputTokens: 900,
  });

  const summary = out.confident
    ? out.summary.trim()
    : `${out.summary.trim()} (Limited information was available; verify independently.)`;

  return { summary, what_they_do: out.what_they_do.trim(), sources };
}
