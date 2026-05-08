import 'dotenv/config';
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
      if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
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

function cleanupPendingSignups() {
  const maxAgeMs = 1000 * 60 * 60;
  const now = Date.now();
  for (const [id, entry] of pendingSignups) {
    if (now - entry.createdAt > maxAgeMs) {
      pendingSignups.delete(id);
    }
  }
}

function dueTodayFromInvoice(invoice) {
  if (!invoice || typeof invoice === 'string') {
    return null;
  }
  if (typeof invoice.amount_due !== 'number') {
    return null;
  }
  return { amount: invoice.amount_due, currency: invoice.currency };
}

function subscriptionPricePayloadFromSubscription(subscription) {
  const price = subscription.items?.data?.[0]?.price;
  if (!price || typeof price.unit_amount !== 'number') {
    return null;
  }
  const product = price.product;
  const productName =
    product && typeof product === 'object' && !product.deleted && product.name
      ? String(product.name)
      : null;
  return {
    amount: price.unit_amount,
    currency: price.currency,
    interval: price.recurring?.interval ?? null,
    intervalCount: price.recurring?.interval_count ?? 1,
    productName,
  };
}

function assertAwaitingSignupSubscription(subscription) {
  const pendingId = subscription.metadata?.pending_signup_id;
  if (!pendingId || !pendingSignups.has(pendingId)) {
    const err = new Error(
      'This payment session is no longer valid. Please go back and create your account again.',
    );
    err.statusCode = 403;
    throw err;
  }
  if (subscription.status !== 'incomplete') {
    const err = new Error('This subscription cannot accept a promotion code right now.');
    err.statusCode = 400;
    throw err;
  }
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

async function fulfillPaidCheckout(checkoutSessionId) {
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
  const okPayment =
    session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
  if (!okPayment) {
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

    const existingUser = await dbGetUserByEmail(pending.email);
    if (existingUser) {
      return existingUser;
    }

    return dbCreateUser({
      id: `u_individual_${crypto.randomUUID()}`,
      name: pending.name,
      email: pending.email,
      passwordHash: pending.passwordHash,
    });
  }

  if (emailFromStripe) {
    return dbGetUserByEmail(emailFromStripe);
  }

  return null;
}

async function fulfillPaidSubscription(subscriptionId) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!subscription || !['active', 'trialing'].includes(subscription.status)) {
    return null;
  }

  const pendingSignupId = subscription.metadata?.pending_signup_id;
  cleanupPendingSignups();

  if (pendingSignupId && pendingSignups.has(pendingSignupId)) {
    const pending = pendingSignups.get(pendingSignupId);
    pendingSignups.delete(pendingSignupId);

    const existingUser = await dbGetUserByEmail(pending.email);
    if (existingUser) {
      return existingUser;
    }

    return dbCreateUser({
      id: `u_individual_${crypto.randomUUID()}`,
      name: pending.name,
      email: pending.email,
      passwordHash: pending.passwordHash,
    });
  }

  return null;
}

async function attachSessionCookie(res, userId) {
  const sessionId = await createSessionForUser(userId);
  res.cookie(SESSION_COOKIE, sessionId, COOKIE_OPTIONS);
}

function clearSessionCookie(res) {
  const { httpOnly, sameSite, secure } = COOKIE_OPTIONS;
  res.clearCookie(SESSION_COOKIE, { httpOnly, sameSite, secure });
}

async function findStripeCustomerByEmail(email) {
  if (!stripe || !email) return null;
  const customers = await stripe.customers.list({
    email,
    limit: 1,
  });
  return customers.data?.[0] || null;
}

async function findLatestStripeSubscriptionForCustomer(customerId) {
  if (!stripe || !customerId) return null;
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
    expand: ['data.items.data.price.product'],
  });
  if (!Array.isArray(subscriptions.data) || subscriptions.data.length === 0) {
    return null;
  }
  return subscriptions.data
    .slice()
    .sort((a, b) => (b.created || 0) - (a.created || 0))[0];
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

