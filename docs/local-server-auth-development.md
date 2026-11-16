# Local server-managed authentication

Use this workflow with a disposable local Supabase stack and synthetic accounts.
The API stores planner changes in the project named by `SUPABASE_URL`; the
server prints that URL's **host only** at development startup. Check it before
signing in or editing anything. The ignored `.env` in another checkout may
point at production. Never copy it into a worktree for local testing.

## One-time setup per worktree

1. Run `npm ci`. An isolated worktree has neither `node_modules` nor its
   ignored `.env` automatically.
2. Start a disposable Supabase project with all repository migrations. Give
   its `supabase/config.toml` a unique `project_id` and unused local ports so
   another stack is not touched. Set `auth.site_url` to
   `http://localhost:5173` and allow only the local
   `/__stage3/auth/callback` path (including its query) for email redirects.
   `supabase init --yes` creates an **untracked** configuration; review it
   before `supabase start`. Do not link this worktree to a hosted project.
   Supabase CLI's `start` and `status` output includes local keys; keep that
   output private and out of shared logs.
3. Create an ignored, mode-600 `.env` in **this** worktree. Use the disposable
   stack's API URL, publishable key and secret key. Generate three independent
   random 32-byte base64url values for the CSRF key, session token key and rate
   key. Never use the production values. Vite reads `VITE_` values from this
   file and Express loads the same file through `dotenv/config`; run both
   commands from this worktree. Required names are:

   ```text
   VITE_PLANNIX_AUTH_MODE=server
   PLANNIX_AUTH_MODE=server
   AUTH_PORT=4000
   TRUST_PROXY_HOPS=0
   FRONTEND_ORIGIN=http://localhost:5173
   PLANNIX_SERVER_AUTH_ORIGIN=http://localhost:5173
   PLANNIX_AUTH_NETWORK_IDENTITY_MODE=direct
   SUPABASE_URL=<disposable local API URL>
   SUPABASE_PUBLISHABLE_KEY=<disposable local publishable key>
   SUPABASE_SECRET_KEY=<disposable local secret key>
   PLANNIX_SERVER_AUTH_CSRF_KEY=<independent canonical base64url key>
   PLANNIX_SESSION_TOKEN_KEYS_JSON={"local":"<independent canonical base64url key>"}
   PLANNIX_SESSION_TOKEN_ACTIVE_KEY_ID=local
   PLANNIX_AUTH_RATE_KEY=<independent canonical base64url key>
   PLANNIX_AUTH_RATE_EPOCH=<epoch returned by the local database>
   MORNING_SUMMARY_POLLING_ENABLED=false
   MORNING_SUMMARY_WORKER_ENABLED=false
   MORNING_SUMMARY_DETAIL_DISPLAY_ENABLED=false
   ```

   Leave `PORT`, `NODE_ENV`, `VITE_API_BASE_URL`, analytics settings and the browser
   `VITE_SUPABASE_*` variables unset. The server-mode browser bundle has no
   Supabase session client. `PORT`, if set, overrides `AUTH_PORT`.
4. The rate migration starts paused. On the **disposable local database only**,
   derive the non-secret tag as
   `HMAC-SHA256(PLANNIX_AUTH_RATE_KEY, 'plannix-auth-rate-key-v1')`, call
   `private.plannix_auth_rate_prepare_epoch(tag)` once, save its returned
   positive integer as `PLANNIX_AUTH_RATE_EPOCH`, and call
   `private.plannix_auth_rate_resume(epoch)` after the required 60-second
   database-clock wait. Check that it returns `true`. Do not guess an epoch or
   bypass the limiter. `supabase db query --local` targets only this stack.

## Run and verify

In separate terminals, from the same worktree:

```bash
npm run server
npm run dev
```

Open `http://localhost:5173/`, not the API port or `127.0.0.1`. The server
prints `Local auth mode: server; Supabase host: ...`; confirm that host is the
disposable backend. Vite proxies auth and planner requests to localhost:4000
without changing the Host. Server mode fixes Vite to port 5173 and fails if
that port is occupied, since silently moving ports would fail exact Origin,
Host and callback checks. The browser's `Secure; HttpOnly; SameSite=Lax`
cookies remain unchanged; use a browser that accepts Secure cookies on
`localhost`. A separate browser profile avoids mixing cookies from another
local Plannix run. Use synthetic local accounts only.

After sign-in, check that `/__stage3/auth/status` reports an authenticated
ordinary session and that a protected page such as Personal profile loads.
The production build still requires matching `dist/auth-mode.json` and
runtime mode. A stale `dist` build cannot prevent the development API from
starting, and the API never serves that mismatched build: use the Vite URL.
Do not use local `.env` values to make a production build or deployment.
