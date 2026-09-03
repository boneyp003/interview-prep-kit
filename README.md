# Interview Prep Kit

Turns a pasted job description + a company website + a day count into a structured,
editable, practisable interview preparation kit.

> Status: **scaffolding**. This README grows as the build does; sections marked
> _TBD_ are not yet implemented.

## Architecture

A modular monorepo. The load-bearing decision: **`packages/core` is a
framework-free library.** It contains all retrieval, extraction, generation,
scheduling, coverage and validation logic and imports neither Express nor Next.
Three thin callers depend on it:

| Package | Role |
| --- | --- |
| `packages/core` | The pipeline. Pure TypeScript. Also hosts the `evaluate` CLI (Section 9) and the automated tests. |
| `packages/api` | Express: auth, sessions, MongoDB persistence, long-running job tracking. Thin controllers that call `core`. |
| `packages/web` | Next.js + Tailwind. UI only; talks to the API over HTTP. |

This is what lets the Section 9 batch command run **the same code as the app** —
it and the API both call `core.runPipeline()`.

### Core concerns

```
core/src/
  schema/      Appendix A / B contracts + shape & integrity validation
  retrieval/   SSRF-guarded fetch, robots.txt, crawl, link ranking, web search
  extraction/  JD -> requirements  (LLM)
  generation/  company brief + questions per (requirement, category)  (LLM)
  scheduling/  deterministic day allocation
  coverage/    deterministic gap check + second-pass loop
  pipeline/    runPipeline() orchestrator + progress events
  builder/     generated / edited / pinned state, merge-on-regenerate
  cli/         evaluate.ts  (npm run evaluate)
```

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | The kit schema has strict cross-field invariants (stable ids, id references, integer durations). Zod + types catch violations at the boundary. |
| LLM | Google Gemini `gemini-2.5-flash` | Genuine free tier, generous tokens-per-minute, native JSON output, single API key, no card required. |
| Web search | DuckDuckGo HTML endpoint (`html.duckduckgo.com`) | No API key needed on any free tier. Plain queries (`<company> interview process`), a reddit-scoped fallback, results re-ranked so first-hand candidate discussion (reddit / glassdoor / blind / levels.fyi / HN) leads. A desktop UA is sent for these requests only — the endpoint returns an empty page to bot UAs; the use is read-only. Degrades to an empty result set (never fatal). |
| DB | MongoDB via Mongoose | Per the preferred stack. Kit is a document; fits the nested Appendix A shape directly. |
| LLM output contract | `responseMimeType: application/json` + our own Zod validate & repair (no `responseSchema`) | Gemini's `responseSchema` supports only an OpenAPI subset and couples every prompt to a converter. Validating ourselves with one corrective retry is more robust and keeps the schema single-sourced. |
| LLM pacing | Shared client-side RPM **and** TPM budget (rolling 60s window) + retry with server `retryDelay` | The brief warns free tiers cap tokens-per-minute, not just requests. One budget across the whole run so every step slows together. |
| Auth | _TBD_ | Minimal per brief. Leaning JWT in an httpOnly cookie. |

### Deterministic, never handed to the model

- **Schedule allocation** — distributing topics across exactly N days, must-haves
  all present, harder/higher-priority earlier. `core/src/scheduling`.
- **Coverage check** — diffing extracted requirements against generated questions.
  `core/src/coverage`.
- **Structure validation** — `core/src/schema/kit.ts` (`validateKit`).

## Rigid contracts (do not drift)

- **Appendix A** kit structure — `core/src/schema/kit.ts`. Field names exact.
  Extensions (builder state) live outside this schema and are stripped before
  validation/export.
- **Section 9** batch command — `npm run evaluate -- --input <cases.json> --output <kits.json>`,
  output per **Appendix B** (`core/src/schema/batch.ts`).

## Getting started

```bash
npm install
cp .env.example .env   # fill in GEMINI_API_KEY and AUTH_SECRET
npm test               # core: schedule allocation, coverage, structure validation
```

_Run instructions for the app and the batch command: TBD._

## Coverage second pass (Section 4)

After the first draft, `checkCoverage` (deterministic) compares every requirement
id against the `requirement_ids` on the generated questions. Each requirement
with no question is a gap. The pipeline then generates one targeted call per
gap (`generateQuestionsForRequirement`) and re-checks.

**Stopping rule:** loop until *no requirement is uncovered*, or a pass makes no
progress (gap count didn't shrink — usually a model that keeps refusing a
requirement), or **3 passes** total, whichever comes first. Three is enough that
a transient bad generation gets two more chances without letting a genuinely
un-generatable requirement spin forever. `coverage.passes` records how many
checks ran; a kit that needed one gap-fill round reports `2`. If a must-have is
still uncovered when the loop stops, it stays in
`coverage.uncovered_requirement_ids` and a warning is attached — the kit is
still emitted (honest gap), not failed.

## Still to document
- Builder generated/edited/pinned state model (Section 6)
- Concurrency / double-trigger handling for slow generation (Section 13)
- Spaced-repetition choice for practice mode (Section 7)
- Edge-case handling (Section 10)
- Which sources were used (Section 2)
- Optional creativity feature, if added
