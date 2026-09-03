/** Reasons a single retrieval can fail. The pipeline records these per-source
 *  and keeps going — a dead source is skipped and reported, never fatal. */
export type RetrievalErrorCode =
  | "INVALID_URL" // malformed, non-http scheme
  | "BLOCKED_ADDRESS" // private / loopback / link-local in production
  | "ROBOTS_DISALLOWED" // robots.txt forbids this path
  | "UNSUPPORTED_CONTENT" // not text/html or text/plain
  | "TOO_LARGE" // body exceeded the byte cap
  | "HTTP_ERROR" // non-2xx after retries
  | "TIMEOUT"
  | "NETWORK" // DNS failure, connection reset, etc.
  | "RATE_LIMITED"; // upstream 429 that outlived our retries

export class RetrievalError extends Error {
  readonly code: RetrievalErrorCode;
  readonly url: string;
  readonly status?: number;

  constructor(code: RetrievalErrorCode, url: string, message: string, status?: number) {
    super(message);
    this.name = "RetrievalError";
    this.code = code;
    this.url = url;
    if (status !== undefined) this.status = status;
  }
}

export interface SkippedSource {
  url: string;
  code: RetrievalErrorCode;
  message: string;
}
