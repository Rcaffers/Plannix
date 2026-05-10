# Plannix

Web app for teachers: weekly timetables, classes, academic year and holidays, Week A/B cycles, and account settings. React (Vite) frontend with a Node/Express API and PostgreSQL.

## Run locally

```bash
npm install
npm run dev
```

In another terminal, run the API (requires a database URL for full auth and data):

```bash
npm start
```

Vite proxies `/auth`, `/api`, `/billing`, `/holidays`, and `/stripe` to `http://localhost:4000` during development.

## Build

```bash
npm run build
npm start
```

`npm start` serves the production build from `dist/` and the API on the same process (see `server/auth-server.js`).

## Environment

Configure the server with `.env` (see your hosting provider for secrets). Commonly used variables include:

- `SUPABASE_DB_URL` or `DATABASE_URL` — PostgreSQL connection
- `FRONTEND_ORIGIN` — browser origin(s) for CORS (comma-separated in production)
- `COOKIE_SECURE` — set `true` when serving over HTTPS
- `TRUST_PROXY_HOPS` — typically `1` behind a reverse proxy (e.g. DigitalOcean App Platform)
- Stripe keys and price ID if signup requires payment

Client build:

- `VITE_API_BASE_URL` — leave empty when the API is served from the same origin as the UI; otherwise set to the public API base URL

## Secrets scanning (Gitleaks)

```bash
brew install gitleaks   # example on macOS
npm run secrets:check
```

CI runs Gitleaks via `.github/workflows/gitleaks.yml`.

## Project layout

- `src/` — React app (pages, components, contexts, utilities)
- `server/auth-server.js` — Express app: auth, billing, timetable APIs, static `dist`
- `server/sql/` — database migrations