app.get('/auth/config', (req, res) => {
  return res.json({
    signupRequiresPayment: Boolean(stripe && stripePriceId),
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  });
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

app.post('/auth/signup', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const name = String(req.body?.name || '').trim();
  const email = normalizeEmailInput(req.body?.email);
  const password = String(req.body?.password || '');

  const validationError = validateSignupPayload({ name, email, password });
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const existingUser = await dbGetUserByEmail(email);
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
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          pending_signup_id: pendingSignupId,
        },
      });

      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: stripePriceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
        },
        metadata: {
          pending_signup_id: pendingSignupId,
        },
        expand: ['latest_invoice.payment_intent', 'items.data.price.product'],
      });

      const paymentIntent = subscription.latest_invoice?.payment_intent;
      const clientSecret = paymentIntent?.client_secret;

      if (!clientSecret) {
        pendingSignups.delete(pendingSignupId);
        return res.status(502).json({
          message: 'Stripe did not return a payment client secret for this subscription.',
        });
      }

      const subscriptionPrice = subscriptionPricePayloadFromSubscription(subscription);

      return res.status(200).json({
        clientSecret,
        subscriptionId: subscription.id,
        subscriptionPrice,
        dueToday: dueTodayFromInvoice(subscription.latest_invoice),
      });
    } catch (err) {
      pendingSignups.delete(pendingSignupId);
      // eslint-disable-next-line no-console
      console.error('Stripe subscription create error:', err);
      const stripeMsg =
        err?.raw?.message || err?.message || 'Unable to start subscription with Stripe.';
      return res.status(502).json({
        message: `${stripeMsg} Ensure STRIPE_PRICE_ID points to an active recurring Stripe price.`,
      });
    }
  }

  const newUser = await dbCreateUser({
    id: `u_individual_${crypto.randomUUID()}`,
    name,
    email,
    passwordHash,
  });
  await attachSessionCookie(res, newUser.id);

  return res.status(201).json({ user: toPublicUser(newUser) });
});

app.post('/auth/signup/apply-promotion-code', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ message: 'Paid signup is not enabled on this server.' });
  }

  const subscriptionId = String(req.body?.subscription_id || req.body?.subscriptionId || '').trim();
  const rawCode = String(req.body?.promotion_code || req.body?.promotionCode || '').trim();

  if (!subscriptionId || !rawCode) {
    return res.status(400).json({ message: 'Subscription and promotion code are required.' });
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    assertAwaitingSignupSubscription(subscription);

    const codes = await stripe.promotionCodes.list({
      code: rawCode,
      limit: 1,
      active: true,
    });
    const promotionCode = codes.data[0];
    if (!promotionCode) {
      return res.status(400).json({
        message: 'That promotion code is not valid or is no longer active.',
      });
    }

    const updated = await stripe.subscriptions.update(
      subscriptionId,
      {
        discounts: [{ promotion_code: promotionCode.id }],
      },
      {
        expand: ['latest_invoice.payment_intent', 'items.data.price.product'],
      },
    );

    const paymentIntent = updated.latest_invoice?.payment_intent;
    const clientSecret = paymentIntent?.client_secret;
    if (!clientSecret) {
      return res.status(502).json({
        message: 'Could not refresh the payment form after applying that code. Please try again.',
      });
    }

    return res.json({
      clientSecret,
      subscriptionId: updated.id,
      subscriptionPrice: subscriptionPricePayloadFromSubscription(updated),
      dueToday: dueTodayFromInvoice(updated.latest_invoice),
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    // eslint-disable-next-line no-console
    console.error('apply-promotion-code error:', err);
    const stripeMsg = err?.raw?.message || err?.message || 'Unable to apply that promotion code.';
    return res.status(400).json({ message: stripeMsg });
  }
});

