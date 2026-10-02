import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const script = readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8');
function worker() {
  const listeners = new Map(); const notifications = []; const opened = [];
  const self = { location: { origin: 'https://plannix.example.test' },
    addEventListener: (name, handler) => listeners.set(name, handler),
    registration: { showNotification: async (...args) => notifications.push(args) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } };
  vm.runInNewContext(script, { self, URL });
  return { listeners, notifications, opened };
}
test('worker ignores malformed or unapproved payloads and displays only generic test content', async () => {
  const w = worker(); const jobs = [];
  for (const payload of [{ type: 'other', version: 1, title: 'private' }, { type: 'plannix-test', version: 1, url: 'https://evil.test' }, { type: 'plannix-test', version: 1 }]) {
    w.listeners.get('push')({ data: { json: () => payload }, waitUntil: job => jobs.push(job) });
  }
  await Promise.all(jobs);
  assert.equal(w.notifications.length, 1);
  assert.equal(w.notifications[0][0], 'Plannix test notification');
  assert.doesNotMatch(JSON.stringify(w.notifications), /private|evil/);
});
test('click opens only same-origin notification settings and ignores notification-supplied URL', async () => {
  const w = worker(); let closed = false; let job;
  w.listeners.get('notificationclick')({ notification: { data: { url: 'https://evil.test' }, close: () => { closed = true; } }, waitUntil: value => { job = value; } });
  await job;
  assert.equal(closed, true);
  assert.deepEqual(w.opened, ['https://plannix.example.test/settings/notifications']);
});
test('click focuses an existing same-origin page and falls back if navigation fails', async () => {
  const w = worker(); let focused = 0; let job;
  const client = { url: 'https://plannix.example.test/timetable', navigate: async url => {
    assert.equal(url, 'https://plannix.example.test/settings/notifications');
    return { focus: async () => { focused++; } };
  } };
  const context = { self: { location: { origin: 'https://plannix.example.test' }, addEventListener: (name, handler) => w.listeners.set(name, handler),
    clients: { matchAll: async () => [client], openWindow: async url => w.opened.push(url) } }, URL };
  vm.runInNewContext(script, context);
  w.listeners.get('notificationclick')({ notification: { close() {} }, waitUntil: value => { job = value; } });
  await job;
  assert.equal(focused, 1);
  assert.equal(w.opened.length, 0);
  client.navigate = async () => { throw Error('closed tab'); };
  w.listeners.get('notificationclick')({ notification: { close() {} }, waitUntil: value => { job = value; } });
  await job;
  assert.deepEqual(w.opened, ['https://plannix.example.test/settings/notifications']);
});
