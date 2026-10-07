import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clearAnalyticsCookies, createAnalyticsController, publicPage, publicReferrer, validMeasurementId } from './analytics.js';

function fixture(id = 'G-YFG3PYKMXG', frameOrigin = 'https://analytics.plannix.test') {
  const frames = [], writes = [];
  const targets = [];
  const listeners = new Map();
  const win = { location: { origin: 'https://plannix.test', hostname: 'plannix.test', pathname: '/' },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); } };
  const doc = { referrer: 'https://plannix.test/features?private=lesson#name',
    createElement(tag) {
      assert.equal(tag, 'iframe');
      const messages = [];
      const frame = { messages, style: {}, contentWindow: { postMessage: (message, target) => {
        messages.push(message); targets.push(target);
      } },
        setAttribute(name, value) { this[name] = value; }, remove() { this.removed = true; } };
      frames.push(frame);
      return frame;
    }, body: { appendChild() {} } };
  Object.defineProperty(doc, 'cookie', { get() { return '_ga=one; _ga_ABC=two; necessary=yes'; },
    set(value) { writes.push(value); } });
  const controller = createAnalyticsController({ measurementId: id, frameOrigin, win, doc, cleanupTimeoutMs: 20 });
  const update = (overrides = {}) => controller.update({ choice: 'analytics', pathname: '/', authenticated: false,
    authLoading: false, ...overrides });
  return { frames, writes, targets, win, doc, update, listeners };
}

test('configuration and public routes are strict and sanitize referrers', () => {
  assert.equal(validMeasurementId('G-KB7KT8NJW8'), 'G-KB7KT8NJW8');
  for (const value of ['', 'UA-123', 'G-123', 'G-A B', 'G-ABC<script>']) assert.equal(validMeasurementId(value), null);
  assert.deepEqual(publicPage('/features', 'https://plannix.test'), {
    pathname: '/features', title: 'Plannix | Features', url: 'https://plannix.test/features',
  });
  for (const path of ['/timetable', '/settings', '/settings/notifications/summary', '/login',
    '/signup', '/reset-password', '/privacy', '/auth/callback'])
    assert.equal(publicPage(path, 'https://plannix.test'), null);
  assert.equal(publicReferrer('https://plannix.test/contact?email=secret#note', 'https://plannix.test'), 'https://plannix.test/contact');
  assert.equal(publicReferrer('https://plannix.test/timetable?class=7A', 'https://plannix.test'), '');
});

test('no isolated context before acceptance, on excluded routes, or with invalid configuration', () => {
  for (const id of [null, 'G-BAD', 'G-YFG3PYKMXG']) {
    const f = fixture(id, id === 'G-YFG3PYKMXG' ? 'https://plannix.test' : 'https://analytics.plannix.test');
    for (const changes of [
      { choice: undefined }, { choice: 'necessary_only' }, { authenticated: true },
      { authLoading: true }, { pathname: '/settings/events' }, { pathname: '/auth/callback' },
      { hasParameters: true },
    ]) f.update(changes);
    assert.equal(f.frames.length, 0);
  }
  for (const invalidOrigin of ['https://plannix.test', 'http://analytics.plannix.test',
    'https://analytics.plannix.test/path', 'https://analytics.plannix.test?x=1']) {
    const f = fixture('G-YFG3PYKMXG', invalidOrigin);
    f.update();
    assert.equal(f.frames.length, 0);
  }
});

test('only canonical public data enters the sandbox and navigation deduplicates', () => {
  const f = fixture();
  f.update(); f.update();
  assert.equal(f.frames.length, 1);
  const frame = f.frames[0];
  assert.equal(frame.sandbox, 'allow-scripts allow-same-origin');
  assert.equal(frame['aria-hidden'], 'true');
  assert.equal(frame.referrerPolicy, 'no-referrer');
  assert.equal(frame.src, 'https://analytics.plannix.test/analytics-frame.html');
  assert.equal(frame.messages.length, 0);
  frame.onload();
  assert.deepEqual(frame.messages[0], { type: 'plannix:analytics-page', id: 'G-YFG3PYKMXG',
    page_location: 'https://plannix.test/', page_title: 'Plannix | Home',
    page_referrer: 'https://plannix.test/features' });
  f.update(); assert.equal(frame.messages.length, 1);
  f.update({ pathname: '/features' });
  assert.equal(frame.messages.length, 2);
  assert.equal(frame.messages[1].page_location, 'https://plannix.test/features');
  assert.equal(frame.messages[1].page_referrer, 'https://plannix.test/');
  assert.ok(!JSON.stringify(frame.messages).includes('private=lesson'));
  assert.equal(frame.messages[0].page_location, 'https://plannix.test/');
  assert.ok(f.targets.every(target => target === 'https://analytics.plannix.test'));
});