app.post('/auth/signup/complete', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
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

    await attachSessionCookie(res, user.id);
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('signup/complete error:', err);
    return res.status(502).json({ message: 'Unable to verify payment with Stripe.' });
  }
});

app.post('/auth/signup/complete-subscription', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  if (!stripe) {
    return res.status(503).json({ message: 'Paid signup is not enabled on this server.' });
  }

  const subscriptionId = String(req.body?.subscription_id || '').trim();
  if (!subscriptionId) {
    return res.status(400).json({ message: 'Missing subscription_id.' });
  }

  try {
    const user = await fulfillPaidSubscription(subscriptionId);
    if (!user) {
      return res.status(400).json({
        message: 'Subscription is not active yet or this signup is no longer valid.',
      });
    }

    await attachSessionCookie(res, user.id);
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('signup/complete-subscription error:', err);
    return res.status(502).json({ message: 'Unable to verify subscription with Stripe.' });
  }
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
    return res.status(500).json({ message: error.message || 'Could not delete account data.' });
  }
  await removeAllSessionsForUser(user.id);
  clearSessionCookie(res);
  return res.status(204).send();
});

app.get('/billing/subscription-summary', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = await requireSessionUser(req, res);
  if (!user) return;
  if (!stripe) {
    return res.json({
      enabled: false,
      subscription: null,
    });
  }
  try {
    const customer = await findStripeCustomerByEmail(user.email);
    if (!customer) {
      return res.json({
        enabled: true,
        subscription: null,
      });
    }
    const subscription = await findLatestStripeSubscriptionForCustomer(customer.id);
    if (!subscription) {
      return res.json({
        enabled: true,
        subscription: null,
      });
    }
    return res.json({
      enabled: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        currentPeriodEnd: subscription.current_period_end || null,
        canceledAt: subscription.canceled_at || null,
        price: subscriptionPricePayloadFromSubscription(subscription),
      },
    });
  } catch (error) {
    return res.status(502).json({ message: error.message || 'Could not load subscription details.' });
  }
});

app.post('/billing/portal-session', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = await requireSessionUser(req, res);
  if (!user) return;
  if (!stripe) {
    return res.status(503).json({ message: 'Billing is not enabled on this server.' });
  }
  const mode = String(req.body?.mode || '').trim().toLowerCase();
  const subscriptionId = String(req.body?.subscriptionId || '').trim();
  try {
    const customer = await findStripeCustomerByEmail(user.email);
    if (!customer) {
      return res.status(404).json({ message: 'No Stripe customer found for this account yet.' });
    }
    const payload = {
      customer: customer.id,
      return_url: `${FRONTEND_ORIGIN}/settings/subscription`,
    };
    if (mode === 'cancel' && subscriptionId) {
      payload.flow_data = {
        type: 'subscription_cancel',
        subscription_cancel: {
          subscription: subscriptionId,
        },
      };
    }
    const session = await stripe.billingPortal.sessions.create(payload);
    return res.json({ url: session.url });
  } catch (error) {
    return res.status(502).json({ message: error.message || 'Could not open billing portal.' });
  }
});

app.get('/holidays/countries', async (req, res) => {
  try {
    const data = await fetchJsonOrThrow('https://date.nager.at/api/v3/AvailableCountries');
    const countries = Array.isArray(data)
      ? data
          .map((entry) => ({
            countryCode: normalizeCountryCode(entry?.countryCode),
            name: String(entry?.name || '').trim(),
          }))
          .filter((entry) => entry.countryCode && entry.name)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    return res.json({ countries });
  } catch (error) {
    return res.status(502).json({ message: error.message || 'Could not load country list.' });
  }
});

