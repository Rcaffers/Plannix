// Stage 1 contract proof against Chrome's real cookie jar. No production auth.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createSessionTransitionModel } from '../server/auth/sessionTransitions.js';

const model = createSessionTransitionModel();
const pending = new Map();
const profile = await mkdtemp(path.join(tmpdir(), 'plannix-session-cookie-proof-'));
let server;
let chrome;
let socket;

function send(response, body, cookies = []) {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (cookies.length) response.setHeader('Set-Cookie', cookies);
  response.end(JSON.stringify(body));
}

try {
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const name = url.pathname;
    if (name === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Synthetic cookie contract</title>');
      return;
    }
    if (name === '/bootstrap' || name === '/bootstrap-deferred') {
      const result = model.bootstrap(request.headers.cookie || '');
      const complete = () => send(response, { state: result.state }, result.setCookies);
      if (name === '/bootstrap-deferred') pending.set('bootstrap', complete);
      else complete();
      return;
    }
    if (name === '/login/A' || name === '/login/B' || name === '/login-deferred/A') {
      const owner = name.endsWith('/A') ? 'account-A' : 'account-B';
      const started = model.begin(request.headers.cookie || '');
      const result = started.state === 'started' ? model.finish(started.intent, owner) : started;
      const complete = () => send(response, { state: result.state }, result.setCookies);
      if (name === '/login-deferred/A') pending.set('login-A', complete);
      else complete();
      return;
    }
    if (name === '/logout-deferred') {
      const result = model.logout(request.headers.cookie || '');
      pending.set('logout-A', () => send(response, { state: result.state }, result.setCookies));
      return;
    }
    if (name === '/release-login-A' || name === '/release-logout-A' || name === '/release-bootstrap') {
      const key = name === '/release-login-A' ? 'login-A' : name === '/release-logout-A' ? 'logout-A' : 'bootstrap';
      const release = pending.get(key);
      pending.delete(key);
      if (release) release();
      send(response, { released: Boolean(release) });
      return;
    }
    if (name === '/whoami') {
      const selected = model.inspect(request.headers.cookie || '');
      send(response, { state: selected.state, ownerId: selected.ownerId || null }, selected.cleanup);
      return;
    }
    if (name === '/cookie-count') {
      const cookies = (request.headers.cookie || '').split(';').map(cookie => cookie.trim());
      send(response, { sessionCount: cookies.filter(cookie => cookie.startsWith('__Host-plannix-s-')).length,
        markerCount: cookies.filter(cookie => cookie.startsWith('__Host-plannix-b-')).length });
      return;
    }
    response.statusCode = 404;
    send(response, { error: 'Not found' });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', resolve);
  });
  const origin = `http://localhost:${server.address().port}`;
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--disable-background-networking', '--disable-component-update', '--no-first-run',
      '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, origin],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
    chrome.once('error', reject);
    chrome.stderr.on('data', chunk => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0;
  const calls = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const call = calls.get(message.id);
    if (!call) return;
    clearTimeout(call.timer);
    calls.delete(message.id);
    message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
  };
  const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { calls.delete(id); reject(new Error(`${method} timeout`)); }, 12000);
    calls.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await cdp('Target.getTargets');
  const page = targetInfos.find(item => item.type === 'page' && item.url.startsWith(origin));
  assert.ok(page, 'synthetic page opened');
  const { sessionId: tabA } = await cdp('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const { browserContextId } = await cdp('Target.createBrowserContext');
  const { targetId: tabBTarget } = await cdp('Target.createTarget', { url: origin, browserContextId });
  const { sessionId: tabB } = await cdp('Target.attachToTarget', { targetId: tabBTarget, flatten: true });
  const evaluate = async (sessionId, expression) => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const request = (sessionId, pathname) => evaluate(sessionId, `fetch(${JSON.stringify(pathname)}, { cache: 'no-store' }).then(async r => ({
    body: await r.json(), exposedSetCookie: r.headers.get('set-cookie')
  }))`);
  const waitPending = async key => {
    const deadline = Date.now() + 5000;
    while (!pending.has(key) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(pending.has(key), `${key} reached server`);
  };

  await evaluate(tabA, "window.oldBootstrap = fetch('/bootstrap-deferred').then(r => r.json()); 'started'");
  await waitPending('bootstrap');
  assert.equal((await request(tabA, '/bootstrap')).body.state, 'issued');
  await request(tabA, '/release-bootstrap');
  await evaluate(tabA, 'window.oldBootstrap');
  assert.equal((await request(tabA, '/cookie-count')).body.markerCount, 2);
  assert.equal((await request(tabA, '/bootstrap')).body.state, 'ready');
  assert.equal((await request(tabA, '/cookie-count')).body.markerCount, 1);

  assert.equal((await request(tabA, '/login/A')).body.state, 'created');
  assert.equal((await request(tabA, '/whoami')).body.ownerId, 'account-A');
  assert.equal((await request(tabB, '/whoami')).body.state, 'missing');
  assert.equal((await request(tabB, '/bootstrap')).body.state, 'issued');
  assert.equal((await request(tabB, '/login/B')).body.state, 'created');
  assert.equal((await request(tabB, '/whoami')).body.ownerId, 'account-B');
  assert.equal((await request(tabA, '/whoami')).body.ownerId, 'account-A');

  await evaluate(tabA, "window.oldLogout = fetch('/logout-deferred').then(r => r.json()); 'started'");
  await waitPending('logout-A');
  assert.equal((await request(tabA, '/login/B')).body.state, 'created');
  await request(tabA, '/release-logout-A');
  await evaluate(tabA, 'window.oldLogout');
  assert.equal((await request(tabA, '/whoami')).body.ownerId, 'account-B');
  assert.equal((await request(tabB, '/whoami')).body.ownerId, 'account-B');

  await evaluate(tabA, "window.oldLogin = fetch('/login-deferred/A').then(r => r.json()); 'started'");
  await waitPending('login-A');
  const newer = await request(tabA, '/login/B');
  assert.equal(newer.exposedSetCookie, null);
  await request(tabA, '/release-login-A');
  await evaluate(tabA, 'window.oldLogin');
  assert.equal((await request(tabA, '/whoami')).body.ownerId, 'account-B');
  assert.equal((await request(tabA, '/cookie-count')).body.sessionCount, 1, 'stale cookie cleaned after selection');
  assert.equal(await evaluate(tabA, 'document.cookie'), '', 'HttpOnly session cookies hidden from page JavaScript');
  assert.equal(await evaluate(tabB, 'document.cookie'), '', 'other context cannot read session cookies');
  console.log('Chrome cookie proof passed: reversed bootstrap/login responses, delayed logout, and two isolated browser contexts.');
} finally {
  for (const release of pending.values()) release();
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGKILL');
    await Promise.race([new Promise(resolve => chrome.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await rm(profile, { recursive: true, force: true });
}
