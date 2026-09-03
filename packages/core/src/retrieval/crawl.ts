import { RetrievalError, type SkippedSource } from "./errors.js";
import { cleanHtml, type CleanedPage } from "./clean.js";
import { fetchDocument, type HttpOptions } from "./http.js";
import { rankLinks, type LinkIntent, type RankedLink } from "./link-ranking.js";
import type { RobotsCache } from "./robots.js";

export interface CrawlDeps {
  http: HttpOptions;
  robots: RobotsCache;
  userAgent: string;
  maxPages: number;
  /** How many link-following hops past the entry page. */
  maxDepth?: number;
}

export interface CrawledPage extends CleanedPage {
  intent: LinkIntent | "entry";
  depth: number;
}

export interface CrawlResult {
  entryUrl: string;
  /** null when even the entry page could not be retrieved. */
  entry: CrawledPage | null;
  pages: CrawledPage[];
  skipped: SkippedSource[];
}

interface Frontier {
  url: string;
  intent: LinkIntent;
  depth: number;
  score: number;
}

/**
 * Crawl a company site starting from `entryUrl` (which may include a path and
 * may be served from localhost). Relative links are resolved against the page
 * they were found on. Links are ranked by hiring/about relevance and the best
 * are followed breadth-first within a page budget.
 */
export async function crawlCompanySite(entryUrl: string, deps: CrawlDeps): Promise<CrawlResult> {
  const maxDepth = deps.maxDepth ?? 2;
  const skipped: SkippedSource[] = [];
  const pages: CrawledPage[] = [];
  const visited = new Set<string>();

  const entry = await tryFetch(entryUrl, "entry", 0, deps, skipped, visited);
  if (!entry) {
    return { entryUrl, entry: null, pages: [], skipped };
  }
  pages.push(entry);

  const frontier: Frontier[] = rankLinks(entry.links, entry.url, 12).map((l) => ({
    url: l.url,
    intent: l.intent,
    depth: 1,
    score: l.score,
  }));

  while (frontier.length > 0 && pages.length < deps.maxPages) {
    frontier.sort((a, b) => b.score - a.score);
    const next = frontier.shift()!;
    if (visited.has(normalise(next.url))) continue;

    const page = await tryFetch(next.url, next.intent, next.depth, deps, skipped, visited);
    if (!page) continue;
    pages.push(page);

    if (next.depth < maxDepth) {
      const children: RankedLink[] = rankLinks(page.links, page.url, 6);
      for (const child of children) {
        if (visited.has(normalise(child.url))) continue;
        frontier.push({
          url: child.url,
          intent: child.intent,
          depth: next.depth + 1,
          // discount deeper links so the entry page's best links win ties
          score: child.score - next.depth * 2,
        });
      }
    }
  }

  return { entryUrl, entry, pages, skipped };
}

async function tryFetch(
  url: string,
  intent: LinkIntent | "entry",
  depth: number,
  deps: CrawlDeps,
  skipped: SkippedSource[],
  visited: Set<string>,
): Promise<CrawledPage | null> {
  const key = normalise(url);
  if (visited.has(key)) return null;
  visited.add(key);

  try {
    const allowed = await deps.robots.isAllowed(url, deps.userAgent);
    if (!allowed) {
      skipped.push({ url, code: "ROBOTS_DISALLOWED", message: "Disallowed by robots.txt" });
      return null;
    }
    const doc = await fetchDocument(url, deps.http);
    visited.add(normalise(doc.finalUrl));
    const cleaned = cleanHtml(doc.body, doc.finalUrl);
    return { ...cleaned, intent, depth };
  } catch (err) {
    if (err instanceof RetrievalError) {
      skipped.push({ url, code: err.code, message: err.message });
    } else {
      skipped.push({ url, code: "NETWORK", message: err instanceof Error ? err.message : String(err) });
    }
    return null;
  }
}

function normalise(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
