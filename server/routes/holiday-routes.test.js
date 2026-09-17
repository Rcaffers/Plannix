import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { errorHandler, sendError } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
import { registerHolidayRoutes } from './holiday-routes.js';

const REQUEST_ID = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';

test('public holiday routes operate without cookies and retain request IDs', async () => {
  const calls = [];
  const app = express();
  app.use(requestId);
  registerHolidayRoutes({
    app,
    fetchJsonOrThrow: async (url) => {
      calls.push(url);
      return [{ countryCode: 'GB', name: 'United Kingdom' }];
    },
    fetchUkBankHolidaysForYear: async (year) => [{
      date: `${year}-12-25`, localName: 'Christmas Day', name: 'Christmas Day',
    }],
    normalizeCountryCode: (value) => String(value || '').trim().toUpperCase(),
    parseCoordinate: (value) => Number(value),
    sendError,
  });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const countries = await fetch(`${baseUrl}/holidays/countries`, {
      headers: { 'X-Request-ID': REQUEST_ID },
    });
    assert.equal(countries.status, 200);
    assert.equal(countries.headers.get('x-request-id'), REQUEST_ID);
    assert.deepEqual(await countries.json(), {
      countries: [{ countryCode: 'GB', name: 'United Kingdom' }],
    });

    const publicHolidays = await fetch(`${baseUrl}/holidays/public?country=GB&year=2026`, {
      headers: { Cookie: 'plannix_session=ignored', 'X-Request-ID': REQUEST_ID },
    });
    assert.equal(publicHolidays.status, 200);
    assert.equal(publicHolidays.headers.get('x-request-id'), REQUEST_ID);
    assert.deepEqual(await publicHolidays.json(), {
      holidays: [{ date: '2026-12-25', localName: 'Christmas Day', name: 'Christmas Day' }],
    });
    assert.equal(calls.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
