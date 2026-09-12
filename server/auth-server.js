import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { Resend } from 'resend';
import { createDbPool, mapClassRow } from './db.js';
import {
  COOKIE_OPTIONS,
  DIST_DIR,
  FRONTEND_ORIGINS,
  PORT,
  SESSION_COOKIE,
  corsDelegate,
  inferredPublicOrigin,
} from './config.js';
import { env } from './config/env.js';
import { errorHandler, logRouteError, notFoundHandler, sendError } from './errors.js';
import { requestId } from './middleware/requestId.js';
import { registerContactRoutes } from './routes/contact-routes.js';
import { registerHolidayRoutes } from './routes/holiday-routes.js';
import { registerPlannerRoutes } from './routes/planner-routes.js';
import { createSessionCookieAttacher, registerSignupRoute } from './routes/signup-route.js';

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

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function validateSignupPayload({ name, email, password }) {
  if (!name || !name.trim()) {
    return 'Full name is required.';
  }

  if (!email || !email.trim()) {
    return 'Email is required.';
  }

  if (!password) {
    return 'Password is required.';
  }

  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }

  return null;
}

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

async function dbGetUserById(id) {
  const result = await withAuthDbSession((client) =>
    client.query(
      `SELECT id, name, email, password_hash AS "passwordHash"
       FROM plannix_users
       WHERE id = $1
       LIMIT 1`,
      [id],
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

async function createSessionForUser(userId) {
  const result = await withAuthDbSession((client) =>
    client.query(
      `INSERT INTO plannix_sessions (user_id, expires_at)
       VALUES ($1, NOW() + INTERVAL '24 hours')
       RETURNING id`,
      [userId],
    ),
  );
  return result.rows[0]?.id;
}

async function getSessionUser(req) {
  const sessionId = req.cookies[SESSION_COOKIE];
  if (!sessionId) {
    return null;
  }
  const result = await withAuthDbSession((client) =>
    client.query(
      `SELECT u.id, u.name, u.email, u.password_hash AS "passwordHash"
       FROM plannix_sessions s
       JOIN plannix_users u ON u.id = s.user_id
       WHERE s.id = $1
         AND s.expires_at > NOW()
       LIMIT 1`,
      [sessionId],
    ),
  );
  return result.rows[0] || null;
}

async function deleteSessionById(sessionId) {
  if (!sessionId) return;
  await withAuthDbSession((client) => client.query('DELETE FROM plannix_sessions WHERE id = $1', [sessionId]));
}

async function removeAllSessionsForUser(userId) {
  if (!userId) return;
  await withAuthDbSession((client) =>
    client.query('DELETE FROM plannix_sessions WHERE user_id = $1', [userId]),
  );
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

function hashPasswordResetToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || ''), 'utf8').digest('hex');
}

function getPasswordResetPublicBase(req) {
  const explicit = String(process.env.PASSWORD_RESET_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (explicit) {
    return explicit;
  }
  if (FRONTEND_ORIGINS.length > 0) {
    return FRONTEND_ORIGINS[0];
  }
  return inferredPublicOrigin(req) || '';
}

async function dbReplacePasswordResetToken(userId, tokenHash, ttlHours) {
  await withAuthDbSession(async (client) => {
    await client.query('DELETE FROM plannix_password_reset_tokens WHERE user_id = $1', [userId]);
    await client.query(
      `INSERT INTO plannix_password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour' * $3::double precision)`,
      [userId, tokenHash, ttlHours],
    );
  });
}

async function dbResetPasswordWithToken(tokenHash, newPasswordHash) {
  return withAuthDbSession(async (client) => {
    const sel = await client.query(
      `SELECT user_id FROM plannix_password_reset_tokens
       WHERE token_hash = $1 AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash],
    );
    const userId = sel.rows[0]?.user_id;
    if (!userId) {
      return { ok: false };
    }
    await client.query(
      `UPDATE plannix_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newPasswordHash, userId],
    );
    await client.query('DELETE FROM plannix_password_reset_tokens WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM plannix_sessions WHERE user_id = $1', [userId]);
    return { ok: true, userId };
  });
}

const attachSessionCookie = createSessionCookieAttacher({
  createSessionForUser,
  cookieName: SESSION_COOKIE,
  cookieOptions: COOKIE_OPTIONS,
});

function clearSessionCookie(res) {
  const { httpOnly, sameSite, secure } = COOKIE_OPTIONS;
  res.clearCookie(SESSION_COOKIE, { httpOnly, sameSite, secure });
}

async function requireSessionUser(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: 'No active session.' });
    return null;
  }
  return user;
}

function requireDb(res) {
  if (!db) {
    res.status(503).json({
      message:
        'Database is not configured. Set SUPABASE_DB_URL (or DATABASE_URL) to enable persistence.',
    });
    return false;
  }
  return true;
}

async function withUserDbSession(userId, work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
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
  db,
  escapeHtml,
  getSessionUser,
  logRouteError,
  normalizeEmailInput,
});

app.get('/auth/me', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = await getSessionUser(req);
  if (!user) {
    return res.status(401).json({ message: 'No active session.' });
  }

  return res.json({ user: toPublicUser(user) });
});