app.get('/holidays/resolve-country', async (req, res) => {
  const lat = parseCoordinate(req.query.lat);
  const lng = parseCoordinate(req.query.lng);
  if (lat == null || lng == null) {
    return res.status(400).json({ message: 'lat and lng query parameters are required.' });
  }
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lng),
      zoom: '3',
      addressdetails: '1',
    });
    const data = await fetchJsonOrThrow(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: {
        'User-Agent': 'Plannix/1.0 holiday-import',
      },
    });
    const countryCode = normalizeCountryCode(data?.address?.country_code);
    const countryName = String(data?.address?.country || '').trim();
    if (!countryCode) {
      return res.status(404).json({ message: 'Could not determine country from that location.' });
    }
    return res.json({
      countryCode,
      countryName: countryName || countryCode,
    });
  } catch (error) {
    return res.status(502).json({ message: error.message || 'Could not resolve country from location.' });
  }
});

app.get('/holidays/public', async (req, res) => {
  const countryCode = normalizeCountryCode(req.query.country);
  const year = Number.parseInt(String(req.query.year || ''), 10);
  if (!countryCode || !Number.isInteger(year) || year < 1900 || year > 2100) {
    return res.status(400).json({ message: 'Valid country and year query parameters are required.' });
  }
  try {
    if (countryCode === 'GB') {
      const ukHolidays = await fetchUkBankHolidaysForYear(year);
      if (ukHolidays.length > 0) {
        return res.json({ holidays: ukHolidays });
      }
    }

    const data = await fetchJsonOrThrow(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
    );
    const holidays = Array.isArray(data)
      ? data
          .map((entry) => ({
            date: String(entry?.date || '').trim(),
            localName: String(entry?.localName || '').trim(),
            name: String(entry?.name || '').trim(),
          }))
          .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
      : [];
    return res.json({ holidays });
  } catch (error) {
    return res.status(502).json({ message: error.message || 'Could not load public holidays.' });
  }
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
  const user = await requireSessionUser(req, res);
  if (!user) return;
  try {
    const result = await withUserDbSession(user.id, (client) =>
      client.query(
        `SELECT id, name, frequency, cadence
         FROM plannix_classes
         WHERE user_id = $1
         ORDER BY sort_order ASC, created_at ASC`,
        [user.id],
      ),
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
  const user = await requireSessionUser(req, res);
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
    await withUserDbSession(user.id, async (client) => {
      await client.query('DELETE FROM plannix_classes WHERE user_id = $1', [user.id]);

      for (const entry of normalizedEntries) {
        await client.query(
          `INSERT INTO plannix_classes (id, user_id, name, frequency, cadence, sort_order, updated_at)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, NOW())`,
          [entry.id, user.id, entry.name, entry.frequency, entry.cadence, entry.sortOrder],
        );
      }
    });
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
    return res.status(500).json({ message: error.message || 'Failed to save classes.' });
  }
});

app.get('/api/timetable/layout', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = await requireSessionUser(req, res);
  if (!user) return;
  try {
    const result = await withUserDbSession(user.id, (client) =>
      client.query('SELECT layout FROM plannix_timetable_layouts WHERE user_id = $1', [user.id]),
    );
    return res.json({ layout: result.rows[0]?.layout || null });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load timetable layout.' });
  }
});

app.put('/api/timetable/layout', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = await requireSessionUser(req, res);
  if (!user) return;
  const layout = req.body?.layout;
  if (!layout || typeof layout !== 'object') {
    return res.status(400).json({ message: 'layout object is required.' });
  }
  try {
    await withUserDbSession(user.id, (client) =>
      client.query(
        `INSERT INTO plannix_timetable_layouts (user_id, layout, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()`,
        [user.id, JSON.stringify(layout)],
      ),
    );
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to save timetable layout.' });
  }
});

app.get('/api/academic-year', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = await requireSessionUser(req, res);
  if (!user) return;
  try {
    const result = await withUserDbSession(user.id, (client) =>
      client.query('SELECT plan FROM plannix_academic_years WHERE user_id = $1', [user.id]),
    );
    return res.json({ plan: result.rows[0]?.plan || null });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load academic year.' });
  }
});

