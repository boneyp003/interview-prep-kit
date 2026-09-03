export type LlmErrorCode =
  | "AUTH" // missing / rejected API key
  | "RATE_LIMITED" // 429 that outlived our retries
  | "SERVER" // 5xx that outlived our retries
  | "TIMEOUT"
  | "NETWORK"
  | "BLOCKED" // safety filter / no candidate returned
  | "INVALID_OUTPUT"; // could not get schema-valid JSON after retries

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly retryable: boolean;

  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.retryable = code === "RATE_LIMITED" || code === "SERVER" || code === "TIMEOUT" || code === "NETWORK";
  }
}
