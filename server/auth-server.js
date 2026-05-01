import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';

const app = express();
const PORT = Number(process.env.AUTH_PORT || 4000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const SESSION_COOKIE = 'plannix_session';

const users = [
  {
    id: 'u_teacher_001',
    name: 'Demo Teacher',
    email: 'teacher@plannix.test',
    passwordHash: bcrypt.hashSync('Password123!', 10),
  },
];

const sessions = new Map();

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

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

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, user.id);

  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24,
  });

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
  const newUser = {
    id: `u_individual_${crypto.randomUUID()}`,
    name,
    email,
    passwordHash,
  };

  users.push(newUser);

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, newUser.id);

  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24,
  });

  return res.status(201).json({ user: toPublicUser(newUser) });
});

app.post('/auth/logout', (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE];
  if (sessionId) {
    sessions.delete(sessionId);
  }

  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
  });

  return res.status(204).send();
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Auth server listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log('Demo login: teacher@plannix.test / Password123!');
});
