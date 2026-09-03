import { RetrievalError } from "./errors.js";
import { RateLimiter, backoffDelay, delay } from "./rate-limiter.js";
import { assertSafeUrl, type UrlGuardOptions } from "./url-guard.js";

export interface HttpOptions {
  limiter: RateLimiter;
  guard: UrlGuardOptions;
  maxBodyBytes: number;
  timeoutMs: number;
  userAgent: string;
  maxRetries?: number;
}

export interface FetchedDocument {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];
const MAX_REDIRECTS = 5;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 425 || (status >= 500 && status <= 599);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}

async function readCapped(response: Response, maxBytes: number, url: string): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RetrievalError("TOO_LARGE", url, `Content-Length ${declared} exceeds ${maxBytes}`);
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RetrievalError("TOO_LARGE", url, `Body exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * Fetch a single document with SSRF guarding on every redirect hop, a body-size
 * cap, a content-type allowlist, a timeout, and ret/backoff on 429 / 5xx /
 * transient network errors. Rate limiting is delegated to the shared limiter.
 */
export async function fetchDocument(rawUrl: string, opts: HttpOptions): Promise<FetchedDocument> {
  const maxRetries = opts.maxRetries ?? 3;
  let currentUrl = rawUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const safe = await assertSafeUrl(currentUrl, opts.guard);
    const target = safe.url.toString();

    let attempt = 0;
    for (;;) {
      const response = await opts.limiter.schedule(() => doFetch(target, opts));

      if (response instanceof RetrievalError) {
        if (
          (response.code === "NETWORK" || response.code === "TIMEOUT") &&
          attempt < maxRetries
        ) {
          await delay(backoffDelay(attempt++));
          continue;
        }
        throw response;
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new RetrievalError("HTTP_ERROR", target, "Redirect without Location", response.status);
        }
        currentUrl = new URL(location, target).toString();
        break; // outer redirect loop re-guards the new URL
      }

      if (isRetryableStatus(response.status)) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        if (response.status === 429) opts.limiter.penalize(retryAfter ?? 5000);
        if (attempt < maxRetries) {
          await delay(retryAfter ?? backoffDelay(attempt++));
          continue;
        }
        throw new RetrievalError(
          response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
          target,
          `Upstream ${response.status} after ${maxRetries} retries`,
          response.status,
        );
      }

      if (response.status < 200 || response.status >= 300) {
        throw new RetrievalError("HTTP_ERROR", target, `Upstream ${response.status}`, response.status);
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const mime = contentType.split(";")[0]!.trim();
      if (mime && !ALLOWED_CONTENT_TYPES.includes(mime)) {
        throw new RetrievalError("UNSUPPORTED_CONTENT", target, `Content-Type ${mime} not allowed`);
      }

      const body = await readCapped(response, opts.maxBodyBytes, target);
      return {
        requestedUrl: rawUrl,
        finalUrl: target,
        status: response.status,
        contentType: mime || "text/html",
        body,
      };
    }
  }

  throw new RetrievalError("HTTP_ERROR", rawUrl, `Too many redirects (> ${MAX_REDIRECTS})`);
}

async function doFetch(url: string, opts: HttpOptions): Promise<Response | RetrievalError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "user-agent": opts.userAgent,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "accept-language": "en",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return new RetrievalError("TIMEOUT", url, `Timed out after ${opts.timeoutMs}ms`);
    }
    return new RetrievalError("NETWORK", url, err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}
