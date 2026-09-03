/**
 * Best-effort extraction of a JSON value from a model response. Models wrap
 * JSON in ``` fences, add prose, or truncate. We strip fences, isolate the
 * outermost JSON span, and try a couple of cheap repairs before giving up.
 * Schema validation is the caller's job (see llm/index.ts).
 */
export function extractJson(raw: string): unknown {
  const cleaned = stripFences(raw).trim();

  const direct = tryParse(cleaned);
  if (direct.ok) return direct.value;

  const span = outermostSpan(cleaned);
  if (span) {
    const spanParse = tryParse(span);
    if (spanParse.ok) return spanParse.value;

    const repaired = tryParse(repair(span));
    if (repaired.ok) return repaired.value;
  }

  throw new SyntaxError("No parseable JSON in model output");
}

function stripFences(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? fence[1]! : text;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function outermostSpan(text: string): string | null {
  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start); // unterminated -> hand to repair()
}

function repair(text: string): string {
  let out = text.replace(/,\s*([}\]])/g, "$1"); // trailing commas

  // Balance quotes/brackets for a truncated response.
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (const ch of out) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inString) out += '"';
  while (stack.length) out += stack.pop() === "{" ? "}" : "]";
  return out.replace(/,\s*([}\]])/g, "$1");
}
