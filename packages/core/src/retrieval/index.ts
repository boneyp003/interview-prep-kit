import type { CoreConfig } from "../config/index.js";
import { RetrievalError, type SkippedSource } from "./errors.js";
import { cleanHtml, type CleanedPage } from "./clean.js";
import { fetchDocument, type HttpOptions } from "./http.js";
import { RateLimiter } from "./rate-limiter.js";
import { RobotsCache } from "./robots.js";
import { crawlCompanySite, type CrawlResult } from "./crawl.js";
import { searchInterviewDiscussion, type SearchOutcome } from "./search.js";
import type { UrlGuardOptions } from "./url-guard.js";

export * from "./errors.js";
export * from "./clean.js";
export * from "./link-ranking.js";
export * from "./crawl.js";
export * from "./search.js";
export { RateLimiter } from "./rate-limiter.js";
export { assertSafeUrl, isPrivateAddress } from "./url-guard.js";

export interface RetrievalOptions {
  /** Override the config's SSRF policy (the local-fixtures batch run sets this). */
  allowPrivateAddresses?: boolean;
  guardResolve?: UrlGuardOptions["resolve"];
}

/**
 * Bundles a rate limiter, robots cache and HTTP settings from config into the
 * three operations the pipeline needs. One instance per run so pacing and the
 * robots cache are shared across every fetch.
 */
export function createRetrieval(config: CoreConfig, options: RetrievalOptions = {}) {
  const limiter = new RateLimiter(config.retrieval.requestsPerSecond);
  const guard: UrlGuardOptions = {
    blockPrivate: options.allowPrivateAddresses ? false : config.retrieval.blockPrivateAddresses,
    ...(options.guardResolve ? { resolve: options.guardResolve } : {}),
  };
  const http: HttpOptions = {
    limiter,
    guard,
    maxBodyBytes: config.retrieval.maxBodyBytes,
    timeoutMs: config.retrieval.requestTimeoutMs,
    userAgent: config.retrieval.userAgent,
  };
  const robots = new RobotsCache(http);

  return {
    /** Fetch + clean a single page. Throws RetrievalError on failure. */
    async fetchPage(url: string): Promise<CleanedPage> {
      const allowed = await robots.isAllowed(url, config.retrieval.userAgent);
      if (!allowed) {
        throw new RetrievalError("ROBOTS_DISALLOWED", url, "Disallowed by robots.txt");
      }
      const doc = await fetchDocument(url, http);
      return cleanHtml(doc.body, doc.finalUrl);
    },

    crawlSite(entryUrl: string): Promise<CrawlResult> {
      return crawlCompanySite(entryUrl, {
        http,
        robots,
        userAgent: config.retrieval.userAgent,
        maxPages: config.retrieval.crawlMaxPages,
      });
    },

    searchInterviewDiscussion(companyName: string): Promise<SearchOutcome> {
      return searchInterviewDiscussion(companyName, { http });
    },
  };
}

export type Retrieval = ReturnType<typeof createRetrieval>;
export type { SkippedSource, CrawlResult, SearchOutcome };