test('excluded navigation and withdrawal terminate the context and discard late work', async () => {
  const f = fixture();
  f.update();
  const old = f.frames[0], lateLoad = old.onload;
  f.update({ pathname: '/auth/callback', hasParameters: true });
  assert.equal(old.removed, true);
  lateLoad();
  assert.equal(old.messages.length, 0);
  f.update({ pathname: '/features' });
  const next = f.frames[1]; next.onload();
  assert.equal(next.messages.length, 1);
  f.update({ choice: 'necessary_only', pathname: '/features' });
  assert.equal(next.messages.at(-1).type, 'plannix:analytics-cleanup');
  const token = next.messages.at(-1).token;
  f.listeners.get('message')({ source: next.contentWindow, origin: 'https://analytics.plannix.test',
    data: { type: 'plannix:analytics-cleanup-done', token, cleared: true } });
  assert.equal(next.removed, true);
  assert.ok(f.writes.some(value => value.startsWith('_ga=')));
  assert.ok(!f.writes.some(value => value.startsWith('necessary=')));
});

test('withdrawal rejects forged acknowledgements and bounds failed cleanup', async () => {
  const f = fixture();
  f.update(); f.frames[0].onload();
  f.update({ choice: 'necessary_only' });
  const frame = f.frames[0], token = frame.messages.at(-1).token;
  f.listeners.get('message')({ source: {}, origin: 'https://analytics.plannix.test',
    data: { type: 'plannix:analytics-cleanup-done', token, cleared: true } });
  f.listeners.get('message')({ source: frame.contentWindow, origin: 'https://wrong.test',
    data: { type: 'plannix:analytics-cleanup-done', token, cleared: true } });
  assert.equal(frame.removed, undefined);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(frame.removed, true);
});

test('withdrawal from an excluded route uses a cleanup-only frame and never queues a page', () => {
  const f = fixture();
  f.update({ pathname: '/settings' });
  f.update({ choice: 'necessary_only', pathname: '/settings' });
  assert.equal(f.frames.length, 1);
  const frame = f.frames[0];
  assert.equal(frame.src, 'https://analytics.plannix.test/analytics-frame.html#cleanup');
  frame.onload();
  assert.deepEqual(frame.messages.map(message => message.type), ['plannix:analytics-cleanup']);
  const token = frame.messages[0].token;
  f.listeners.get('message')({ source: frame.contentWindow, origin: 'https://analytics.plannix.test',
    data: { type: 'plannix:analytics-cleanup-done', token, cleared: false } });
  assert.equal(frame.removed, true);
});

