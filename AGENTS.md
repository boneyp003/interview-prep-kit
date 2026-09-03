# AGENTS.md

Operational guide for AI agents working in this repo. Human-facing docs and the
"why" behind decisions are in [`README.md`](README.md); this file is the
short version plus the things that will bite you.

## What this is

A monorepo that turns `(job description, company URL, days)` into a structured,
editable interview-prep kit. `packages/core` is a framework-free pipeline
library; `packages/api` (Express) and `packages/web` (Next.js) are thin callers;
`packages/core/src/cli` is the batch entry point. The API job runner and the CLI
both call the same `runPipeline()`.

## Commands

```bash
npm install
npm test               # core (node:test) + api (node:test + mongodb-memory-server)
npm run test:core
npm run test:api
npm run typecheck      # all three packages
npm run build          # typecheck + next build
npm run dev            # API :4000 + web :3000  (needs MongoDB at MONGODB_URI)
npm run evaluate -- --input <cases.json> --output <kits.json> [--verbose]
```

- Everything runs under **`tsx`** — no build step for dev/test/CLI/prod. Only the
  web app is compiled (`next build`).
- API tests download a mongod binary on first run (cached after).
- There is no linter wired up; `tsconfig.base.json` is strict
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — treat typecheck as
  the gate.

## Layout

```
packages/core/src/
  schema/      Appendix A (kit) + Appendix B (batch) as Zod + cross-field checks
  config/      loadCoreConfig() — the ONLY place core reads process.env
  retrieval/   url-guard (SSRF), rate-limiter, http, robots, clean, link-ranking, crawl, search
  extraction/  requirements.ts — JD -> role + requirements (LLM)
  generation/  llm/ (gemini transport, budget, json repair, LlmClient);
               hiring-process, company-brief, question-plan (deterministic),
               questions, flashcards; prompts/untrusted.ts
  scheduling/  buildSchedule() — deterministic
  coverage/    checkCoverage(), planGapFill() — deterministic
  pipeline/    run.ts (runPipeline), types.ts (ProgressEvent, ResearchSnapshot, PipelineError)
  builder/     state.ts (itemState overlay), regenerate.ts (section regen merges)
  practice/    confidence-weighted Leitner scheduling
  insights/    weak-spots.ts (optional feature)
  cli/         evaluate.ts (arg/IO shell) + batch.ts (runBatch — the tested core)
  util/        ids.ts (IdAllocator)

packages/api/src/
  app.ts / server.ts        express app factory + bootstrap
  config.ts                 ApiConfig (wraps loadCoreConfig)
  auth/                     scrypt password, JWT cookie, requireAuth middleware
  db/models/                User, Kit (Mongoose; kit/itemState/research are Mixed)
  jobs/                     registry (in-process), runner (persists progress), index (test seam)
  kits/                     service (CRUD + dedupe), routes, builder-routes, practice-routes,
                            mutate.ts (validate-before-persist gate), serialize.ts
  http/                     AppError, errorHandler, validateBody

packages/web/src/
  lib/       api.ts (fetch wrapper), auth.tsx, useKit.ts, types.ts, clsx.ts
  components/ KitBuilder, GenerationProgress, InlineEdit, CreateKitForm, WeakSpots, ui, ...
  app/       App Router pages
```

## Rules that must not drift

1. **Appendix A / B are exact contracts** (`schema/kit.ts`, `schema/batch.ts`).
   The evaluator runs the pipeline against unseen JDs and diffs the output shape.
   Field names are fixed. You may *add* fields; never rename or remove. Any
   builder-state / provenance data lives **outside** the kit object
   (`itemState`, `sectionState`, `research` on the Kit doc), never inside the
   Appendix A structure.
2. **`packages/core` imports no framework.** No Express, no Next, no `req`/`res`,
   no `process.argv`. It reads env only through `config/index.ts`. If you need
   core to do something HTTP-shaped, pass it in.
