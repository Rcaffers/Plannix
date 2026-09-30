import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Real browser frames and touch emulation keep responsive media queries observable.
const directory = await mkdtemp(path.join(tmpdir(), 'plannix-academic-ai-browser-'));
let chrome; let socket;
try {
  await build({ plugins: [{ name: 'academic-ai-test-boundaries', enforce: 'pre', resolveId(source, importer) {
    if (importer?.endsWith('/AcademicYear.jsx') && ['../context/AcademicYearContext', '../utils/api'].includes(source)) return path.resolve('src/pages/AcademicYear.ai-browser-test.jsx');
    if (importer?.endsWith('/SchoolHolidayAiImport.jsx') && ['../utils/aiConnectionApi.js', '../utils/holidayExtractionApi.js', '../utils/holidayPdfExtractionApi.js'].includes(source)) return path.resolve('src/pages/AcademicYear.ai-browser-test.jsx');
  } }], configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' },
    build: { outDir: directory, emptyOutDir: false, lib: {
      entry: 'src/pages/AcademicYear.ai-browser-test.jsx', formats: ['iife'], name: 'SessionProviderTest', fileName: () => 'test.js', cssFileName: 'test',
    } } });
  await writeFile(path.join(directory, 'frame.html'), '<!doctype html><html><head><link rel="stylesheet" href="test.css"></head><body><script>window.testNetworkCalls=0;window.testStorageCalls=0;window.fetch=()=>{window.testNetworkCalls++;throw Error("Network disabled in browser fixture")};for(const name of ["getItem","setItem","removeItem","clear"]){Storage.prototype[name]=()=>{window.testStorageCalls++;throw Error("Storage disabled in browser fixture")}};</script><script src="test.js"></script></body></html>');
  const width = 430;
  await writeFile(path.join(directory, 'index.html'), `<!doctype html><html><body><iframe style="width:${width}px;height:900px;border:0" src="frame.html"></iframe></body></html>`);
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
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  await send('Page.reload', {}, sessionId);
  await evaluate(`new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.body.dataset.testResult){clearInterval(id);resolve(document.body.dataset.testResult)}else if(++n>200){clearInterval(id);reject(Error('Fixture did not load'))}},50)})`);
  assert.equal(await evaluate('document.body.dataset.testResult'), 'passed', await evaluate('document.querySelector("pre")?.textContent'));
  console.log(await evaluate('document.querySelector("pre").textContent'));
  // Genuine keyboard input, not a synthetic DOM key event, activates the focused extraction button.
  await send('Page.bringToFront', {}, sessionId);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
  await evaluate(`(()=>{const f=document.querySelector('iframe');f.focus();[...f.contentDocument.querySelectorAll('button')].find(b=>b.textContent==='Extract holidays').focus();})()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
  assert.equal(await evaluate(`new Promise(resolve=>setTimeout(()=>resolve(document.querySelector('iframe').contentDocument.activeElement.id),100))`), 'school-holiday-review-heading');
  const frameEval = expression => evaluate(`(()=>{const d=document.querySelector('iframe').contentDocument;return (${expression});})()`);
  const press = async (key, code, number, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: number, ...(text ? { text } : {}) }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: number }, sessionId);
  };
  await press('Tab', 'Tab', 9);
  assert.equal(await frameEval('d.activeElement.type'), 'checkbox');
  await press(' ', 'Space', 32, ' ');
  assert.equal(await frameEval('d.activeElement.checked'), false);
  await press(' ', 'Space', 32, ' ');
  await press('Tab', 'Tab', 9);
  assert.equal(await frameEval('d.activeElement.id'), 'suggestion-0-label');
  await frameEval('d.activeElement.select()');
  await send('Input.insertText', { text: 'Keyboard reviewed holiday' }, sessionId);
  for (let i = 0; i < 20 && await frameEval('d.activeElement.textContent') !== 'Add selected holidays'; i++) await press('Tab', 'Tab', 9);
  assert.equal(await frameEval('d.activeElement.textContent'), 'Add selected holidays');
  await press('Enter', 'Enter', 13, '\r');
  assert.equal(await frameEval('d.querySelectorAll("[aria-labelledby=school-holidays-heading] [id^=holiday-label-]").length'), 1);
  assert.equal(await frameEval('d.querySelector("[aria-labelledby=school-holidays-heading] [id^=holiday-label-]").value'), 'Keyboard reviewed holiday');
  assert.equal(await frameEval('Boolean(d.querySelector(".settings-saved"))'), false);
  for (let i = 0; i < 40 && await frameEval('d.activeElement.textContent') !== 'Save academic year'; i++) await press('Tab', 'Tab', 9);
  assert.equal(await frameEval('d.activeElement.textContent'), 'Save academic year');
  await press('Enter', 'Enter', 13, '\r');
  assert.equal(await evaluate(`new Promise(resolve=>setTimeout(()=>resolve(Boolean(document.querySelector('iframe').contentDocument.querySelector('.settings-saved'))),100))`), true);
  await frameEval('d.querySelector("#school-holidays-toggle").focus()');
  await press('Enter', 'Enter', 13, '\r');
  assert.equal(await frameEval('d.querySelector("#school-holidays-panel").hidden'), true);
  assert.equal(await frameEval('d.activeElement.id'), 'school-holidays-toggle');
  await press(' ', 'Space', 32, ' ');
  assert.equal(await frameEval('d.querySelector("#school-holidays-panel").hidden'), false);
  assert.equal(await frameEval('d.activeElement.getAttribute("aria-expanded")'), 'true');
  await frameEval('d.querySelector("#public-holidays-panel .settings-holiday-remove").focus()');
  await press('Enter', 'Enter', 13, '\r');
  await frameEval('[...d.querySelectorAll("button")].find(b => b.textContent === "Import holidays").focus()');
  await press('Enter', 'Enter', 13, '\r');
  assert.equal(await evaluate(`new Promise(resolve=>setTimeout(()=>resolve(document.querySelector('iframe').contentDocument.activeElement.closest('#public-holidays-panel') !== null),100))`), true);
  await frameEval('[...d.querySelectorAll("button")].find(b => b.textContent === "Import holidays").focus()');
  await press('Enter', 'Enter', 13, '\r');
  assert.equal(await evaluate(`new Promise(resolve=>setTimeout(()=>resolve(document.querySelector('iframe').contentDocument.activeElement.id),100))`), 'public-holiday-import-status');
  assert.equal(await frameEval('getComputedStyle(d.activeElement).position !== "absolute" && d.activeElement.textContent.includes("No changes were made.")'), true);
  await frameEval('[...d.querySelectorAll("button")].find(b => b.textContent === "Upload PDF").focus()');
  await press('Enter', 'Enter', 13, '\r');
  await writeFile(path.join(directory, 'synthetic.pdf'), 'Synthetic PDF browser fixture; parsing is mocked.');
  const fileObject = await send('Runtime.evaluate', { expression: "document.querySelector('iframe').contentDocument.querySelector('#school-holiday-pdf')" }, sessionId);
  await send('DOM.setFileInputFiles', { objectId: fileObject.result.objectId, files: [path.join(directory, 'synthetic.pdf')] }, sessionId);
  await frameEval('d.querySelector("#school-holiday-pdf").focus()');
  assert.equal(await frameEval('getComputedStyle(d.querySelector(".school-holiday-file-button")).outlineWidth'), '3px');
  await press('Tab', 'Tab', 9);
  assert.equal(await frameEval('d.activeElement.textContent'), 'Extract holidays from PDF');
  await press('Enter', 'Enter', 13, '\r');
  assert.equal(await evaluate(`new Promise(resolve=>setTimeout(()=>resolve(document.querySelector('iframe').contentDocument.activeElement.id),100))`), 'school-holiday-review-heading');
  assert.equal(await frameEval('d.querySelector("#school-holiday-pdf").value'), '');
  await press('Tab', 'Tab', 9); await press('Tab', 'Tab', 9);
  assert.equal(await frameEval('d.activeElement.id'), 'suggestion-0-label');
  await frameEval('d.activeElement.select()');
  await send('Input.insertText', { text: 'Keyboard PDF holiday' }, sessionId);
  for (let i = 0; i < 20 && await frameEval('d.activeElement.textContent') !== 'Add selected holidays'; i++) await press('Tab', 'Tab', 9);
  await press('Enter', 'Enter', 13, '\r');
  assert.equal(await frameEval('[...d.querySelectorAll("#school-holidays-panel input")].some(input => input.value === "Keyboard PDF holiday")'), true);
  console.log('Native keyboard PDF mode, file selection via CDP, extraction, review editing and draft addition passed.');
  console.log('Native keyboard location import focuses new row; duplicate-only import focuses visible outcome.');
  console.log('Native keyboard holiday toggle Enter/Space and retained focus passed.');
  console.log('Native keyboard extraction, focus, include/exclude, label editing, Add and separate Save passed.');
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
