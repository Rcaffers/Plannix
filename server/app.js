import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { corsDelegate } from './config/cors.js';
import { errorHandler, logRouteError, sendError } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestId } from './middleware/requestId.js';
import { registerAccountRoutes } from './routes/account-routes.js';
import { registerAcademicYearRoutes } from './routes/academic-year-routes.js';
import { registerClassRoutes } from './routes/class-routes.js';
import { registerContactRoutes } from './routes/contact-routes.js';
import { registerHolidayRoutes } from './routes/holiday-routes.js';
import { registerTimetableLayoutRoutes } from './routes/timetable-layout-routes.js';
import { registerTimetableSessionRoutes } from './routes/timetable-session-routes.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.trustProxyHops);
app.use(requestId);
app.use(helmet({
  contentSecurityPolicy: false,
  strictTransportSecurity: false,
}));
app.use(cors(corsDelegate));

app.get('/health', (_req, res) => {
  res.status(200).end();
});

app.use(express.json({ limit: '100kb' }));

function normalizeEmailInput(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseCoordinate(value) {
  const coordinate = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(coordinate) ? coordinate : null;
}

function normalizeCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

async function fetchJsonOrThrow(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`External API request failed (${response.status}).`);
  return response.json();
}

async function fetchUkBankHolidaysForYear(year) {
  const data = await fetchJsonOrThrow('https://www.gov.uk/bank-holidays.json');
  const events = Array.isArray(data?.['england-and-wales']?.events)
    ? data['england-and-wales'].events
    : [];
  return events
    .map((event) => ({
      date: String(event?.date || '').trim(),
      localName: String(event?.title || '').trim(),
      name: String(event?.title || '').trim(),
    }))
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.date.startsWith(`${year}-`));
}

registerContactRoutes({ app, escapeHtml, logRouteError, normalizeEmailInput });
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

app.use(notFound);

if (fs.existsSync(env.distDirectory)) {
  app.use(express.static(env.distDirectory, { index: ['index.html'] }));
  app.get(/.*/, (_req, res, next) => {
    res.sendFile(path.join(env.distDirectory, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
} else {
  // eslint-disable-next-line no-console
  console.warn('Static UI is unavailable. Run the production build before deployment.');
}

app.use(errorHandler);

export default app;
