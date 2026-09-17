import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { createDbPool } from './db.js';
import {
  DIST_DIR,
  PORT,
  corsDelegate,
} from './config.js';
import { env } from './config/env.js';
import { errorHandler, logRouteError, notFoundHandler, sendError } from './errors.js';
import { requestId } from './middleware/requestId.js';
import { registerAccountRoutes } from './routes/account-routes.js';
import { registerAcademicYearRoutes } from './routes/academic-year-routes.js';
import { registerClassRoutes } from './routes/class-routes.js';
import { registerContactRoutes } from './routes/contact-routes.js';
import { registerHolidayRoutes } from './routes/holiday-routes.js';
import { registerTimetableLayoutRoutes } from './routes/timetable-layout-routes.js';
import { registerTimetableSessionRoutes } from './routes/timetable-session-routes.js';

export const app = express();
/** Trust reverse proxy (DigitalOcean, Render, etc.) so `X-Forwarded-Proto` / host are correct for CORS and cookies. */
app.set('trust proxy', env.trustProxyHops);

const db = createDbPool();

app.use(requestId);
app.use(cors(corsDelegate));
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.status(200).end();
});

app.use(express.json({ limit: '100kb' }));

function normalizeEmailInput(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function dbGetUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const result = await withAuthDbSession((client) =>
    client.query(
      `SELECT id, name, email, password_hash AS "passwordHash"
       FROM plannix_users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [normalized],
    ),
  );
  return result.rows[0] || null;
}

async function dbCreateUser({ id, name, email, passwordHash }) {
  await withAuthDbSession((client) =>
    client.query(
      `INSERT INTO plannix_users (id, name, email, password_hash, updated_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [id, name, email, passwordHash],
    ),
  );
  return { id, name, email, passwordHash };
}

async function ensureDemoUser() {
  const demoEmail = 'teacher@plannix.test';
  const existing = await dbGetUserByEmail(demoEmail);
  if (existing) return;
  const passwordHash = await bcrypt.hash('Password123!', 10);
  await dbCreateUser({
    id: 'u_teacher_001',
    name: 'Demo Teacher',
    email: demoEmail,
    passwordHash,
  });
}

async function withAuthDbSession(work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.auth_flow', 'true', true)`);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function parseCoordinate(value) {
  const n = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeCountryCode(value) {
  const code = String(value || '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

async function fetchJsonOrThrow(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`External API request failed (${response.status}).`);
  }
  return response.json();
}

async function fetchUkBankHolidaysForYear(year) {
  const data = await fetchJsonOrThrow('https://www.gov.uk/bank-holidays.json');
  const englandAndWales = data?.['england-and-wales'];
  const events = Array.isArray(englandAndWales?.events) ? englandAndWales.events : [];
  return events
    .map((event) => ({
      date: String(event?.date || '').trim(),
      localName: String(event?.title || '').trim(),
      name: String(event?.title || '').trim(),
    }))
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.date.startsWith(`${year}-`));
}

registerContactRoutes({
  app,
  escapeHtml,
  logRouteError,
  normalizeEmailInput,
});

registerAccountRoutes({ app });
registerAcademicYearRoutes({ app });
registerClassRoutes({ app });
registerTimetableLayoutRoutes({ app });
registerTimetableSessionRoutes({ app });

registerHolidayRoutes({
  app,
  fetchJsonOrThrow,
  fetchUkBankHolidaysForYear,
  normalizeCountryCode,
  parseCoordinate,
  sendError,
});

app.use(notFoundHandler);

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: ['index.html'] }));
  app.get(/.*/, (req, res, next) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
      if (err) {
        next(err);
      }
    });
  });
} else {
  // eslint-disable-next-line no-console
  console.warn(
    `Static UI not found at ${DIST_DIR}. Run "npm run build" before deploy so the app shell is served on /.`,
  );
}

app.use(errorHandler);

export async function initializeApplication() {
  if (db && env.enableDemoUser && env.nodeEnv !== 'production') {
    try {
      await ensureDemoUser();
    } catch (error) {
      logRouteError('Failed to ensure demo user', error);
      throw error;
    }
  }

}

export function logStartupStatus() {
  // eslint-disable-next-line no-console
  console.log(`Auth server listening on http://localhost:${PORT}`);
  if (!db) {
    // eslint-disable-next-line no-console
    console.log('DB persistence: disabled (set SUPABASE_DB_URL to enable).');
  }
}
