import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPublicHolidays, resolveCountryFromCoordinates } from './api.js';
test('public holiday and location APIs propagate cancellation to fetch', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController(); let calls = 0;
  globalThis.fetch = async (_url, options) => { calls++; assert.equal(options.signal, controller.signal); options.signal.throwIfAborted(); return { ok: true, json: async () => ({ holidays: [], countryCode: 'GB' }) }; };
  try {
    await fetchPublicHolidays({ countryCode: 'GB', year: 2026 }, { signal: controller.signal });
    await resolveCountryFromCoordinates({ lat: 1, lng: 2 }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(fetchPublicHolidays({ countryCode: 'GB', year: 2026 }, { signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(resolveCountryFromCoordinates({ lat: 1, lng: 2 }, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls, 4);
  } finally { globalThis.fetch = original; }
});
