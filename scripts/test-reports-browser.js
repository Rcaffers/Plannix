import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-reports-browser-'));
let chrome, socket;
try {
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' },
    plugins: [{ name: 'reports-mocks', enforce: 'pre', resolveId(source, importer) {
      if (importer?.endsWith('/Reports.jsx') && [
        '../context/AcademicYearContext.jsx', '../context/ClassContext.jsx', '../context/TimetableLayoutContext.jsx',
        '../context/TimetableSessionContext.jsx', '../utils/timetableSessionApi.js',
      ].includes(source)) return path.resolve('src/pages/Reports.browser-test.jsx');
    } }], build: { outDir: directory, emptyOutDir: false, lib: {
      entry: 'src/pages/Reports.browser-test.jsx', formats: ['iife'], name: 'ReportsTest', fileName: () => 'test.js', cssFileName: 'test',
    } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="test.css"></head><body><script>window.fetch=()=>{throw Error("Network disabled in Reports fixture")}</script><script src="test.js"></script></body></html>');
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--allow-file-access-from-files', '--disable-background-networking', '--disable-component-update',
      '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', '--window-size=1400,1000',
      `--user-data-dir=${directory}/profile`, `file://${directory}/index.html`], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(wsURL); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data), item = pending.get(message.id);
    if (item) { clearTimeout(item.timer); pending.delete(message.id); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(item => item.type === 'page' && item.url.startsWith('file:'));
  assert.ok(target, 'Reports fixture page exists');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const result = await send('Runtime.evaluate', { expression: 'new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.body.dataset.testResult){clearInterval(id);resolve([document.body.dataset.testResult,document.querySelector("pre")?.textContent])}else if(++n>300){clearInterval(id);reject(Error("Reports fixture timed out"))}},50)})', awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(result.result.value[0], 'passed', result.result.value[1]);
  console.log(result.result.value[1]);
  const measurements = [];
  for (const width of [320, 375, 390, 430, 768, 820, 1024, 1366]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const measurement = await send('Runtime.evaluate', { expression: '({viewport:innerWidth,scroll:document.documentElement.scrollWidth,card:(()=>{const r=document.querySelector(".reports-card").getBoundingClientRect();return {left:r.left,right:r.right}})(),past:(()=>{const e=document.querySelector(".reports-entry--past");if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {left:r.left,right:r.right,border:s.borderLeftWidth,background:s.backgroundColor}})()})', returnByValue: true }, sessionId);
    const value = measurement.result.value;
    measurements.push(value);
    assert.ok(value.scroll <= width + 1 && value.card.left >= -1 && value.card.right <= width + 1
      && value.past?.left >= value.card.left - 1 && value.past?.right <= value.card.right + 1
      && value.past?.border === '4px' && value.past?.background === 'rgb(255, 243, 236)',
      `${width}px Reports card overflows: ${JSON.stringify(value)}`);
  }
  console.log(JSON.stringify(measurements));
  const unmounted = await send('Runtime.evaluate', { expression: 'window.reportsPendingUnmountForTest()', awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(unmounted.result.value, true, 'Unmount aborts pending report reads and ignores late results');
  console.log('Pending report unmount cancellation passed.');
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000); }); }
  await rm(directory, { recursive: true, force: true });
}
