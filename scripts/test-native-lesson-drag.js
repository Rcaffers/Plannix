import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Browser-generated, trusted drag events from CDP mouse input, not dispatchEvent.
const directory = await mkdtemp(path.join(tmpdir(), 'plannix-native-drag-'));
let chrome; let socket;
try {
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: directory, emptyOutDir: false, lib: { entry: 'src/components/ClassPlacementPalette.browser-test.jsx',
      formats: ['iife'], name: 'NativeDragTest', fileName: () => 'test.js', cssFileName: 'test' } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="test.css"></head><body><script src="test.js"></script></body></html>');
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-gpu',
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
  await evaluate(`new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.body.dataset.testResult){clearInterval(id);resolve(document.body.dataset.testResult)}else if(++n>100){clearInterval(id);reject(Error('Fixture did not load'))}},50)})`);
  assert.equal(await evaluate('document.body.dataset.testResult'), 'passed', await evaluate('document.querySelector("pre")?.textContent'));
  const setup = async () => evaluate(`window.__nativeLessonTest.mount();window.__trustedDrag=[];
    window.__trustedAbort?.abort();window.__trustedAbort=new AbortController();
    for(const type of ['mousedown','dragstart','dragover','drop','dragend'])document.addEventListener(type,e=>window.__trustedDrag.push({type,trusted:e.isTrusted,effect:e.dataTransfer?.effectAllowed,text:e.type==='dragstart'?e.dataTransfer.getData('text/plain'):null}),{signal:window.__trustedAbort.signal});`);
  const point = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const mouse = (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, ...p, ...extra }, sessionId);
  const drag = async (source, targetSelector) => {
    const start = await point(source);
    await mouse('mouseMoved', start);
    await mouse('mousePressed', start, { button: 'left', buttons: 1, clickCount: 1 });
    await mouse('mouseMoved', { x: start.x + 12, y: start.y }, { button: 'left', buttons: 1 });
    await new Promise(resolve => setTimeout(resolve, 200));
    const afterStart = await point(source);
    assert.ok(Math.abs(afterStart.x-start.x) <= 2 && Math.abs(afterStart.y-start.y) <= 2, 'Dragstart must not shift the source away from the pointer');
    // Locate the destination after React has applied drag highlights.
    const end = await point(targetSelector);
    for (let n = 1; n <= 12; n++) { await mouse('mouseMoved', { x: start.x + (end.x-start.x)*n/12, y: start.y+(end.y-start.y)*n/12 }, { button: 'left', buttons: 1 }); await new Promise(resolve => setTimeout(resolve, 40)); }
    await new Promise(resolve => setTimeout(resolve, 200));
    await mouse('mouseReleased', end, { button: 'left', buttons: 0, clickCount: 1 });
  };
  await setup();
  // A prior palette selection must not disappear and shift the lesson on dragstart.
  const palettePoint = await point('.class-placement-return:nth-child(2) button');
  await mouse('mouseMoved', palettePoint);
  await mouse('mousePressed', palettePoint, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', palettePoint, { button: 'left', buttons: 0, clickCount: 1 });
  await drag('#slot-0 .lesson-drag-handle', '#slot-1');
  let state = await evaluate('window.__nativeLessonTest.snapshot()');
  assert.equal(state.edits.length, 1, 'Native slot drag makes exactly one edit');
  assert.equal(state.edits[0].sessions[0].periodId, 'p2');
  assert.equal(state.dragging, false);
  let events = await evaluate('window.__trustedDrag');
  for (const type of ['mousedown','dragstart','dragover','drop']) assert.ok(events.some(e => e.type === type && e.trusted), `Trusted ${type}`);
  assert.equal(JSON.parse(events.find(e => e.type === 'dragstart').text).type, 'session');
  assert.equal(events.find(e => e.type === 'dragstart').effect, 'move');
  await setup();
  await drag('#slot-0 .lesson-drag-handle', '.class-placement-return');
  state = await evaluate('window.__nativeLessonTest.snapshot()');
  assert.equal(state.edits.length, 1, 'Native palette return makes exactly one edit');
  assert.equal(state.edits[0].sessions.length, 1);
  assert.equal(state.edits[0].sessions[0].id, 'lesson-other');
  events = await evaluate('window.__trustedDrag');
  assert.ok(events.some(e => e.type === 'drop' && e.trusted));
  await setup();
  await evaluate(`(()=>{const outside=document.createElement('div');outside.id='native-outside';outside.style.cssText='position:fixed;right:10px;top:10px;width:80px;height:40px';document.body.append(outside)})()`);
  await drag('#slot-0 .lesson-drag-handle', '#native-outside');
  state = await evaluate('window.__nativeLessonTest.snapshot()');
  assert.equal(state.edits.length, 0, 'Outside drop makes no edit');
  assert.equal(state.dragging, false, 'Cancelled native drag clears state');
  assert.ok((await evaluate('window.__trustedDrag')).some(e => e.type === 'dragend' && e.trusted));
  await setup();
  const editPoint = await point('#slot-0 .lesson-card-action');
  await mouse('mouseMoved', editPoint);
  await mouse('mousePressed', editPoint, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', editPoint, { button: 'left', buttons: 0, clickCount: 1 });
  assert.equal((await evaluate('window.__nativeLessonTest.snapshot()')).modalOpens, 1, 'Native ordinary click opens details');
  const key = async (key, code) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code }, sessionId);
  };
  await evaluate(`document.querySelector('#move-fallback').focus()`);
  await key('Enter', 13);
  await evaluate(`document.querySelector('#slot-1 button').focus()`);
  await key('Enter', 13);
  assert.equal((await evaluate('window.__nativeLessonTest.snapshot()')).edits.length, 1, 'Keyboard move fallback makes one edit');
  await setup();
  await evaluate(`document.querySelector('#move-fallback').focus()`);
  await key('Enter', 13); await key('Escape', 27);
  await evaluate(`document.querySelector('#slot-1 button').focus()`);
  await key('Enter', 13);
  assert.equal((await evaluate('window.__nativeLessonTest.snapshot()')).edits.length, 0, 'Escape cancels keyboard move');
  console.log('PASS: trusted native mouse drag moves and returns lessons; one edit each; safe text/plain metadata; dragend clears state.');
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
