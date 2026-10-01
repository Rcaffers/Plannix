import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-events-history-'));
let chrome; let socket; let server;
try {
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
    esbuild: { jsx: 'automatic' }, plugins: [{ name: 'history-test-mocks', enforce: 'pre', resolveId(source, importer) {
      if (importer?.endsWith('/App.jsx') && (source.startsWith('./') || source.startsWith('./utils/'))) {
        if (source === './pages/Events' || source.endsWith('.css')) return null;
        return path.resolve('src/pages/Events.history-browser-test.jsx');
      }
      if (importer?.endsWith('/Events.jsx') && ['../context/AcademicYearContext', '../utils/eventApi.js'].includes(source)) {
        return path.resolve('src/pages/Events.history-browser-test.jsx');
      }
      return null;
    } }], build: { outDir: directory, emptyOutDir: false, lib: {
      entry: 'src/pages/Events.history-browser-test.jsx', formats: ['iife'], name: 'EventsHistoryTest',
      fileName: () => 'test.js', cssFileName: 'test',
    } } });
  await writeFile(path.join(directory, 'guard.js'), 'window.fetch=()=>{throw Error("Network disabled in Events history fixture")};');
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/test.css"></head><body><div id="root"></div><script src="/guard.js"></script><script src="/test.js"></script></body></html>');
  server = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; base-uri 'none'");
    const file = request.url === '/test.js' ? 'test.js' : request.url === '/test.css' ? 'test.css'
      : request.url === '/guard.js' ? 'guard.js' : ['/settings', '/settings/events', '/profile'].includes(request.url) ? 'index.html' : null;
    if (!file) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(await readFile(path.join(directory, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-gpu',
      '--remote-debugging-port=0', `--user-data-dir=${directory}/profile`, `${origin}/settings`],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(wsURL); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); const item = pending.get(message.id);
    if (item) { clearTimeout(item.timer); pending.delete(message.id); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(item => item.type === 'page' && item.url.startsWith(origin));
  assert.ok(target, 'Local history fixture page exists');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  async function evaluate(expression) {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
        return result.result.value;
      } catch (error) {
        if (!String(error.message).includes('Execution context was destroyed') || attempt === 11) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }
  const waitFor = async expression => evaluate(`new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(${expression}){clearInterval(id);resolve(true)}else if(++n>100){clearInterval(id);reject(Error('History condition timed out'))}},30)})`);
  const click = label => evaluate(`([...document.querySelectorAll('a,button')].find(node=>node.textContent.trim()===${JSON.stringify(label)})).click()`);
  const setTitle = value => evaluate(`(()=>{const node=document.querySelector('#event-title');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const state = () => evaluate('({url:location.pathname,title:document.querySelector("#event-title")?.value||null,prompts:window.confirmCalls||0,events:!!document.querySelector(".events-page")})');
  console.log('History fixture attached');
  await waitFor('window.releaseMockAuth');
  console.log('Mock authentication pending');
  assert.equal(await evaluate('!!document.querySelector("[aria-busy=true]") && !document.querySelector(".events-page")'), true,
    'protected content stays hidden before session validation');
  await evaluate('window.releaseMockAuth()');
  await waitFor('document.querySelector("header a")');
  console.log('Mock authentication released');
  await evaluate('window.confirmCalls=0;window.allowNavigation=false;window.confirm=()=>{window.confirmCalls++;return window.allowNavigation}');
  await click('Events route'); await waitFor('document.querySelector(".events-page button")');
  console.log('Events route mounted');
  assert.equal(await evaluate('(()=>{const e=new Event("beforeunload",{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()'), false,
    'clean Events page does not block unload');
  await click('Add event'); await setTitle('Back draft');
  assert.equal(await evaluate('(()=>{const e=new Event("beforeunload",{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()'), true,
    'dirty Events draft protects browser unload');
  await evaluate('history.back()'); await waitFor('window.confirmCalls===1');
  assert.deepEqual(await state(), { url: '/settings/events', title: 'Back draft', prompts: 1, events: true },
    'native Chrome Back rejection preserves URL and draft with one prompt');
  await evaluate('window.allowNavigation=true;history.back()'); await waitFor('location.pathname==="/settings"');
  assert.equal((await state()).prompts, 2, 'native Chrome Back acceptance prompts once');
  await evaluate('history.forward()'); await waitFor('location.pathname==="/settings/events"');
  assert.equal((await state()).prompts, 2, 'clean native Forward does not prompt');
  await click('Profile route'); await waitFor('location.pathname==="/profile"');
  await evaluate('history.back()'); await waitFor('location.pathname==="/settings/events"');
  await click('Add event'); await setTitle('Forward draft');
  await evaluate('window.allowNavigation=false;history.forward()'); await waitFor('window.confirmCalls===3');
  assert.deepEqual(await state(), { url: '/settings/events', title: 'Forward draft', prompts: 3, events: true },
    'native Chrome Forward rejection preserves URL and draft with one prompt');
  await evaluate('window.allowNavigation=true;history.forward()'); await waitFor('location.pathname==="/profile"');
  assert.equal((await state()).prompts, 4, 'native Chrome Forward acceptance prompts once');
  await evaluate('history.back()'); await waitFor('location.pathname==="/settings/events"');
  await click('Add event'); await setTitle('Anchor draft');
  await evaluate('window.allowNavigation=false'); await click('Settings route');
  await waitFor('window.confirmCalls===5');
  assert.equal((await state()).url, '/settings/events', 'anchor rejection retains route with one prompt');
  await evaluate('window.allowNavigation=true'); await click('Settings route'); await waitFor('location.pathname==="/settings"');
  assert.equal((await state()).prompts, 6, 'anchor acceptance prompts once');
  await click('Events route'); await waitFor('location.pathname==="/settings/events"');
  await click('Add event'); await setTitle('Sign-out draft');
  await evaluate('window.allowNavigation=false'); await click('Change year'); await waitFor('window.confirmCalls===7');
  assert.equal((await state()).title, 'Sign-out draft', 'rejected year change preserves draft with one prompt');
  await click('Sign out'); await waitFor('window.confirmCalls===8');
  assert.equal((await state()).events, true, 'rejected sign-out preserves protected editor');
  await evaluate('window.allowNavigation=true'); await click('Sign out');
  await waitFor('!document.querySelector(".events-page")');
  assert.equal((await state()).prompts, 9, 'accepted sign-out prompts once');
  assert.equal(await evaluate('(()=>{const e=new Event("beforeunload",{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()'), false,
    'Events unload guard is removed after sign-out');
  assert.equal(await evaluate('!!document.querySelector("#event-title")'), false, 'protected Events editor is gated after sign-out');
  console.log('Native Chrome Back/Forward, anchor, unload, sign-out and protected-route checks passed.');
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000); }); }
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
