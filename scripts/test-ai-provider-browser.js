import assert from 'node:assert/strict';
import { once } from 'node:events';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Uses an isolated headless profile; never reads the user's browser profile.
const directory = await mkdtemp(path.join(tmpdir(), 'plannix-ai-profile-browser-'));
let chrome; let socket;
try {
  await build({ plugins: [{ name: 'ai-profile-test-boundaries', enforce: 'pre', resolveId(source, importer) {
    if (importer?.endsWith('/AiProviderCard.jsx') && source === '../utils/aiConnectionApi.js') return path.resolve('src/components/AiProviderCard.browser-test.jsx');
    if (importer?.endsWith('/Profile.jsx') && source === '../components/DeleteAccountSection') return '\0test-delete-account';
  }, load(id) { if (id === '\0test-delete-account') return 'export default function DeleteAccountSection(){return null}'; } }], configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' },
    build: { outDir: directory, emptyOutDir: false, lib: {
      entry: 'src/components/AiProviderCard.browser-test.jsx', formats: ['iife'], name: 'AiProviderTest', fileName: () => 'test.js', cssFileName: 'test',
    } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="test.css"></head><body><script>window.testStorageCalls=0;window.testNetworkCalls=0;window.fetch=()=>{window.testNetworkCalls++;throw Error("Network disabled")};for(const name of ["getItem","setItem","removeItem","clear"]){Storage.prototype[name]=()=>{window.testStorageCalls++;throw Error("Storage disabled")}};</script><script src="test.js"></script></body></html>');
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--allow-file-access-from-files', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-gpu',
      '--remote-debugging-port=0', '--window-size=1200,1000', `--user-data-dir=${directory}/profile`, `file://${directory}/index.html`],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome debug startup timed out')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(wsURL); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const pending = new Map();
  socket.onmessage = event => { const m = JSON.parse(event.data); const item = pending.get(m.id); if (item) { clearTimeout(item.timer); pending.delete(m.id); m.error ? item.reject(new Error(m.error.message)) : item.resolve(m.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(t => t.type === 'page' && t.url.startsWith('file:'));
  assert.ok(target, 'Test page exists');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ': ' + r.exceptionDetails.exception?.description);
    return r.result.value;
  };
  await evaluate(`new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.body.dataset.testResult){clearInterval(id);resolve(document.body.dataset.testResult)}else if(++n>200){clearInterval(id);reject(Error('Fixture did not load'))}},50)})`);
  assert.equal(await evaluate('document.body.dataset.testResult'), 'passed', await evaluate('document.querySelector("pre")?.textContent'));
  console.log(await evaluate('document.querySelector("pre").textContent'));

  await send('Page.bringToFront', {}, sessionId);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
  await evaluate('document.querySelector("#ai-provider-title").closest("section").querySelector("input").focus()');
  await send('Input.insertText', { text: 'fixture-key-keyboard-only' }, sessionId);
  assert.equal(await evaluate('document.querySelector("#ai-provider-title").closest("section").querySelector("input").value.length > 0'), true);
  await evaluate('document.querySelector("select[aria-label=Provider]").focus()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', windowsVirtualKeyCode: 65 }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
  assert.equal(await evaluate('document.querySelector("select[aria-label=Provider]").value'), 'anthropic');
  assert.equal(await evaluate('document.querySelector("#ai-provider-title").closest("section").querySelector("input").value'), '');
  assert.equal(await evaluate('window.testStorageCalls'), 0);
  console.log('Native keyboard provider change clears key; no storage.');

} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
