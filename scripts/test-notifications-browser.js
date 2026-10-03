import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-notification-browser-'));
let chrome; let socket;
try {
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' },
    plugins: [{ name: 'notification-mock', enforce: 'pre', resolveId(source, importer) {
      if (importer?.endsWith('/Notifications.jsx') && source === '../utils/pushNotifications') return path.resolve('src/pages/Notifications.browser-test.jsx');
      if (importer?.endsWith('/MorningSummaryPanel.jsx') && [
        '../context/AcademicYearContext.jsx', '../context/ClassContext.jsx', '../context/TimetableLayoutContext.jsx',
        '../utils/timetableSessionApi.js', '../utils/eventApi.js', '../utils/morningSummaryApi.js',
      ].includes(source)) return path.resolve('src/pages/Notifications.browser-mocks.js');
    } }], build: { outDir: directory, emptyOutDir: false, lib: {
      entry: 'src/pages/Notifications.browser-test.jsx', formats: ['iife'], name: 'NotificationsTest', fileName: () => 'test.js', cssFileName: 'test',
    } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="test.css"></head><body><div id="root"></div><script>window.fetch=()=>{throw Error("Network disabled")}</script><script src="test.js"></script></body></html>');
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--allow-file-access-from-files', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-gpu',
      '--remote-debugging-port=0', '--window-size=1400,1000', `--user-data-dir=${directory}/profile`, `file://${directory}/index.html`],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsURL = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 20000);
    chrome.on('error', reject); chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } }); });
  socket = new WebSocket(wsURL); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); const item = pending.get(message.id); if (item) { clearTimeout(item.timer); pending.delete(message.id); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(item => item.type === 'page' && item.url.startsWith('file:'));
  assert.ok(target);
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const result = await send('Runtime.evaluate', { expression: `new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(document.body.dataset.testResult){clearInterval(timer);resolve([document.body.dataset.testResult,document.body.dataset.testError])}else if(++n>300){clearInterval(timer);reject(Error('Fixture timed out'))}},50)})`, awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(result.result.value[0], 'passed', result.result.value[1]);
  const widths = [320,375,390,430,768,820,1024,1366];
  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const measured = await send('Runtime.evaluate', { expression: `({width:innerWidth,scroll:document.documentElement.scrollWidth,card:document.querySelector('.settings-timetable-form').getBoundingClientRect().width})`, returnByValue: true }, sessionId);
    assert.ok(measured.result.value.scroll <= width + 1, `${width}px overflow`);
  }
  console.log('Notifications rendered flow and 8 responsive widths passed.');
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000); }); }
  await rm(directory, { recursive: true, force: true });
}
