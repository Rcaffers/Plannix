import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-events-browser-'));
let chrome; let socket;
try {
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' },
    plugins: [{ name: 'events-test-mocks', enforce: 'pre', resolveId(source, importer) {
      if (importer?.endsWith('/Events.jsx') && ['../context/AcademicYearContext', '../utils/eventApi.js'].includes(source)) return path.resolve('src/pages/Events.browser-test.jsx');
    } }], build: { outDir: directory, emptyOutDir: false, lib: {
      entry: 'src/pages/Events.browser-test.jsx', formats: ['iife'], name: 'EventsTest', fileName: () => 'test.js', cssFileName: 'test',
    } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="test.css"></head><body><script>window.fetch=()=>{throw Error("Network disabled in Events fixture")};for(const name of ["getItem","setItem","removeItem","clear"]){Storage.prototype[name]=()=>{throw Error("Storage disabled in Events fixture")}};</script><script src="test.js"></script></body></html>');
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--allow-file-access-from-files', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-gpu',
      '--remote-debugging-port=0', '--window-size=1400,1000', `--user-data-dir=${directory}/profile`, `file://${directory}/index.html`],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(wsURL); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const pending = new Map();
  socket.onmessage = event => { const m = JSON.parse(event.data); const item = pending.get(m.id); if (item) { clearTimeout(item.timer); pending.delete(m.id); m.error ? item.reject(Error(m.error.message)) : item.resolve(m.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(item => item.type === 'page' && item.url.startsWith('file:'));
  assert.ok(target, 'Events fixture page exists');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const result = await send('Runtime.evaluate', { expression: 'new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.body.dataset.testResult){clearInterval(id);resolve([document.body.dataset.testResult,document.querySelector("pre")?.textContent])}else if(++n>300){clearInterval(id);reject(Error("Events fixture timed out"))}},50)})', awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(result.result.value[0], 'passed', result.result.value[1]);
  console.log(result.result.value[1]);
  const measurements = [];
  for (const width of [320, 375, 390, 430, 768, 820, 1024, 1366]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const measured = await send('Runtime.evaluate', { expression: `(()=>{const page=document.querySelector('.events-page');const host=page.parentElement;host.style.width='';host.style.removeProperty('--container');host.querySelector('.classes-subnav').style.display='';return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,nav:getComputedStyle(host.querySelector('.classes-subnav')).display}})()`, returnByValue: true }, sessionId);
    assert.ok(measured.result?.value, JSON.stringify(measured.exceptionDetails || measured));
    measurements.push(measured.result.value);
    assert.ok(measured.result.value.scroll <= width + 1, `${width}px viewport overflows to ${measured.result.value.scroll}px`);
  }
  console.log(JSON.stringify(measurements));
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Runtime.evaluate', { expression: `([...document.querySelectorAll('button')].find(button=>button.textContent==='Add event')).focus()` }, sessionId);
  const key = async (type, name, code, text) => send('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: 13, ...(text ? { text } : {}) }, sessionId);
  await key('keyDown', 'Enter', 'Enter', '\r'); await key('keyUp', 'Enter', 'Enter');
  const focused = await send('Runtime.evaluate', { expression: `new Promise(resolve=>requestAnimationFrame(()=>resolve(document.activeElement.id)))`, awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(focused.result.value, 'event-title', 'Native Enter opens Add event and focuses title');
  await send('Runtime.evaluate', { expression: `([...document.querySelectorAll('button')].find(button=>button.textContent==='Cancel')).focus()` }, sessionId);
  await key('keyDown', 'Enter', 'Enter', '\r'); await key('keyUp', 'Enter', 'Enter');
  const cancelled = await send('Runtime.evaluate', { expression: `new Promise(resolve=>requestAnimationFrame(()=>resolve(!document.querySelector('.events-form') && document.activeElement.textContent==='Add event')))`, awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(cancelled.result.value, true, 'Native Enter cancels editor and restores focus');
  await send('Runtime.evaluate', { expression: `([...document.querySelectorAll('button')].find(button=>button.textContent==='Add event')).focus()` }, sessionId);
  await key('keyDown', 'Enter', 'Enter', '\r'); await key('keyUp', 'Enter', 'Enter');
  await send('Runtime.evaluate', { expression: `new Promise(resolve=>requestAnimationFrame(resolve))`, awaitPromise: true }, sessionId);
  await send('Input.insertText', { text: 'Keyboard event' }, sessionId);
  await send('Runtime.evaluate', { expression: `(()=>{const node=document.querySelector('#event-date');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'2027-12-01');node.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(button=>button.textContent==='Save event').focus()})()` }, sessionId);
  await key('keyDown', 'Enter', 'Enter', '\r'); await key('keyUp', 'Enter', 'Enter');
  const saved = await send('Runtime.evaluate', { expression: `new Promise(resolve=>setTimeout(()=>resolve(Boolean([...document.querySelectorAll('button')].find(button=>button.textContent==='Edit Keyboard event'))),50))`, awaitPromise: true, returnByValue: true }, sessionId);
  if (!saved.result.value) {
    const detail = await send('Runtime.evaluate', { expression: `({title:document.querySelector('#event-title')?.value,date:document.querySelector('#event-date')?.value,error:document.querySelector('.events-error')?.textContent})`, returnByValue: true }, sessionId);
    throw Error(`Native Save failed: ${JSON.stringify(detail.result.value)}`);
  }
  await send('Runtime.evaluate', { expression: `([...document.querySelectorAll('button')].find(button=>button.textContent==='Edit Keyboard event')).focus()` }, sessionId);
  await key('keyDown', 'Enter', 'Enter', '\r'); await key('keyUp', 'Enter', 'Enter');
  const edited = await send('Runtime.evaluate', { expression: `new Promise(resolve=>requestAnimationFrame(()=>resolve(document.activeElement.id==='event-title')))`, awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(edited.result.value, true, 'Native Enter opens Edit event');
  await send('Runtime.evaluate', { expression: `([...document.querySelectorAll('button')].find(button=>button.textContent==='Cancel')).focus()` }, sessionId);
  await key('keyDown', 'Enter', 'Enter', '\r'); await key('keyUp', 'Enter', 'Enter');
  await send('Runtime.evaluate', { expression: `([...document.querySelectorAll('button')].find(button=>button.textContent==='Delete Keyboard event')).focus()` }, sessionId);
  await key('keyDown', 'Enter', 'Enter', '\r'); await key('keyUp', 'Enter', 'Enter');
  const deleted = await send('Runtime.evaluate', { expression: `new Promise(resolve=>setTimeout(()=>resolve(![...document.querySelectorAll('button')].some(button=>button.textContent==='Delete Keyboard event')),50))`, awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(deleted.result.value, true, 'Native Enter deletes confirmed event');
  console.log('Native keyboard Add, Cancel, Save, Edit and Delete controls passed.');
  const pendingRecovery = await send('Runtime.evaluate', { expression: 'window.eventsStartRecoveryForUnmount()', awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(pendingRecovery.result.value, true, 'Uncertain create retains its draft during pending recovery reload');
  const unmount = await send('Runtime.evaluate', { expression: 'window.eventsUnmountForTest()', awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(unmount.result.value, true, 'Unmount aborts pending recovery and ignores its late response');
  console.log('Pending recovery unmount cancellation passed.');
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill();
    await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000); });
  }
  await rm(directory, { recursive: true, force: true });
}