3. **Deterministic steps stay in code, never the model:**
   - requirement→category routing (`generation/question-plan.ts`)
   - schedule allocation (`scheduling/`)
   - coverage check + gap planning (`coverage/`)
   - structure validation (`schema/kit.ts` `validateKit`)
   Tests for these three areas are the ones "most worth protecting" — keep them
   green and add to them when you touch the logic.
4. **Ids are assigned by our code, never by the model.** `IdAllocator`
   (`util/ids.ts`) seeds from existing ids so regeneration never collides with a
   kept hand-edited item. Prompts ask the model to *reference* requirement ids,
   not mint new ones; unknown references are dropped.
5. **Untrusted content is fenced.** Every JD and every scraped page goes through
   `untrustedBlock()` and the `UNTRUSTED_CONTENT_SYSTEM_CLAUSE`. Do not
   interpolate scraped/pasted text into a prompt raw.
6. **The kit save gate is `mutateKit` / `validateKit`.** A mutation works on a
   deep clone and only persists if the result still validates (422 otherwise).
   Keep new builder endpoints on that path.

## Pipeline behaviour contract

- A retrieval source that fails → recorded in `outcome.skipped` + a warning,
  **run continues**. Only fatal: `LlmError` code `AUTH`, or the assembled kit
  fails `validateKit` (`PipelineError`).
- `extract-requirements` failing is fatal (no requirements = no kit); every
  other LLM step degrades to an honest placeholder + warning.
- Coverage loop: `MAX_COVERAGE_PASSES = 3` in `pipeline/run.ts`; stops on no
  gaps / no progress / cap. `coverage.passes` = number of checks performed.
- Batch: `status: "failed"` only when no kit at all. Partial research →
  `status: "ok"` with gaps in `kit.coverage`.
- Thin JD → thin kit that says so; **never invent requirements**.

## Gotchas (learned the hard way)

- **`.gitignore`:** a bare `coverage/` once swallowed `src/coverage/`. All
  build/coverage-output patterns are now anchored (`/coverage/`,
  `packages/*/coverage/`). Don't add unanchored directory names.
- **Core package `main`/`types` point at `src/index.ts`** (not `dist`) so `tsx`
  resolves it with no build. If you add a new top-level module to core, export
  it from `src/index.ts` or API/web can't see it.
- **`node --test` glob must be quoted** in package.json (`"src/**/*.test.ts"`),
  otherwise the shell expands `**` as `*` and silently runs a subset.
- **`.env` lives at the repo root.** `server.ts` walks up (`.env`, `../.env`,
  `../../.env`) because `npm -w @ipk/api dev` runs from `packages/api`.
- **LLM model reality:** `gemini-2.5-flash*` return "no longer available" for new
  keys in the test env; `gemini-flash-latest` is heavily rate-limited. Default is
  `gemini-flash-lite-latest`. `-lite` models reject `thinkingConfig`, so
  `gemini.ts` only sends it for non-lite models — keep that guard if you touch
  the request body.
- **Rate limits:** the free tier is ~20 req/min. `LlmBudget` paces RPM+TPM and
  `penalize()`s the whole run on a 429; retries honour the server `Retry-After`
  **exactly** (do not cap it below the hint). One shared `LlmClient` +
  `Retrieval` across all batch cases — don't construct per-case clients.
- **Next ↔ API:** the browser only ever calls `/api/*` (same-origin); Next
  rewrites to the API server. Keeps the session cookie first-party. Don't make
  the web client call `:4000` directly.
- **Mongoose:** `kit`, `itemState`, `research`, `practice`, `progress` are
  `Schema.Types.Mixed`. Zod is the schema authority. After mutating a nested
  Mixed field, call `doc.markModified(...)`.

## When you change generation prompts / schemas

Run `npm run evaluate -- --input packages/core/fixtures/cases.example.json
--output /tmp/check.json --verbose` and confirm `validateKit` passes on the
output (the CLI already validates the batch envelope; check individual kits if
you changed `schema/kit.ts`). `docs/sample-kit.json` is a known-good reference.

## Commit style

Small, focused, imperative subject; body explains the *why* when non-obvious.
End messages with the `Co-Authored-By` trailer already used in the history.