test('frame validates messages and queues only the latest page until a synthetic tag loads', () => {
  const source = readFileSync(new URL('../../server/analytics/analytics-frame.js', import.meta.url), 'utf8');
  const listeners = new Map(), scripts = [], dataLayer = [];
  const parent = { secret: 'never accessible from the frame', postMessage() {} };
  const window = { parent, location: { origin: 'https://analytics.plannix.test' }, dataLayer,
    addEventListener(type, listener) { listeners.set(type, listener); } };
  const document = { head: { appendChild(script) { scripts.push(script); } },
    createElement() { return {}; }, querySelector(selector) { return { content: selector.includes('app-origin')
      ? 'https://plannix.test' : 'G-YFG3PYKMXG' }; } };
  vm.runInNewContext(source, { window, document, URL, Date });
  const message = (page, origin = 'https://plannix.test', sender = parent) => listeners.get('message')({
    source: sender, origin, data: { type: 'plannix:analytics-page', id: 'G-YFG3PYKMXG',
      page_location: `https://plannix.test${page}`, page_title: page === '/' ? 'Plannix | Home' : 'Plannix | Features',
      page_referrer: '' },
  });
  message('/timetable?private=1');
  message('/', 'https://plannix.test', {});
  message('/', 'https://other.test');
  listeners.get('message')({ source: parent, origin: 'https://plannix.test',
    data: { type: 'plannix:analytics-page', id: 'G-KB7KT8NJW8',
      page_location: 'https://plannix.test/', page_title: 'Plannix | Home', page_referrer: '' } });
  assert.equal(scripts.length, 0);
  message('/');
  assert.equal(scripts.length, 1);
  message('/features');
  assert.equal(window.dataLayer.filter(item => item[0] === 'event').length, 0);
  // A tag can install automatic history listeners, but this frame has only its own history.
  const completeLoad = scripts[0].onload;
  scripts[0].onload = () => {
    // Model a tag that automatically listens to history in its own browsing context.
    window.addEventListener('popstate', () => {});
    completeLoad();
  };
  scripts[0].onload();
  const events = window.dataLayer.filter(item => item[0] === 'event');
  assert.equal(events.length, 1);
  assert.equal(events[0][2].page_location, 'https://plannix.test/features');
  assert.ok(!JSON.stringify(events).includes('timetable'));
  assert.equal(listeners.has('popstate'), true);
});

test('frame cleanup uses exact parent source/origin, removes GA cookies, and suppresses late tag work', () => {
  const source = readFileSync(new URL('../../server/analytics/analytics-frame.js', import.meta.url), 'utf8');
  const listeners = new Map(), scripts = [], acknowledgements = [];
  const cookies = new Map([['_ga', 'synthetic'], ['_ga_YFG3PYKMXG', 'synthetic'], ['necessary', 'keep']]);
  const parent = { postMessage(message, target) { acknowledgements.push({ message, target }); } };
  const window = { parent, location: { origin: 'https://analytics.plannix.test' },
    addEventListener(type, listener) { listeners.set(type, listener); } };
  const document = { querySelector(selector) { return { content: selector.includes('app-origin')
    ? 'https://plannix.test' : 'G-YFG3PYKMXG' }; },
  createElement() { return {}; }, head: { appendChild(script) { scripts.push(script); } },
  get cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join('; '); },
  set cookie(value) { const name = value.split('=')[0]; if (value.includes('Max-Age=0')) cookies.delete(name); } };
  vm.runInNewContext(source, { window, document, URL, Date, Number, Object });
  const receive = (data, origin = 'https://plannix.test', sender = parent) => listeners.get('message')({
    data, origin, source: sender,
  });
  receive({ type: 'plannix:analytics-page', id: 'G-YFG3PYKMXG', page_location: 'https://plannix.test/',
    page_title: 'Plannix | Home', page_referrer: '' });
  assert.equal(scripts.length, 1);
  receive({ type: 'plannix:analytics-cleanup', token: 7 }, 'https://wrong.test');
  receive({ type: 'plannix:analytics-cleanup', token: 7 }, 'https://plannix.test', {});
  assert.equal(cookies.has('_ga'), true);
  receive({ type: 'plannix:analytics-cleanup', token: 7 });
  scripts[0].onload();
  assert.equal(cookies.has('_ga'), false);
  assert.equal(cookies.has('_ga_YFG3PYKMXG'), false);
  assert.equal(cookies.has('necessary'), true);
  assert.deepEqual(acknowledgements.map(entry => entry.target), ['https://plannix.test']);
  assert.equal(acknowledgements[0].message.cleared, true);
  assert.equal(window.dataLayer.some(item => item[0] === 'event'), false);
});

test('cookie deletion covers only GA names and current domain/path variants', () => {
  const writes = [];
  const doc = { get cookie() { return '_ga=one; _gid=two; session=keep'; }, set cookie(value) { writes.push(value); } };
  clearAnalyticsCookies(doc, 'plannix.example.co.uk', '/features');
  assert.ok(writes.some(value => value.includes('Path=/features')));
  assert.ok(writes.some(value => value.includes('Domain=plannix.example.co.uk')));
  assert.ok(writes.every(value => !value.startsWith('session=')));
});
