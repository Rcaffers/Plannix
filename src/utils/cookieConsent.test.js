import assert from 'node:assert/strict';
import test from 'node:test';
import { CONSENT_STORAGE_KEY, readStoredConsent, subscribeConsent, writeConsent } from './cookieConsent.js';

test('only a specific v2 analytics choice authorizes tracking; older broad consent prompts again', () => {
  const previousStorage = globalThis.localStorage;
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  globalThis.window = new EventTarget();
  try {
    values.set(CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, choice: 'all' }));
    assert.equal(readStoredConsent(), null);
    values.set(CONSENT_STORAGE_KEY, JSON.stringify({ version: 2, choice: 'all' }));
    assert.equal(readStoredConsent(), null);
    values.set(CONSENT_STORAGE_KEY, '{broken');
    assert.equal(readStoredConsent(), null);
    const updates = [];
    const unsubscribe = subscribeConsent(value => updates.push(value?.choice));
    writeConsent('analytics');
    assert.equal(readStoredConsent().choice, 'analytics');
    writeConsent('necessary_only');
    assert.equal(readStoredConsent().choice, 'necessary_only');
    writeConsent('all');
    assert.deepEqual(updates, ['analytics', 'necessary_only']);
    values.set(CONSENT_STORAGE_KEY, JSON.stringify({ version: 2, choice: 'analytics' }));
    const event = new Event('storage');
    Object.defineProperty(event, 'key', { value: CONSENT_STORAGE_KEY });
    window.dispatchEvent(event);
    assert.deepEqual(updates, ['analytics', 'necessary_only', 'analytics']);
    unsubscribe();
    window.dispatchEvent(event);
    assert.equal(updates.length, 3);
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.window = previousWindow;
  }
});
