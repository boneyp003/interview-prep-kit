# Deploying (free tier, no card required unless noted)

Three services:

| Service | Host | Plan |
| --- | --- | --- |
| `packages/web` (Next.js) | [Vercel](https://vercel.com) | Hobby (free) |
| `packages/api` (Express) | [Render](https://render.com) or [Fly.io](https://fly.io) | Free |
| MongoDB | [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) | M0 cluster (free forever) |

Two ways to get the code to Render/Vercel:

- **Option A — git-based.** Push to a repo, connect it in each dashboard.
  Simplest, but the repo has to live somewhere (GitHub, GitLab, etc.).
- **Option B — no git hosting at all.** Deploy straight from your local
  folder with each platform's CLI. Nothing is pushed anywhere. This is the
  path below; Option A is documented afterward for reference.

Do MongoDB first either way — the API needs the connection string before it
can start, and the web app needs the API's URL before it can be deployed.

## 1. MongoDB Atlas

1. Create a free account, then **Create a cluster** → **M0 Free**.
2. **Database Access** → add a user (username/password auth).
3. **Network Access** → add `0.0.0.0/0` (allow from anywhere — simplest for a
   free-tier demo; neither Render nor Fly's free tiers have static egress IPs
   to allowlist instead).
4. **Connect** → **Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/interview-prep-kit?retryWrites=true&w=majority
   ```
   Keep the database name (`interview-prep-kit`) in the path — Mongoose uses
   whatever's there.

## 2. API — Fly.io, deployed straight from your folder (no git)

Fly's free allowance requires a card on file for verification, but normal use
here stays inside it — it's a "free forever" registration gate, not a bill.

1. Install the CLI and sign up/in (this is the only step that touches your
   browser — everything else is the CLI):
   ```bash
   curl -L https://fly.io/install.sh | sh
   fly auth signup   # or: fly auth login
   ```
2. From the **repo root** (Fly needs the whole monorepo as build context, for
   the `@ipk/core` workspace dependency):
   ```bash
   fly launch --no-deploy
   ```
   It detects the `Dockerfile` at the repo root (added alongside this file —
   see below) and asks:
   - **App name**: anything unique, e.g. `your-name-interview-prep-api`
   - **Region**: nearest to you
   - **Postgres / Redis**: say **no** to both — this app uses Atlas, not a
     Fly-managed database
   - **Deploy now?**: say **no** — set secrets first (next step)
3. Set the environment variables as Fly **secrets** (encrypted, never appear
   in `fly.toml` or logs):
   ```bash
   fly secrets set \
     NODE_ENV=production \
     GEMINI_API_KEY="<your key>" \
     AUTH_SECRET="$(openssl rand -hex 32)" \
     MONGODB_URI="<your Atlas connection string>" \
     WEB_ORIGIN="https://placeholder.vercel.app" \
     BLOCK_PRIVATE_ADDRESSES=true
   ```
   (`WEB_ORIGIN` gets a real value once the web app is deployed in step 3 —
   `fly secrets set WEB_ORIGIN=...` again then.)
4. Deploy:
   ```bash
   fly deploy
   ```
   This tars up the local repo (respecting `.dockerignore`) and sends it
   directly to Fly's build service — nothing is pushed to any git remote.
5. Verify and note the URL:
   ```bash
   fly status                              # shows https://<app-name>.fly.dev
   curl https://<app-name>.fly.dev/health  # {"ok":true}
   ```
   A machine that's scaled to zero cold-starts on the next request — same
   trade-off as Render's free tier (see the note at the end of this file).

## 3. Web — Vercel, deployed straight from your folder (no git)

1. Install the CLI and log in:
   ```bash
   npm install -g vercel
   vercel login
   ```
2. From the **repo root** (same reason as Fly — Vercel's monorepo support
   needs to see the root `package.json`'s `workspaces` field to resolve
   `@ipk/core`):
   ```bash
   vercel link
   ```
   Answer the prompts to create a new project. This uploads nothing yet — it
   just writes `.vercel/project.json` locally.
3. In the Vercel dashboard for the new project → **Settings** → **General** →
   **Root Directory** → set to `packages/web`. (This is a build-time setting
   independent of git; it works the same for a CLI-linked project.)
4. Add the environment variable (**Settings** → **Environment Variables**, or
   `vercel env add`):
   | Key | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_BASE` | your Fly URL from step 2.5, e.g. `https://your-name-interview-prep-api.fly.dev` |
5. Deploy:
   ```bash
   vercel --prod
   ```
   This uploads the local directory tree directly to Vercel's build servers —
   again, no git host involved at any point.
6. Copy the resulting `https://<project>.vercel.app` URL back into the API's
   `WEB_ORIGIN` secret and redeploy the API so CORS allows it:
   ```bash
   fly secrets set WEB_ORIGIN="https://<project>.vercel.app"
   ```
   (Setting a secret triggers a redeploy automatically.)

### Why the session cookie still works across two different hosts

`next.config.mjs` rewrites `/api/*` to `NEXT_PUBLIC_API_BASE`. That rewrite
runs server-side in production too (Vercel proxies it), so the browser only
ever talks to your `vercel.app` domain — the session cookie is first-party the
whole time, even though the API process actually lives on `fly.dev`. No
`SameSite=None` cross-site cookie dance needed; `config.ts` sets it correctly
for production as a fallback, but the rewrite means you shouldn't need it.

## 4. Verify

```bash
curl https://<your-app>.fly.dev/health         # {"ok":true}
curl https://<your-app>.vercel.app/api/health  # same, via the rewrite
```

Then open the Vercel URL, register, and create a kit.

## Running the batch command against a deployed API

`npm run evaluate` doesn't need any of the above — it talks to Gemini and the
open web directly, not to your deployed API. Run it locally or in CI with just
`GEMINI_API_KEY` set; see the [README](README.md#batch-command-section-9).

---

## Option A — git-based deploy (reference)

If you'd rather connect a repo instead of using the CLIs above:

**API on Render:**
1. Push the repo to a git host (GitHub, GitLab, or self-hosted) and connect
   it in Render's dashboard: **New** → **Web Service**.
2. Settings: **Root Directory** blank (repo root), **Build Command**
   `npm install`, **Start Command** `npm run -w @ipk/api start`, **Instance
   Type** Free.
3. **Environment** → same variables as the Fly `secrets set` list above,
   *except* leave `PORT`/`API_PORT` unset — Render injects `PORT` itself and
   the API reads it automatically (`config.ts` prefers `PORT` over
   `API_PORT` for exactly this).
4. Deploy. Render free instances **spin down after 15 minutes idle** and
   cold-start in ~30–50s on the next request. A generation interrupted by a
   restart is recovered honestly: on boot the API marks any kit stuck
   `running` as `failed` (`sweepInterruptedJobs`), so the user sees a clear
   failed state with a retry option, not a silent hang.

**Web on Vercel:**
1. **New Project** → import the same repo.
2. **Root Directory**: `packages/web`; framework auto-detected.
3. **Environment Variables**: `NEXT_PUBLIC_API_BASE` = your Render URL.
4. Deploy, then copy the Vercel URL back into Render's `WEB_ORIGIN` and
   redeploy the API.

Everything else (the cookie/rewrite note, verification, the batch command) is
identical to Option B above.
