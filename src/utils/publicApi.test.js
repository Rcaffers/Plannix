import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchHolidayCountries,
  fetchPublicHolidays,
  resolveCountryFromCoordinates,
  submitContactForm,
} from './api.js';

function response(payload) {
  return { ok: true, async json() { return payload; } };
}

test('contact and holiday requests explicitly omit browser credentials', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('countries')) return response({ countries: [] });
    if (String(url).includes('resolve-country')) {
      return response({ countryCode: 'GB', countryName: 'United Kingdom' });
    }
    if (String(url).includes('public')) return response({ holidays: [] });
    return response({ ok: true });
  };

  try {
    await submitContactForm({ name: 'Test User', email: 'test@example.test', message: 'Hello' });
    await fetchHolidayCountries();
    await resolveCountryFromCoordinates({ lat: 51.5, lng: -0.1 });
    await fetchPublicHolidays({ countryCode: 'GB', year: 2026 });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 4);
  calls.forEach(({ options }) => assert.equal(options.credentials, 'omit'));
  assert.equal(calls.some(({ options }) => options.credentials === 'include'), false);
});
