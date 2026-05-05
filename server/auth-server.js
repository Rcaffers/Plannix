import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import Stripe from 'stripe';
import { createDbPool, mapClassRow, runMigrations } from './db.js';

const app = express();
const PORT = Number(process.env.AUTH_PORT || 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const SESSION_COOKIE = 'plannix_session';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripePriceId = process.env.STRIPE_PRICE_ID || '';
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

const stripe = stripeSecretKey && stripePriceId ? new Stripe(stripeSecretKey) : null;
const db = createDbPool();

const users = [
  {
    id: 'u_teacher_001',
    name: 'Demo Teacher',
    email: 'teacher@plannix.test',
    passwordHash: bcrypt.hashSync('Password123!', 10),
  },
];

const sessions = new Map();
const pendingSignups = new Map();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 1000 * 60 * 60 * 24,
};

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  }),
);
app.use(cookieParser());

app.post(
  '/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe || !stripeWebhookSecret) {
      return res.status(503).send('Webhook not configured');
    }

    const signature = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        try {
          await fulfillPaidCheckout(session.id);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('checkout.session.completed fulfillment error:', e);
        }
      }
    }

    return res.json({ received: true });
  },
);

app.use(express.json());

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function getSessionUser(req) {
  const sessionId = req.cookies[SESSION_COOKIE];
  if (!sessionId) {
    return null;
  }

  const userId = sessions.get(sessionId);
  if (!userId) {
    return null;
  }

  return users.find((user) => user.id === userId) || null;
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

function cleanupPendingSignups() {
  const maxAgeMs = 1000 * 60 * 60;
  const now = Date.now();
  for (const [id, entry] of pendingSignups) {
    if (now - entry.createdAt > maxAgeMs) {
      pendingSignups.delete(id);
    }
  }
}

async function fulfillPaidCheckout(checkoutSessionId) {
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
  if (session.payment_status !== 'paid') {
    return null;
  }

  const pendingSignupId = session.metadata?.pending_signup_id;
  const emailFromStripe = String(
    session.customer_details?.email || session.customer_email || '',
  )
    .trim()
    .toLowerCase();

  cleanupPendingSignups();

  if (pendingSignupId && pendingSignups.has(pendingSignupId)) {
    const pending = pendingSignups.get(pendingSignupId);
    pendingSignups.delete(pendingSignupId);

    const existingUser = users.find((u) => u.email.toLowerCase() === pending.email.toLowerCase());
    if (existingUser) {
      return existingUser;
    }

    const newUser = {
      id: `u_individual_${crypto.randomUUID()}`,
      name: pending.name,
      email: pending.email,
      passwordHash: pending.passwordHash,
    };
    users.push(newUser);
    return newUser;
  }

  if (emailFromStripe) {
    return users.find((u) => u.email.toLowerCase() === emailFromStripe) || null;
  }

  return null;
}

function attachSessionCookie(res, userId) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, userId);
  res.cookie(SESSION_COOKIE, sessionId, COOKIE_OPTIONS);
}

function clearSessionCookie(res) {
  const { httpOnly, sameSite, secure } = COOKIE_OPTIONS;
  res.clearCookie(SESSION_COOKIE, { httpOnly, sameSite, secure });
}

function requireSessionUser(req, res) {
  const user = getSessionUser(req);
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

app.get('/auth/config', (req, res) => {
  return res.json({
    signupRequiresPayment: Boolean(stripe && stripePriceId),
  });
});

app.get('/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ message: 'No active session.' });
  }

  return res.json({ user: toPublicUser(user) });
});

app.post('/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const user = users.find((candidate) => candidate.email.toLowerCase() === email);
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  attachSessionCookie(res, user.id);

  return res.json({ user: toPublicUser(user) });
});

