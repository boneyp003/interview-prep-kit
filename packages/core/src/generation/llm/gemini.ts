import { LlmError } from "./errors.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiRequest {
  system?: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  json: boolean;
}

export interface GeminiResponse {
  text: string;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Raw transport for the Gemini generateContent REST API. The API key is sent as
 * a header, never in the URL. Returns a typed LlmError instead of throwing raw
 * fetch errors so the caller's retry loop can classify the failure.
 */
export async function callGemini(
  model: string,
  apiKey: string,
  req: GeminiRequest,
  timeoutMs: number,
): Promise<GeminiResponse> {
  if (!apiKey) throw new LlmError("AUTH", "GEMINI_API_KEY is not set");

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: {
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
      ...(req.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (req.system) {
    body.systemInstruction = { parts: [{ text: req.system }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/models/${model}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new LlmError("TIMEOUT", `Gemini request timed out after ${timeoutMs}ms`);
    }
    throw new LlmError("NETWORK", err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await safeText(response);
    const apiMessage = extractApiMessage(detail);
    if (response.status === 429) {
      throw new LlmError("RATE_LIMITED", `Gemini 429: ${retryHint(detail)}`);
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      /API_KEY_INVALID|api key not valid|permission denied/i.test(detail)
    ) {
      throw new LlmError("AUTH", `Gemini ${response.status}: ${apiMessage}`);
    }
    if (response.status >= 500) {
      throw new LlmError("SERVER", `Gemini ${response.status}: ${apiMessage}`);
    }
    throw new LlmError("INVALID_OUTPUT", `Gemini ${response.status}: ${apiMessage}`);
  }

  const data = (await response.json()) as GeminiApiResponse;
  const candidate = data.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST") {
    throw new LlmError("BLOCKED", `Gemini blocked the response (${finish})`);
  }
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) {
    throw new LlmError("BLOCKED", `Gemini returned no text (finishReason=${finish ?? "none"})`);
  }

  const usage = data.usageMetadata ?? {};
  return {
    text,
    promptTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    totalTokens: usage.totalTokenCount ?? 0,
  };
}

interface GeminiApiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/** Pull a clean `.error.message` out of a Gemini error body, else a short slice. */
export function extractApiMessage(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    /* not JSON */
  }
  return detail.replace(/\s+/g, " ").slice(0, 200);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** Pull "retryDelay":"34s" out of a 429 body if present. */
export function retryHint(detail: string): string {
  const match = detail.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return match ? `retry after ${match[1]}s` : "no retry hint";
}

export function retryDelayMs(message: string): number | undefined {
  const match = message.match(/retry after (\d+(?:\.\d+)?)s/);
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined;
}
