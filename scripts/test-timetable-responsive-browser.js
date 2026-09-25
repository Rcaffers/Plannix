import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Real browser frames and touch emulation keep responsive media queries observable.
const directory = await mkdtemp(path.join(tmpdir(), 'plannix-responsive-browser-'));
let chrome; let socket;
try {
  await build({ plugins: [{ name: 'session-provider-boundaries', enforce: 'pre', resolveId(source, importer) {
    if (importer?.endsWith('/ProjectCard.jsx') &&
        ['../context/AcademicYearContext', '../context/ClassContext', '../context/TimetableLayoutContext', '../context/TimetableSessionContext'].includes(source)) {
      return path.resolve('src/components/ProjectCard.responsive-browser-test.jsx');
    }
  } }], configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' },
    build: { outDir: directory, emptyOutDir: false, lib: {
      entry: 'src/components/ProjectCard.responsive-browser-test.jsx', formats: ['iife'], name: 'SessionProviderTest', fileName: () => 'test.js', cssFileName: 'test',
    } } });
  await writeFile(path.join(directory, 'frame.html'), '<!doctype html><html><head><link rel="stylesheet" href="test.css"></head><body><script src="test.js"></script></body></html>');
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
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
