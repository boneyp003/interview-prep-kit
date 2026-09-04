# Deploying (free tier, no card required)

Three services, three free-tier accounts, nothing paid:

| Service | Host | Plan |
| --- | --- | --- |
| `packages/web` (Next.js) | [Vercel](https://vercel.com) | Hobby (free) |
| `packages/api` (Express) | [Render](https://render.com) | Free Web Service |
| MongoDB | [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) | M0 cluster (free forever) |

Do them in this order — API and DB first, since the web app needs the API's URL.

## 1. MongoDB Atlas

1. Create a free account, then **Create a cluster** → **M0 Free**.
2. **Database Access** → add a user (username/password auth).
3. **Network Access** → add `0.0.0.0/0` (allow from anywhere — simplest for a
   free-tier demo; Render's free plan doesn't have static egress IPs to
   allowlist instead).
4. **Connect** → **Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/interview-prep-kit?retryWrites=true&w=majority
   ```
   Keep the database name (`interview-prep-kit`) in the path — Mongoose uses
   whatever's there.

## 2. Render (API)

1. Push this repo to GitHub (Render deploys from a git repo).
2. **New** → **Web Service** → connect the repo.
3. Settings:
   - **Root Directory**: leave blank (repo root — the monorepo needs the
     workspace install)
   - **Build Command**: `npm install`
   - **Start Command**: `npm run -w @ipk/api dev` (runs under `tsx`, no build
     step needed — see [AGENTS.md](AGENTS.md) for why the API runs under `tsx`
     in production too)
   - **Instance Type**: Free
4. **Environment** → add:
   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `GEMINI_API_KEY` | your key |
   | `GEMINI_MODEL` | `gemini-flash-lite-latest` (or leave unset — that's the default) |
   | `AUTH_SECRET` | output of `openssl rand -hex 32` — **required** in production, the app refuses to boot without it |
   | `MONGODB_URI` | the Atlas connection string from step 1 |
   | `WEB_ORIGIN` | your Vercel URL, added after step 3 (e.g. `https://interview-prep-kit.vercel.app`) — comes back to this after deploying web |
   | `BLOCK_PRIVATE_ADDRESSES` | `true` (the default — reject private/loopback company URLs in production, per brief Section 11) |

   Do **not** set `PORT` or `API_PORT` — Render injects `PORT` itself and the
   API reads it automatically.
5. Deploy. Render free instances **spin down after 15 minutes idle** and
   cold-start in ~30–50s on the next request — expected for a free tier, not a
   bug. A generation interrupted by a restart is recovered honestly: on boot
   the API marks any kit stuck `running` as `failed` (`sweepInterruptedJobs`),
   so the user sees a clear failed state with a retry option, not a silent hang.
6. Note the Render URL (`https://<your-service>.onrender.com`) — the web app
   needs it next.

## 3. Vercel (web)

1. **New Project** → import the same repo.
2. Settings:
   - **Root Directory**: `packages/web`
   - **Framework Preset**: Next.js (auto-detected)
   - Build/install commands: leave the Next.js defaults — Vercel installs the
     whole workspace from the repo root automatically when Root Directory is
     set to a workspace package.
3. **Environment Variables** → add:
   | Key | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_BASE` | your Render URL from step 2.6 |
4. Deploy. Copy the resulting Vercel URL back into Render's `WEB_ORIGIN` (step
   2.4) and redeploy the API so CORS allows it.

### Why the cookie still works across two different hosts

`next.config.mjs` rewrites `/api/*` to `NEXT_PUBLIC_API_BASE`. That rewrite
runs server-side in production too (Vercel proxies it), so the browser only
ever talks to your Vercel domain — the session cookie is first-party the whole
time, even though the actual API process lives on Render. No `SameSite=None`
cross-site cookie dance needed; `config.ts` still sets it correctly for
production as a fallback, but the rewrite means you shouldn't need it.

## 4. Verify

```bash
curl https://<your-api>.onrender.com/health        # {"ok":true}
curl https://<your-app>.vercel.app/api/health       # same, via the rewrite
```

Then open the Vercel URL, register, and create a kit.

## Running the batch command against a deployed API

`npm run evaluate` doesn't need any of the above — it talks to Gemini and the
open web directly, not to your deployed API. Run it locally or in CI with just
`GEMINI_API_KEY` set; see the [README](README.md#batch-command-section-9).
