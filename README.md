# Interview Prep Kit

Turns a pasted job description + a company website + a day count into a
structured, editable, practisable interview-preparation kit: a company brief, a
role breakdown, a categorised question bank, flashcards, and a day-by-day study
schedule.

---

## Quick start

```bash
npm install
cp .env.example .env          # set GEMINI_API_KEY (free) and AUTH_SECRET
# start MongoDB somewhere reachable at MONGODB_URI (default localhost:27017)

npm run dev                   # API on :4000, web on :3000
```

Open http://localhost:3000, register, paste a JD + company URL, watch it build.

Run the tests (schedule allocation, coverage checking, structure validation,
builder-state merges, auth/ownership, batch runner):

```bash
npm test
```

Run the pipeline headless over a set of cases (Section 9):

```bash
npm run evaluate -- --input packages/core/fixtures/cases.example.json --output kits.json
```

You need: Node ≥ 20, a MongoDB instance, and a Google Gemini API key (free tier,
no card — https://aistudio.google.com/apikey). Nothing else is paid.

---

## Architecture

A modular monorepo. **`packages/core` is a framework-free library** — all
retrieval, extraction, generation, scheduling, coverage and validation logic,
with no dependency on Express or Next. Three thin callers use it:

| Package | Role |
| --- | --- |
| `packages/core` | The pipeline. Also hosts the `evaluate` CLI and the domain tests. |
| `packages/api` | Express: auth, sessions, MongoDB persistence, generation-job tracking. Thin controllers over `core`. |
| `packages/web` | Next.js + Tailwind. UI only; talks to the API. |

This is what lets the Section 9 batch command run **the same code as the app** —
`core/src/cli/batch.ts` and the API's job runner both call `runPipeline()`.

```
core/src/
  schema/      Appendix A / B contracts; shape + cross-field validation
  config/      the only place core reads process.env
  retrieval/   SSRF-guarded fetch, rate limiter, robots, crawl, link ranking, DDG search
  extraction/  JD -> role + requirements (LLM)
  generation/  llm client (budget, retry, JSON repair); hiring-process, brief,
               question-plan (deterministic routing), questions, flashcards
  scheduling/  deterministic day allocation
  coverage/    deterministic gap check + gap-fill planning
  pipeline/    runPipeline() orchestrator, progress events, research snapshot
  builder/     generated/edited/pinned overlay; regenerate-section merges
  practice/    confidence-weighted Leitner scheduling
  cli/         evaluate.ts (shell) + batch.ts (runBatch)
```

---

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | The kit schema has strict cross-field invariants (stable ids, id references, integer durations). Zod + types catch violations at the boundary. |
| LLM | Google Gemini, `gemini-flash-lite-latest` | Genuine free tier, native JSON output, single API key. `-latest` is an alias so the model does not go stale; `flash-lite` is tuned for exactly this kind of high-volume structured call and has roomier free limits. "Thinking" is disabled — these are structured calls and thinking tokens eat the per-minute budget. |
| LLM output | `responseMimeType: application/json` + our own Zod validate & repair (no `responseSchema`) | Gemini's `responseSchema` supports only an OpenAPI subset and couples every prompt to a converter. One corrective retry on our side is more robust and keeps the schema single-sourced. |
| LLM pacing | Shared client-side RPM **and** TPM budget (rolling 60s window); retries honour the server `Retry-After` exactly | The brief warns free tiers cap tokens-per-minute, not just requests. One budget across the whole run so every step — and every concurrent batch case — slows together. |
| Web search | DuckDuckGo HTML endpoint | No API key on any free tier. Plain queries + a reddit-scoped fallback; results re-ranked so first-hand candidate discussion leads. A desktop UA is sent for these read-only requests (the endpoint returns nothing to bot UAs). Degrades to empty, never fatal. |
| DB | MongoDB / Mongoose | Preferred stack. The kit is one document; the nested Appendix A shape maps directly. `kit`, `itemState`, `research` are stored as `Mixed` — Zod is the schema authority, not Mongoose. |
| Auth | JWT in an httpOnly cookie | Minimal, per the brief. No server-side session store to run. `SameSite=Lax` in dev, `None; Secure` in production. |
| Web ↔ API | Next rewrites `/api/*` to the API server | The session cookie stays first-party; no browser CORS. |
| Dev/test/CLI runtime | `tsx` (TypeScript executed directly) | No build step for `npm run dev`, `npm test`, or `npm run evaluate`. `core`'s package `main`/`types` point at source. `npm run build` still emits JS for a production `node` deploy. |

### Deterministic — never handed to the model

- **Requirement → category routing** (`generation/question-plan.ts`) — a
  "5 years of React" requirement produces technical (and, if the hiring process
  uses it, system-design) questions; "mentor junior engineers" produces
  behavioural ones. Different code path, different prompt, different call.
- **Schedule allocation** (`scheduling/`) — arithmetic over the questions and
  the day count.
- **Coverage check** (`coverage/`) — set difference between requirement ids and
  the ids the questions cover.
- **Structure validation** (`schema/kit.ts`) — the gate before any kit is saved
  or emitted.

---

## The pipeline (Section 3)

`runPipeline()` runs twelve steps in an order where each consumes what the
previous ones actually found:

1. **extract-requirements** — from the pasted JD alone. No retrieval. Stable ids
   (`r1`, `r2`, …) assigned in code. The prompt forbids inventing requirements;
   a two-line stub yields a thin kit that says so.
2. **crawl-company** — fetch the entry URL (which may carry a path and may be
   `localhost`), rank its links by hiring/about relevance (weighted keyword
   signals, **not** a fixed path list), follow the best breadth-first within a
   page budget. Relative links resolve against the page they were found on.
3. **find-interview-discussion** — DDG search on the company name.
4. **analyse-hiring-process** — distil the hiring pages + discussion into
   structured stages / formats / themes, or `found: false`.
5. **company-brief** — from the about/entry pages; `sources` is set in code to
   the URLs actually used; an honest "could not be researched" brief when
   nothing usable came back.
6. **plan-questions / generate-questions** — deterministic routing (step 5's
   discovered formats change which categories are generated), then one LLM call
   per category with per-requirement id targeting.
7. **coverage-pass** — the loop (see below).
8. **generate-flashcards** — requirement-referenced recall cards.
9. **build-schedule** — deterministic.
10–12. **assemble → validate**.

A retrieval source that fails is recorded as a skipped source + a warning and
the run continues. The only fatal outcomes: the LLM key is missing/invalid, or
the assembled kit fails structural validation.

### The coverage second pass (Section 4)

After the first draft, `checkCoverage` finds every requirement with no question
against it. The pipeline generates one targeted call per gap and re-checks.

**Stopping rule:** loop until nothing is uncovered, or a pass makes no progress,
or **3 passes**, whichever is first. Three gives a transient bad generation two
more chances without letting a genuinely un-generatable requirement spin
forever. `coverage.passes` records the number of checks (a kit that needed one
gap-fill round reports `2`). If a must-have is still uncovered when the loop
stops it stays in `coverage.uncovered_requirement_ids` with a warning — the kit
still ships (honest gap), it is not failed.

---

## Builder state (Section 6)

The kit always stays in canonical Appendix A shape. Provenance lives in a
parallel overlay, `itemState`, keyed by item id:

```
origin  "generated" | "user"    who created this item
edited  boolean                 a generated item the user has since changed
pinned  boolean                 user asked to keep it across regenerations
```

plus `sectionState` edited-flags for the two derived sections (brief, schedule).

**Regenerating one section** (`builder/regenerate.ts`) reuses the `research`
snapshot captured at first generation — no re-crawl. For a question category it:

1. keeps every question **outside** that category,
2. keeps in-category questions that are `origin: user`, `edited`, or `pinned`,
3. drops only the untouched generated ones,
4. generates fresh questions for the category's requirements and assigns new,
   non-colliding ids,
5. reconciles the schedule (prune dangling ids; append new ones to the lightest
   day — unless the schedule was hand-edited, in which case only pruning
   happens) and recomputes coverage.

So a hand-written question, or a generated one you rewrote, **survives** a
regeneration of its category; edits to the brief or the schedule are untouched
by it. Every builder mutation goes through `mutateKit`, which validates the
draft and only persists a structurally valid kit (422 otherwise) — a bad edit
never corrupts the stored kit.

---

## Practice mode (Section 7)

**Confidence-weighted Leitner intervals.** Each card sits in a box (1–5) equal
to its last confidence rating; the review interval grows with the box
(10 min → 1 d → 2 d → 4 d → 8 d) and a low rating drops it back to box 1.
Simpler than SM-2 (no per-card ease factor to store or tune) but it still
spaces out what you know and resurfaces what you don't — which is what a few
days of prep needs.

The next session is ordered least-confident-first (unseen counts as 0), then
most overdue. The summary shows reviewed/due counts, a confidence histogram, and
which requirements have no practised flashcard yet.

---

## The schedule (Section 8)

`buildSchedule` is pure arithmetic. Guarantees, all covered by tests:

- exactly `days_available` days, numbered `1..N`;
- every question placed on some day;
- every must-have requirement represented (follows from placing every question);
- questions weighted by priority then difficulty, split across days by
  target-minutes-per-day, so harder / higher-priority material lands earlier;
- per-question minutes from difficulty (+15 for system-design), integer
  throughout;
- **1-day** request → everything on day 1; **60-day** request → study
  front-loads and later days become expanding-interval revision days revisiting
  the hardest questions (no empty days); a JD with no requirements → N
  light-review days, still well-formed.

---

## Batch entry point (Section 9)

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Reads `[{ id, jd, company_url, days }]`; writes one Appendix B document.
`cli/batch.ts::runBatch` is framework-free and is the code under test.

- One LLM client + one retrieval bundle **shared across all cases**, so the
  per-minute budget and rate limiter govern the whole run.
- Small worker pool (`--concurrency`, default 3), input order preserved.
- Per-case hard timeout (`--case-timeout`, default 240 s) → reported as a
  failed entry, not an abort.
- A case that throws becomes `{ status: "failed", error: { code, message } }`
  and the run continues. The output is validated against the Appendix B schema
  before it is written.
- `--block-private` re-enables SSRF blocking (off by default here so `localhost`
  fixtures resolve); relative links are always followed and no host is assumed.
- Runs from a clean clone with only the documented env vars.

**`ok` vs `failed`:** a company we could only partially research is `ok`, with
the gaps recorded in `kit.coverage` and an honest brief — per Appendix B, a
missing hiring page or an unreachable site is not a failure. `failed` is
reserved for cases where no kit could be produced at all.

---

## Concurrency & the slow, failure-prone bits (Section 13)

- **Generation runs in-process** in the API (no Redis/queue dependency on a free
  tier). Progress is streamed to Mongo (throttled ~1.5 s) so a kit can be
  reopened mid-flight; terminal states are written atomically.
- **Triggered twice for the same posting:** a per-user `inputHash`
  (sha256 of normalised jd + url). A queued/running/ready kit for the same input
  is returned as-is (`deduped: true`); a previously failed one is retried in
  place. An in-process `jobRegistry` also blocks a second concurrent run of one
  kit.
- **Fails halfway / server restart:** `sweepInterruptedJobs()` on boot marks any
  kit left `running` as `failed` with an `INTERRUPTED` code so the user can
  retry.
- **Takes 90 s:** the UI polls `/kits/:id/progress` and shows every step with
  skip/error states; the kit page and the list both keep polling while anything
  is in flight.

---

## Security (Section 11)

- **SSRF:** `retrieval/url-guard.ts` — http(s) only, no credentials in the URL,
  DNS-resolve the host and reject private / loopback / link-local ranges
  (IPv4 + IPv6). Every redirect hop is re-checked. `BLOCK_PRIVATE_ADDRESSES`
  toggles it (on in the app/production, off for the localhost batch fixtures).
- **Content:** `text/html` / `text/plain` only; body-size cap; request timeout.
- **Prompt injection:** every JD and every fetched page is wrapped in a
  nonce-fenced `BEGIN_UNTRUSTED_CONTENT … END_UNTRUSTED_CONTENT` block, and a
  standing system clause tells the model that anything inside such a block is
  data to analyse, never instructions to follow.
- **Auth:** signed-out requests cannot reach any `/kits` route or endpoint;
  a kit is fetched only if `userId` matches (404, not 403, so existence does not
  leak); expired vs invalid sessions are distinguished.
- Passwords: scrypt (Node built-in), never logged.

---

## Edge cases (Section 10)

| Case | Handling |
| --- | --- |
| Company URL invalid / 404 / timeout | crawl records a skipped source + warning; kit is built from the JD with an honest brief; status `ok`. |
| No discoverable hiring/about page | `analyse-hiring-process` → `found: false`; questions fall back to a role-only mix; warning attached. |
| Two-line stub JD | `extract-requirements` returns few/no requirements + `thin: true`; kit is small and says so; no invented requirements. |
| No public interview discussion | search returns `[]`; noted; not fatal. |
| Model returns invalid / incomplete JSON | `llm/json.ts` strips fences, isolates the JSON span, repairs trailing commas / truncation; then one corrective retry showing the model its own validation errors; then `INVALID_OUTPUT`. |
| Provider rate-limits / briefly fails | typed `LlmError`; retries with backoff honouring `Retry-After`; shared budget makes the whole run back off; only a missing/invalid **key** is fatal. |
| Same description + company twice | `inputHash` dedupe (see above). |
| 1-day / 60-day schedule | see The schedule. |

---

## Sources used (Section 2)

- **Company site:** whatever the crawler ranks and fetches from the given URL —
  entry page, `/about`, and hiring pages wherever they live (GitLab's is under
  `handbook.gitlab.com/handbook/hiring/…`, PostHog's under
  `posthog.com/handbook/people/hiring-process`; neither is guessable, both are
  found by link ranking).
- **Interview discussion:** the DuckDuckGo HTML endpoint
  (`html.duckduckgo.com/html/`), results biased toward reddit, Glassdoor, Blind,
  levels.fyi and Hacker News.
- `robots.txt` is fetched and respected per origin.

---

## Tests (Section 14)

`npm test` runs core + API. The behaviour most worth protecting:

- **schedule allocation** — day count, full placement, must-have representation,
  ordering, 1/60-day extremes, empty kit;
- **coverage checking** — gap detection, multi-requirement questions, gap-fill
  planning;
- **structure validation** — Zod shape + cross-field integrity (id uniqueness
  and resolution, schedule length, coverage consistency, integer durations,
  difficulty range);
- **builder-state merges** — user/edited/pinned survival, schedule reconciliation;
- **practice scheduling** — interval growth, session ordering, summary;
- **API** — auth, anonymous/invalid-session rejection, ownership isolation,
  double-submit dedupe, request validation, builder mutations under the
  validity gate, practice flow;
- **batch runner** — Appendix B shape, per-case failure isolation, per-case day
  count, timeout-as-failure.

---

## Verified end-to-end

A real `npm run evaluate` run (model `gemini-flash-lite-latest`, live web):

- **`posthog.com`, 7 days → valid Appendix A kit in ~26 s.** 7 requirements
  (5 must), the crawler found PostHog's hiring process at
  `/handbook/people/hiring-process/engineering-hiring` (not a guessable path),
  the analysis pulled out its real stages (recruiter screen → hiring-manager
  screen → presentation → paid trial day), 14 questions across 3 categories,
  14 flashcards, a balanced 7-day schedule, `coverage.uncovered_requirement_ids:
  []` after one pass. `validateKit` and `assessKitQuality` both clean. See
  [`docs/sample-kit.json`](docs/sample-kit.json).
- **2-case batch** (`posthog.com` 5-day + `gitlab.com` 3-day) → both `ok` in
  81 s, Appendix B valid, per-case day counts respected; GitLab's 7 unreachable
  crawl targets were recorded as skipped sources, not a failure.

## Notes / trade-offs

- **Model choice under duress.** `gemini-2.5-flash` / `-flash-lite` return
  "no longer available to new users" for a fresh key in the test environment,
  and `gemini-flash-latest` resolves to a model with a ~20 req/min free ceiling.
  `gemini-flash-lite-latest` is both available and the right tool (built for
  high-volume structured calls). If your key hits limits, the pipeline paces
  itself, honours `Retry-After`, and degrades non-fatal steps — set
  `GEMINI_RPM` / `GEMINI_MODEL` in `.env` to match your tier.
- No email verification / password reset / roles — explicitly out of scope.
- Section regeneration for the brief and a question category calls the LLM
  inline (10–30 s); full generation is the async, polled path.
- Question generation is **one call per category**, not one per
  (requirement, category): the instructions differ per category and each
  requirement is targeted by id within the call, which satisfies "not from the
  same call with the same instructions" while keeping the call count viable on
  a free tier. The coverage second pass *is* per-requirement.

## Creativity feature — the "weak spots" report

`GET /kits/:id/weak-spots`, shown as a collapsible panel on the kit page.

**Problem it solves:** a finished kit has ~25 questions and ~15 flashcards
spread over a week. The candidate's real question is *where should the next hour
go?* — and neither the raw question bank nor the schedule answers that.

The report is deterministic (`core/src/insights/weak-spots.ts`). Per
requirement it combines three signals the app already tracks — how many
questions target it, the average confidence of practice ratings on its
flashcards, and where it sits in the schedule — into one weakness score, with
must-haves weighted heavier, and lists the reasons ("only one question covers
this", "flashcards not practised yet", "low practice confidence (avg 2.0/5)").
It updates as you practise, so it doubles as a progress signal.