app.put('/api/academic-year', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = await requireSessionUser(req, res);
  if (!user) return;
  const plan = req.body?.plan;
  if (!plan || typeof plan !== 'object') {
    return res.status(400).json({ message: 'plan object is required.' });
  }
  try {
    await withUserDbSession(user.id, (client) =>
      client.query(
        `INSERT INTO plannix_academic_years (user_id, plan, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET plan = EXCLUDED.plan, updated_at = NOW()`,
        [user.id, JSON.stringify(plan)],
      ),
    );
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to save academic year.' });
  }
});

app.get('/api/timetable/sessions', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = await requireSessionUser(req, res);
  if (!user) return;
  const layoutKey = String(req.query.layoutKey || '').trim();
  const weekKey = String(req.query.weekKey || '').trim();
  if (!layoutKey) {
    return res.status(400).json({ message: 'layoutKey query parameter is required.' });
  }
  try {
    const result = await withUserDbSession(user.id, (client) =>
      client.query(
        `SELECT s.day, s.time, s.class_id AS "classId",
                COALESCE(c.name, s.class_name, '') AS class,
                COALESCE(s.teacher, '') AS teacher,
                COALESCE(s.title, '') AS title,
                COALESCE(s.notes, '') AS notes,
                COALESCE(s.meta, '') AS meta
         FROM plannix_timetable_sessions s
         LEFT JOIN plannix_classes c ON c.id = s.class_id
         WHERE s.user_id = $1 AND s.layout_key = $2 AND s.week_key = $3
         ORDER BY s.day ASC, s.time ASC`,
        [user.id, layoutKey, weekKey],
      ),
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
  const user = await requireSessionUser(req, res);
  if (!user) return;
  const layoutKey = String(req.body?.layoutKey || '').trim();
  const weekKey = String(req.body?.weekKey || '').trim();
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
    notes: String(session?.notes || '')
      .trim()
      .slice(0, 4000),
    meta: String(session?.meta || '').trim(),
  }));

  try {
    await withUserDbSession(user.id, async (client) => {
      await client.query(
        'DELETE FROM plannix_timetable_sessions WHERE user_id = $1 AND layout_key = $2 AND week_key = $3',
        [user.id, layoutKey, weekKey],
      );

      for (const session of normalized) {
        await client.query(
          `INSERT INTO plannix_timetable_sessions
            (user_id, layout_key, week_key, day, time, class_id, class_name, teacher, title, notes, meta, updated_at)
           VALUES
            ($1, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11, NOW())`,
          [
            user.id,
            layoutKey,
            weekKey,
            session.day,
            session.time,
            session.classId,
            session.className,
            session.teacher,
            session.title,
            session.notes,
            session.meta,
          ],
        );
      }
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to save timetable sessions.' });
  }
});

app.delete('/api/timetable/sessions', async (req, res) => {
  if (!requireDb(res)) {
    return;
  }
  const user = await requireSessionUser(req, res);
  if (!user) return;
  const layoutKey = String(req.query.layoutKey || '').trim();
  if (!layoutKey) {
    return res.status(400).json({ message: 'layoutKey query parameter is required.' });
  }
  try {
    await withUserDbSession(user.id, (client) =>
      client.query(
        'DELETE FROM plannix_timetable_sessions WHERE user_id = $1 AND layout_key = $2',
        [user.id, layoutKey],
      ),
    );
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to clear timetable sessions.' });
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

  if (db) {
    try {
      await ensureDemoUser();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to ensure demo user:', error);
    }
  }

  app.listen(PORT, () => {
  // eslint-disable-next-line no-console
    console.log(`Auth server listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
    console.log('Demo login: teacher@plannix.test / Password123!');
    if (stripe && stripePriceId) {
      // eslint-disable-next-line no-console
      console.log('Stripe signup: enabled (Subscription Payment Element mode).');
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