app.post('/auth/login', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const email = normalizeEmailInput(req.body?.email);
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const user = await dbGetUserByEmail(email);
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  await attachSessionCookie(res, user.id);

  return res.json({ user: toPublicUser(user) });
});

const PASSWORD_RESET_ACK_MESSAGE =
  'If an account exists for that email, you will receive a link to reset your password shortly.';

app.post('/auth/forgot-password', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const email = normalizeEmailInput(req.body?.email);
  if (!email || !email.includes('@')) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }

  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const fromEmail = String(
    process.env.CONTACT_FROM_EMAIL || 'Plannix <noreply@plannix.co.uk>',
  ).trim();

  if (!apiKey) {
    return res.status(503).json({
      message: 'Password reset is not available. Set RESEND_API_KEY on the server.',
    });
  }

  const user = await dbGetUserByEmail(email);
  if (!user) {
    return res.json({ ok: true, message: PASSWORD_RESET_ACK_MESSAGE });
  }

  const publicBase = getPasswordResetPublicBase(req);
  if (!publicBase) {
    return res.status(503).json({
      message:
        'Password reset is not configured. Set FRONTEND_ORIGIN or PASSWORD_RESET_PUBLIC_URL on the server.',
    });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashPasswordResetToken(rawToken);
  const ttlRaw = Number(process.env.PASSWORD_RESET_TTL_HOURS);
  const ttlHours = Number.isFinite(ttlRaw) ? Math.min(72, Math.max(1, ttlRaw)) : 1;

  try {
    await dbReplacePasswordResetToken(user.id, tokenHash, ttlHours);
  } catch (err) {
    return sendError(res, err, 'Could not start password reset. Please try again.');
  }

  const resetUrl = `${publicBase.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: fromEmail,
    to: user.email,
    subject: 'Reset your Plannix password',
    html: `<p>Hi${user.name ? ` ${escapeHtml(user.name)}` : ''},</p>
<p>We received a request to reset your Plannix password. Use the link below (valid for about ${ttlHours} hour${
      ttlHours === 1 ? '' : 's'
    }):</p>
<p><a href="${escapeHtml(resetUrl)}">Choose a new password</a></p>
<p>If you did not ask for this, you can ignore this email.</p>`,
  });

  if (error) {
    logRouteError('Resend forgot-password error', error);
    return res.status(502).json({ message: 'Could not send reset email. Please try again later.' });
  }

  return res.json({ ok: true, message: PASSWORD_RESET_ACK_MESSAGE });
});

app.post('/auth/reset-password', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token) {
    return res.status(400).json({ message: 'Reset link is missing or invalid.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  const tokenHash = hashPasswordResetToken(token);
  let newHash;
  try {
    newHash = await bcrypt.hash(password, 10);
  } catch (err) {
    return sendError(res, err, 'Could not reset password. Please try again.');
  }

  try {
    const result = await dbResetPasswordWithToken(tokenHash, newHash);
    if (!result.ok) {
      return res.status(400).json({
        message: 'This reset link is invalid or has expired. Please request a new one.',
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, err, 'Could not reset password. Please try again.');
  }
});

registerSignupRoute({
  app,
  attachSessionCookie,
  createUser: dbCreateUser,
  findUserByEmail: dbGetUserByEmail,
  hashPassword: (password) => bcrypt.hash(password, 10),
  normalizeEmailInput,
  randomUUID: () => crypto.randomUUID(),
  requireDb,
  toPublicUser,
  validateSignupPayload,
});

app.post('/auth/logout', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const sessionId = req.cookies[SESSION_COOKIE];
  await deleteSessionById(sessionId);

  clearSessionCookie(res);
  return res.status(204).send();
});

app.delete('/account', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = await requireSessionUser(req, res);
  if (!user) return;

  try {
    await withUserDbSession(user.id, async (client) => {
      await client.query('DELETE FROM plannix_timetable_sessions WHERE user_id = $1', [user.id]);
      await client.query('DELETE FROM plannix_timetable_layouts WHERE user_id = $1', [user.id]);
      await client.query('DELETE FROM plannix_classes WHERE user_id = $1', [user.id]);
      await client.query('DELETE FROM plannix_academic_years WHERE user_id = $1', [user.id]);
    });
    await withAuthDbSession((client) => client.query('DELETE FROM plannix_users WHERE id = $1', [user.id]));
  } catch (error) {
    return sendError(res, error, 'Could not delete account data.');
  }
  await removeAllSessionsForUser(user.id);
  clearSessionCookie(res);
  return res.status(204).send();
});

registerHolidayRoutes({
  app,
  fetchJsonOrThrow,
  fetchUkBankHolidaysForYear,
  normalizeCountryCode,
  parseCoordinate,
  sendError,
});

registerPlannerRoutes({
  app,
  mapClassRow,
  requireDb,
  requireSessionUser,
  sendError,
  withUserDbSession,
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
    if (process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
      // eslint-disable-next-line no-console
      console.log(
        'Supabase client env detected, but server persistence needs SUPABASE_DB_URL (or SUPABASE_POOLER_URL).',
      );
    }
  }
}
