import type { PageLink } from "./clean.js";

/**
 * Ranks links found on a company site by how likely they are to describe
 * (a) what the company does and (b) how it hires. The brief is explicit that a
 * fixed path list is not enough — companies publish hiring info at
 * `/careers`, `/handbook`, an engineering blog, etc. So we score on weighted
 * keyword signals in the URL path and the anchor text and let the crawler fetch
 * the top N, rather than guessing paths.
 */

export type LinkIntent = "hiring" | "about" | "blog" | "other";

export interface RankedLink {
  url: string;
  anchor: string;
  score: number;
  intent: LinkIntent;
}

interface Signal {
  pattern: RegExp;
  weight: number;
  intent: LinkIntent;
}

// Matched against the lowercased path + anchor text.
const SIGNALS: Signal[] = [
  { pattern: /\b(hiring|interview|interviewing)\b/, weight: 10, intent: "hiring" },
  { pattern: /\b(recruit|recruiting|recruitment)\b/, weight: 7, intent: "hiring" },
  { pattern: /\bhow we hire\b/, weight: 12, intent: "hiring" },
  { pattern: /\bcareers?\b/, weight: 6, intent: "hiring" },
  { pattern: /\bjobs?\b/, weight: 5, intent: "hiring" },
  { pattern: /\bwork (with|for) us\b/, weight: 6, intent: "hiring" },
  { pattern: /\bjoin( the)? (us|team)\b/, weight: 5, intent: "hiring" },
  { pattern: /\bhandbook\b/, weight: 6, intent: "hiring" },
  { pattern: /\blife at\b/, weight: 4, intent: "hiring" },
  { pattern: /\bculture\b/, weight: 3, intent: "hiring" },
  { pattern: /\bapplication process\b/, weight: 8, intent: "hiring" },
  { pattern: /\bwhat to expect\b/, weight: 5, intent: "hiring" },

  { pattern: /\babout( us)?\b/, weight: 6, intent: "about" },
  { pattern: /\b(our )?(mission|story|company)\b/, weight: 4, intent: "about" },
  { pattern: /\bwhat we do\b/, weight: 6, intent: "about" },
  { pattern: /\bproducts?\b/, weight: 3, intent: "about" },
  { pattern: /\bplatform\b/, weight: 2, intent: "about" },
  { pattern: /\bteam\b/, weight: 2, intent: "about" },

  { pattern: /\b(engineering )?blog\b/, weight: 3, intent: "blog" },
  { pattern: /\bnews(room)?\b/, weight: 2, intent: "blog" },
];

const NEGATIVE = /\b(login|signin|sign-in|privacy|terms|cookie|legal|status|pricing|docs?|support|contact|press-kit|\.pdf|\.zip)\b/;

function registrableHost(host: string): string {
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.slice(-2).join(".");
}

export function rankLinks(links: PageLink[], baseUrl: string, limit = 8): RankedLink[] {
  const base = new URL(baseUrl);
  const baseHost = registrableHost(base.hostname);

  const ranked: RankedLink[] = [];
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      continue;
    }

    const sameSite = registrableHost(url.hostname) === baseHost;
    const haystack = `${decodeURIComponent(url.pathname)} ${link.anchor}`.toLowerCase();

    if (NEGATIVE.test(haystack)) continue;

    let score = 0;
    let intent: LinkIntent = "other";
    let bestWeight = 0;
    for (const sig of SIGNALS) {
      if (sig.pattern.test(haystack)) {
        score += sig.weight;
        if (sig.weight > bestWeight) {
          bestWeight = sig.weight;
          intent = sig.intent;
        }
      }
    }
    if (score === 0) continue;

    if (!sameSite) score -= 6; // offsite is usually a social/job-board link
    const depth = url.pathname.split("/").filter(Boolean).length;
    if (depth > 3) score -= depth - 3; // very deep pages are usually specific listings

    if (score <= 0) continue;
    ranked.push({ url: url.toString(), anchor: link.anchor, score, intent });
  }

  ranked.sort((a, b) => b.score - a.score);

  // De-duplicate by normalised path, keep the highest score.
  const byPath = new Map<string, RankedLink>();
  for (const link of ranked) {
    const key = new URL(link.url).pathname.replace(/\/+$/, "").toLowerCase() || "/";
    if (!byPath.has(key)) byPath.set(key, link);
  }

  return [...byPath.values()].slice(0, limit);
}