app.post('/auth/signup', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  const validationError = validateSignupPayload({ name, email, password });
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const existingUser = users.find((candidate) => candidate.email.toLowerCase() === email);
  if (existingUser) {
    return res.status(409).json({ message: 'An account already exists for this email.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  if (stripe && stripePriceId) {
    cleanupPendingSignups();
    const pendingSignupId = crypto.randomUUID();
    pendingSignups.set(pendingSignupId, {
      name,
      email,
      passwordHash,
      createdAt: Date.now(),
    });

    try {
      const checkoutSession = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [{ price: stripePriceId, quantity: 1 }],
        success_url: `${FRONTEND_ORIGIN}/?signup_complete=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${FRONTEND_ORIGIN}/?signup_cancel=1`,
        metadata: {
          pending_signup_id: pendingSignupId,
        },
      });

      return res.status(200).json({
        checkoutUrl: checkoutSession.url,
      });
    } catch (err) {
      pendingSignups.delete(pendingSignupId);
      // eslint-disable-next-line no-console
      console.error('Stripe checkout session error:', err);
      return res.status(502).json({
        message: 'Unable to start payment. Check Stripe keys and price ID, then try again.',
      });
    }
  }

  const newUser = {
    id: `u_individual_${crypto.randomUUID()}`,
    name,
    email,
    passwordHash,
  };

  users.push(newUser);
  attachSessionCookie(res, newUser.id);

  return res.status(201).json({ user: toPublicUser(newUser) });
});

app.post('/auth/signup/complete', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ message: 'Paid signup is not enabled on this server.' });
  }

  const sessionId = String(req.body?.session_id || '').trim();
  if (!sessionId) {
    return res.status(400).json({ message: 'Missing session_id.' });
  }

  try {
    const user = await fulfillPaidCheckout(sessionId);
    if (!user) {
      return res.status(400).json({
        message: 'Payment was not completed or this signup link is no longer valid.',
      });
    }

    attachSessionCookie(res, user.id);
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('signup/complete error:', err);
    return res.status(502).json({ message: 'Unable to verify payment with Stripe.' });
  }
});

app.post('/auth/logout', (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE];
  if (sessionId) {
    sessions.delete(sessionId);
  }

  clearSessionCookie(res);
  return res.status(204).send();
});

app.post('/admin/migrate', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const token = process.env.MIGRATION_TOKEN || '';
  const provided = String(req.headers['x-migration-token'] || '');
  if (token && provided !== token) {
    return res.status(403).json({ message: 'Invalid migration token.' });
  }
  try {
    await runMigrations(db);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Migration failed.' });
  }
});

