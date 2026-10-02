import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-push-web-locks-'));
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-shared-device';
const device = { endpoint, keys: { auth: 'synthetic-old-auth', p256dh: 'synthetic-old-public' } };
let owner = 'old';
let deviceReads = 0;
let unsubscribes = 0;
let statusWaiting = false;
let releaseStatus;
let server; let chrome; let socket;
try {
  await build({ configFile: false, logLevel: 'error', build: { outDir: directory, emptyOutDir: false, lib: {
    entry: 'src/utils/pushWebLocks.browser-test.js', formats: ['iife'], name: 'PushWebLocksTest', fileName: () => 'test.js',
  } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><body><script src="/test.js"></script></body></html>');
  server = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'");
    if (request.url === '/' || request.url === '/test.js') {
      response.setHeader('Content-Type', request.url === '/' ? 'text/html' : 'text/javascript');
      response.end(await readFile(path.join(directory, request.url === '/' ? 'index.html' : 'test.js')));
    } else if (request.url === '/device') {
      deviceReads++;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(device));
    } else if (request.url === '/status') {
      statusWaiting = true;
      response.setHeader('Content-Type', 'application/json');
      releaseStatus = () => { if (!response.writableEnded) response.end(JSON.stringify({ registered: false })); };
    } else if (request.url === '/register' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024) { response.writeHead(413); response.end(); return; }
      }
      const submitted = JSON.parse(body);
      assert.equal(submitted.endpoint, endpoint);
      owner = 'new';
      device.keys = submitted.keys;
      response.end('{}');
    } else if (request.url === '/unsubscribe' && request.method === 'POST') {
      unsubscribes++;
      response.end('{}');
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-gpu',
      '--remote-debugging-port=0', `--user-data-dir=${directory}/profile`, origin],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const websocketUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(websocketUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async (sessionId, expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (predicate, description) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw Error(`${description} was not observed`);
  };
  const { targetInfos } = await send('Target.getTargets');
  const first = targetInfos.find(item => item.type === 'page' && item.url.startsWith(origin));
  assert.ok(first);
  const { sessionId: oldTab } = await send('Target.attachToTarget', { targetId: first.targetId, flatten: true });
  const { targetId: secondId } = await send('Target.createTarget', { url: origin });
  const { sessionId: newTab } = await send('Target.attachToTarget', { targetId: secondId, flatten: true });
  await waitFor(async () => await evaluate(oldTab, 'typeof window.startOldReconciliation') === 'function'
    && await evaluate(newTab, 'typeof window.startNewRegistration') === 'function', 'two fixture tabs');
  assert.equal(await evaluate(oldTab, 'typeof navigator.locks.request'), 'function');
  assert.equal(await evaluate(newTab, 'typeof navigator.locks.request'), 'function');
  await evaluate(oldTab, 'window.startOldReconciliation()');
  await waitFor(() => statusWaiting, 'old-tab status request');
  assert.equal(deviceReads, 1);
  await evaluate(newTab, 'window.startNewRegistration()');
  await waitFor(async () => {
    const state = await evaluate(oldTab, 'navigator.locks.query().then(value=>({held:value.held.map(item=>item.name),pending:value.pending.map(item=>item.name)}))');
    return state.held.includes('plannix-push-device') && state.pending.includes('plannix-push-device');
  }, 'native held and pending Web Locks');
  assert.equal(await evaluate(newTab, 'window.newRegistrationEntered'), false);
  assert.equal(deviceReads, 1, 'new tab cannot read shared device while old tab holds the lock');
  releaseStatus();
  assert.equal(await evaluate(oldTab, 'window.oldReconciliation.then(value=>value.state)'), 'needsReconciliation');
  assert.equal(await evaluate(newTab, 'window.newRegistration.then(()=>true)'), true);
  assert.equal(owner, 'new');
  assert.equal(device.keys.auth, 'synthetic-new-auth');
  assert.equal(unsubscribes, 0, 'stale status:false does not unsubscribe the newer registration');
  assert.equal(deviceReads, 2);
  console.log('Two native Chrome tabs serialized the shared synthetic subscription; newer registration survived.');
} finally {
  releaseStatus?.();
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill();
    await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000); });
  }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(directory, { recursive: true, force: true });
}
