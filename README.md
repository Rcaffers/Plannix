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

Vite proxies `/auth`, `/api`, and `/holidays` to `http://localhost:4000` during development.

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

Client build:

- `VITE_API_BASE_URL` — leave **unset** when the API is served from the **same** host as the UI (typical `npm start` / DigitalOcean single service). Never deploy a build that still contains a **local** URL (e.g. `http://localhost:4000` from your machine’s `.env`)—the browser cannot reach it. For a **separate** API host, set this to the public **https** base URL (no trailing slash).

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
- `server/server.js` — environment validation, application initialization, and HTTP startup
- `server/auth-server.js` — legacy auth and database routes retained during the staged refactor
- `server/config/` — environment and CORS configuration
- `server/middleware/` — API 404 and fallback error responses
- `server/routes/` — route groups for contact, holidays, and planner data APIs
- `server/sql/` — database migrations
