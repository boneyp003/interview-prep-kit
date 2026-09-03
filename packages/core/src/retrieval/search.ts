import * as cheerio from "cheerio";
import { RetrievalError, type SkippedSource } from "./errors.js";
import { fetchDocument, type HttpOptions } from "./http.js";

/**
 * Finds public discussion of a company's interview process using the
 * DuckDuckGo HTML endpoint (no API key, works on any free tier). Queries are
 * scoped to sites where candidates actually discuss interviews. A failure here
 * is never fatal: the caller gets an empty list plus a skip note, and the kit
 * says honestly that nothing was found (brief Section 10).
 */

const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";

// The DDG HTML endpoint returns an empty results page for obvious bot
// user-agents. A standard desktop UA is required to get results at all; this is
// a public search page and the use is read-only research, per brief Section 2.
const DDG_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const SCOPED_SITES = [
  "reddit.com",
  "glassdoor.com",
  "levels.fyi",
  "teamblind.com",
  "news.ycombinator.com",
];

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  query: string;
}

export interface SearchOutcome {
  results: SearchResult[];
  skipped: SkippedSource[];
}

export interface SearchDeps {
  http: HttpOptions;
  maxResults?: number;
}

export async function searchInterviewDiscussion(
  companyName: string,
  deps: SearchDeps,
): Promise<SearchOutcome> {
  const name = companyName.trim();
  if (!name) return { results: [], skipped: [] };

  const maxResults = deps.maxResults ?? 8;
  // Plain queries return far more on the DDG HTML endpoint than quoted or
  // heavily `site:`-filtered ones. Candidate-discussion sites (reddit,
  // glassdoor, blind) surface naturally; the last query is a targeted fallback.
  const queries = [
    `${name} interview process`,
    `${name} interview questions candidate experience`,
    `${name} interview site:reddit.com`,
  ];

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  const skipped: SkippedSource[] = [];

  for (const query of queries) {
    if (results.length >= maxResults) break;
    // Only run the reddit fallback if the plain queries came up short.
    if (query.includes("site:reddit.com") && results.length >= 3) break;
    try {
      const url = `${DDG_ENDPOINT}?q=${encodeURIComponent(query)}&kl=us-en`;
      const doc = await fetchDocument(url, {
        ...deps.http,
        userAgent: DDG_USER_AGENT,
        maxRetries: 2,
      });
      for (const hit of parseDuckDuckGo(doc.body, query)) {
        const key = hit.url.replace(/[#?].*$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(hit);
        if (results.length >= maxResults) break;
      }
    } catch (err) {
      const code = err instanceof RetrievalError ? err.code : "NETWORK";
      skipped.push({ url: `ddg:${query}`, code, message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Surface first-hand candidate discussion ahead of generic guide sites.
  results.sort((a, b) => discussionRank(b.url) - discussionRank(a.url));

  return { results: results.slice(0, maxResults), skipped };
}

function discussionRank(url: string): number {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return SCOPED_SITES.some((s) => host === s || host.endsWith(`.${s}`)) ? 1 : 0;
  } catch {
    return 0;
  }
}

export function parseDuckDuckGo(html: string, query: string): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];

  $(".result").each((_, el) => {
    const anchor = $(el).find("a.result__a").first();
    const rawHref = anchor.attr("href");
    if (!rawHref) return;
    const url = unwrapDuckDuckGoRedirect(rawHref);
    if (!url) return;
    out.push({
      title: collapse(anchor.text()),
      url,
      snippet: collapse($(el).find(".result__snippet").first().text()).slice(0, 400),
      query,
    });
  });

  return out;
}

function unwrapDuckDuckGoRedirect(href: string): string | null {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    const decoded = target ? decodeURIComponent(target) : u.toString();
    const parsed = new URL(decoded);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (/duckduckgo\.com$/.test(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
