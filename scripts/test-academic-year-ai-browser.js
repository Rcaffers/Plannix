import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const directory = await mkdtemp(path.join(tmpdir(), 'plannix-academic-year-ai-browser-'));
let chrome, socket;
try {
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' },
    plugins: [{ name: 'academic-year-ai-mocks', enforce: 'pre', resolveId(source, importer) {
      if (importer?.endsWith('/AcademicYear.jsx') && ['../context/AcademicYearContext', '../utils/api'].includes(source)) return path.resolve('src/pages/AcademicYear.ai-browser-test.jsx');
      if (importer?.endsWith('/SchoolHolidayAiImport.jsx') && ['../utils/aiConnectionApi.js', '../utils/holidayPdfExtractionApi.js',
        '../utils/holidayExtractionApi.js', '../utils/importPreviewApi.js'].includes(source)) return path.resolve('src/pages/AcademicYear.ai-browser-test.jsx');
    } }], build: { outDir: directory, emptyOutDir: false, lib: {
      entry: 'src/pages/AcademicYear.ai-browser-test.jsx', formats: ['iife'], name: 'AcademicYearAiTest', fileName: () => 'test.js', cssFileName: 'test',
    } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="test.css"></head><body><script>window.fetch=()=>{throw Error("Network disabled in import preview fixture")}</script><script src="test.js"></script></body></html>');
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--allow-file-access-from-files', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-gpu',
      '--remote-debugging-port=0', '--window-size=1400,1000', `--user-data-dir=${directory}/profile`, `file://${directory}/index.html`],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 20000);
    chrome.on('error', reject); chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(wsURL); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data), item = pending.get(message.id);
    if (item) { clearTimeout(item.timer); pending.delete(message.id); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 30000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(item => item.type === 'page' && item.url.startsWith('file:'));
  assert.ok(target);
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const result = await send('Runtime.evaluate', { expression: 'new Promise(resolve=>{let n=0;const id=setInterval(()=>{if(document.body.dataset.testResult){clearInterval(id);resolve([document.body.dataset.testResult,document.querySelector("pre")?.textContent])}else if(++n>200){clearInterval(id);resolve(["timeout",document.body.dataset.step])}},50)})', awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(result.result.value[0], 'passed', result.result.value[1]);
  console.log(result.result.value[1]);
  const widths = [];
  for (const width of [320, 375, 390, 430, 768, 820, 1024, 1366]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const measured = await send('Runtime.evaluate', { expression: '({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.getBoundingClientRect().width,html:getComputedStyle(document.documentElement).minWidth,overflow:[...document.querySelectorAll("body *")].filter(node=>node.getBoundingClientRect().right>innerWidth+1||node.getBoundingClientRect().left<-1||node.scrollWidth>node.clientWidth+1).slice(0,12).map(node=>[node.tagName,node.className,node.getBoundingClientRect().left,node.getBoundingClientRect().right,node.scrollWidth,node.clientWidth])})', returnByValue: true }, sessionId);
    assert.ok(measured.result?.value); widths.push(measured.result.value);
    assert.ok(measured.result.value.scroll <= width + 1, `${width}px overflows: ${JSON.stringify(measured.result.value)}`);
  }
  console.log(JSON.stringify(widths));
  await send('Runtime.evaluate', { expression: `new Promise(resolve=>{[...document.querySelectorAll('button')].find(button=>button.textContent==='Paste text').click();requestAnimationFrame(resolve)})`, awaitPromise: true }, sessionId);
  const keyboardReady = await send('Runtime.evaluate', { expression: `new Promise(resolve=>{const node=document.querySelector('#school-holiday-text');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,'Synthetic calendar');node.dispatchEvent(new Event('input',{bubbles:true}));requestAnimationFrame(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Extract holidays');button.focus();resolve({disabled:button.disabled,focused:document.activeElement===button})})})`, awaitPromise: true, returnByValue: true }, sessionId);
  assert.deepEqual(keyboardReady.result.value, { disabled: false, focused: true }, 'Pasted-text extraction is keyboard ready');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
  const keyboard = await send('Runtime.evaluate', { expression: `new Promise(resolve=>setTimeout(()=>resolve(document.activeElement.id),100))`, awaitPromise: true, returnByValue: true }, sessionId);
  assert.equal(keyboard.result.value, 'school-holiday-review-heading', 'Native Enter starts extraction and focuses the holiday review');
  console.log('Native keyboard extraction and review focus passed.');
  const signedOut = await send('Runtime.evaluate', { expression: 'window.verifyAcademicYearSignOut()', awaitPromise: true, returnByValue: true }, sessionId);
  assert.deepEqual(signedOut.result.value, { allowed: true, prompts: 1, previewGuardRemoved: true,
    yearGuardRemoved: true, unloadBlocked: false }, 'accepted sign-out asks once and removes combined draft/preview guards');
  console.log('Combined draft/preview sign-out guard passed.');
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000); }); }
  await rm(directory, { recursive: true, force: true });
}
