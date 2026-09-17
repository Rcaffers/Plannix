# Plannix

Web app for teachers: weekly timetables, classes, academic year and holidays, Week A/B cycles, and account settings. React (Vite) frontend with a Node/Express API and Supabase.

## Run locally

```bash
npm install
npm run dev
```

In another terminal, run the API:

```bash
npm start
```

Vite proxies `/auth`, `/api`, and `/holidays` to `http://localhost:4000` during development.

## Build

```bash
npm run build
npm start
```

`npm start` serves the production build from `dist/` and the API on the same process. `server/app.js` assembles the import-safe Express application; `server/server.js` is the sole HTTP listener.

## Environment

Configure the server with `.env` (see your hosting provider for secrets). Commonly used variables include:

- `SUPABASE_URL` — Supabase project URL used by the server
- `SUPABASE_PUBLISHABLE_KEY` — public key used by request-scoped, RLS-protected data clients
- `SUPABASE_SECRET_KEY` — server-only key used solely for supported administrative operations such as account deletion
- `FRONTEND_ORIGIN` — browser origin(s) for CORS (comma-separated in production)
- `TRUST_PROXY_HOPS` — typically `1` behind a reverse proxy (e.g. DigitalOcean App Platform)
- `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, and optionally `CONTACT_FROM_EMAIL` — contact delivery

Client build:

- `VITE_SUPABASE_URL` — public Supabase project URL used by the browser client
- `VITE_SUPABASE_PUBLISHABLE_KEY` — public/publishable Supabase browser key
- `VITE_API_BASE_URL` — leave **unset** when the API is served from the **same** host as the UI (typical `npm start` / DigitalOcean single service). Never deploy a build that still contains a **local** URL (e.g. `http://localhost:4000` from your machine’s `.env`)—the browser cannot reach it. For a **separate** API host, set this to the public **https** base URL (no trailing slash).

Never expose a privileged Supabase key through a `VITE_` variable. Vite embeds these variables in browser code.

Supabase Auth is authoritative. The browser manages authentication and sends access tokens to protected Express routes. Express validates those bearer tokens, and data routes create request-scoped Supabase clients so `auth.uid()`-based row-level security remains active. Schema changes are managed through the Supabase CLI migration workflow in `supabase/migrations/`.

## Secrets scanning (Gitleaks)

```bash
brew install gitleaks   # example on macOS
npm run secrets:check
```

CI runs Gitleaks via `.github/workflows/gitleaks.yml`.

## Project layout

- `src/` — React app (pages, components, contexts, utilities)
- `src/App.jsx` — app composition, route gates, and authentication session state
- `server/app.js` — import-safe Express application entry point
- `server/server.js` — production environment validation and HTTP startup
- `server/config/` — environment and CORS configuration
- `server/middleware/` — API 404 and fallback error responses
- `server/routes/` — route groups for contact, holidays, and planner data APIs
- `supabase/migrations/` — schema migrations managed through the Supabase migration workflow