app.get('/api/classes', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = requireSessionUser(req, res);
  if (!user) return;
  try {
    const result = await db.query(
      `SELECT id, name, frequency, cadence
       FROM plannix_classes
       WHERE user_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [user.id],
    );
    return res.json({
      entries: result.rows.map(mapClassRow),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load classes.' });
  }
});

app.put('/api/classes', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = requireSessionUser(req, res);
  if (!user) return;

  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const cadence = req.body?.cadence === 'two-weeks' ? 'two-weeks' : 'week';
  const normalizedEntries = entries
    .map((entry, index) => ({
      id: entry?.id ? String(entry.id) : null,
      name: String(entry?.name || '').trim(),
      frequency: Math.max(0, Number.parseInt(entry?.frequency, 10) || 0),
      cadence: entry?.cadence === 'two-weeks' ? 'two-weeks' : cadence,
      sortOrder: index,
    }))
    .filter((entry) => entry.name);

  try {
    await db.query('BEGIN');
    await db.query('DELETE FROM plannix_classes WHERE user_id = $1', [user.id]);

    for (const entry of normalizedEntries) {
      await db.query(
        `INSERT INTO plannix_classes (id, user_id, name, frequency, cadence, sort_order, updated_at)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, NOW())`,
        [entry.id, user.id, entry.name, entry.frequency, entry.cadence, entry.sortOrder],
      );
    }
    await db.query('COMMIT');
    return res.json({
      cadence,
      entries: normalizedEntries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        frequency: entry.frequency,
        cadence: entry.cadence,
      })),
    });
  } catch (error) {
    await db.query('ROLLBACK');
    return res.status(500).json({ message: error.message || 'Failed to save classes.' });
  }
});

app.get('/api/timetable/layout', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = requireSessionUser(req, res);
  if (!user) return;
  try {
    const result = await db.query('SELECT layout FROM plannix_timetable_layouts WHERE user_id = $1', [user.id]);
    return res.json({ layout: result.rows[0]?.layout || null });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load timetable layout.' });
  }
});

app.put('/api/timetable/layout', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = requireSessionUser(req, res);
  if (!user) return;
  const layout = req.body?.layout;
  if (!layout || typeof layout !== 'object') {
    return res.status(400).json({ message: 'layout object is required.' });
  }
  try {
    await db.query(
      `INSERT INTO plannix_timetable_layouts (user_id, layout, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()`,
      [user.id, JSON.stringify(layout)],
    );
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to save timetable layout.' });
  }
});

app.get('/api/timetable/sessions', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = requireSessionUser(req, res);
  if (!user) return;
  const layoutKey = String(req.query.layoutKey || '').trim();
  if (!layoutKey) {
    return res.status(400).json({ message: 'layoutKey query parameter is required.' });
  }
  try {
    const result = await db.query(
      `SELECT s.day, s.time, s.class_id AS "classId",
              COALESCE(c.name, s.class_name, '') AS class,
              COALESCE(s.teacher, '') AS teacher,
              COALESCE(s.title, '') AS title,
              COALESCE(s.meta, '') AS meta
       FROM plannix_timetable_sessions s
       LEFT JOIN plannix_classes c ON c.id = s.class_id
       WHERE s.user_id = $1 AND s.layout_key = $2
       ORDER BY s.day ASC, s.time ASC`,
      [user.id, layoutKey],
    );
    return res.json({ sessions: result.rows });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load timetable sessions.' });
  }
});

app.put('/api/timetable/sessions', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = requireSessionUser(req, res);
  if (!user) return;
  const layoutKey = String(req.body?.layoutKey || '').trim();
  const sessionsPayload = Array.isArray(req.body?.sessions) ? req.body.sessions : null;
  if (!layoutKey || !sessionsPayload) {
    return res.status(400).json({ message: 'layoutKey and sessions are required.' });
  }

  const normalized = sessionsPayload.map((session) => ({
    day: Number.parseInt(session?.day, 10) || 0,
    time: Number.parseInt(session?.time, 10) || 0,
    classId: session?.classId ? String(session.classId) : null,
    className: String(session?.class || '').trim(),
    teacher: String(session?.teacher || '').trim(),
    title: String(session?.title || '').trim(),
    meta: String(session?.meta || '').trim(),
  }));

  try {
    await db.query('BEGIN');
    await db.query('DELETE FROM plannix_timetable_sessions WHERE user_id = $1 AND layout_key = $2', [
      user.id,
      layoutKey,
    ]);

    for (const session of normalized) {
      await db.query(
        `INSERT INTO plannix_timetable_sessions
          (user_id, layout_key, day, time, class_id, class_name, teacher, title, meta, updated_at)
         VALUES
          ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, NOW())`,
        [
          user.id,
          layoutKey,
          session.day,
          session.time,
          session.classId,
          session.className,
          session.teacher,
          session.title,
          session.meta,
        ],
      );
    }
    await db.query('COMMIT');
    return res.json({ ok: true });
  } catch (error) {
    await db.query('ROLLBACK');
    return res.status(500).json({ message: error.message || 'Failed to save timetable sessions.' });
  }
});

async function startServer() {
  if (db && process.env.AUTO_RUN_MIGRATIONS === 'true') {
    try {
      await runMigrations(db);
      // eslint-disable-next-line no-console
      console.log('Database migrations applied.');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to apply migrations on startup:', error);
    }
  }

  app.listen(PORT, () => {
  // eslint-disable-next-line no-console
    console.log(`Auth server listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
    console.log('Demo login: teacher@plannix.test / Password123!');
    if (stripe && stripePriceId) {
      // eslint-disable-next-line no-console
      console.log('Stripe signup: enabled (Checkout before account is created).');
    } else {
      // eslint-disable-next-line no-console
      console.log('Stripe signup: disabled (set STRIPE_SECRET_KEY and STRIPE_PRICE_ID to require payment).');
    }
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
  });
}

startServer();
