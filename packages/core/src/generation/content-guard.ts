/**
 * Deterministic guard against a specific model failure mode: writing a
 * question/flashcard whose content is really just a paraphrase of the job
 * posting's own screening line ("What degree is required for this role?"),
 * rather than the underlying knowledge that line implies. A prompt
 * instruction alone was not reliable enough in practice (verified against a
 * real posting) — this backstops it with a plain text check, the same way
 * coverage and schedule allocation are deterministic rather than trusted to
 * the model.
 *
 * Deliberately a denylist, not a rewrite: a flagged item is dropped, never
 * "fixed" by us — inventing a replacement would be worse than one fewer card.
 */

const POSTING_FRAMING_PATTERNS: RegExp[] = [
  /\bthis role\b/i,
  /\bthe role\b/i,
  /\bthis position\b/i,
  /\bthe position\b/i,
  /\bthis job\b/i,
  /\bfor this [a-z0-9\s/&-]{0,40}\brole\b/i,
  /\bcandidates?\b/i,
  /\bapplicants?\b/i,
  /\bnice[- ]to[- ]have\b/i,
  /\bqualifying\b/i,
  /\bqualifications?\b/i,
  /\brequirements? for\b/i,
  /\brequired for\b/i,
  /\bpreferred for\b/i,
  /\bevaluation process\b/i,
  /\bthis requirement\b/i,
  /\bthe requirement\b/i,
  /\bthis (job )?posting\b/i,
  /\bthis (job )?listing\b/i,
];

/** True if the text reads as being about the posting/role, not the underlying skill. */
export function mentionsPostingFraming(text: string): boolean {
  return POSTING_FRAMING_PATTERNS.some((re) => re.test(text));
}

/** Convenience for a {front,back} / {prompt,answer_outline}-shaped item. */
export function isPostingFramed(parts: string[]): boolean {
  return parts.some((p) => mentionsPostingFraming(p));
}
