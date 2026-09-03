import robotsParserImport from "robots-parser";
import type { HttpOptions } from "./http.js";
import { fetchDocument } from "./http.js";

interface RobotsRules {
  isAllowed(url: string, ua?: string): boolean | undefined;
}

// robots-parser ships a loose ambient type; pin the call signature we use.
const robotsParser = robotsParserImport as unknown as (
  url: string,
  contents: string,
) => RobotsRules;

/**
 * Per-origin robots.txt cache (brief Section 2: "Respect robots.txt").
 *
 * Policy: if robots.txt is missing, returns 4xx, or cannot be fetched, we treat
 * the site as crawlable (standard behaviour). A 5xx on robots.txt is treated as
 * "disallow all" per the spec's guidance. Only the outcome is cached, one entry
 * per origin, for the lifetime of a run.
 */
export class RobotsCache {
  private readonly cache = new Map<string, RobotsRules | null>();

  constructor(private readonly http: Omit<HttpOptions, "maxRetries">) {}

  async isAllowed(targetUrl: string, userAgent: string): Promise<boolean> {
    const origin = safeOrigin(targetUrl);
    if (!origin) return false;

    if (!this.cache.has(origin)) {
      this.cache.set(origin, await this.load(origin));
    }
    const rules = this.cache.get(origin) ?? null;
    if (!rules) return true; // no usable robots.txt -> allowed
    return rules.isAllowed(targetUrl, userAgent) ?? true;
  }

  private async load(origin: string): Promise<RobotsRules | null> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const doc = await fetchDocument(robotsUrl, { ...this.http, maxRetries: 1 });
      return robotsParser(robotsUrl, doc.body);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const status = (err as { status?: number }).status;
      if (code === "HTTP_ERROR" && status && status >= 500) {
        // server error on robots.txt -> be conservative, disallow everything
        return robotsParser(robotsUrl, "User-agent: *\nDisallow: /");
      }
      return null;
    }
  }
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
