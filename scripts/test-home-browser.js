import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-home-browser-'));
let chrome, socket;
try {
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
    esbuild: { jsx: 'automatic' }, build: { outDir: directory, emptyOutDir: false,
      lib: { entry: 'src/components/Home.browser-test.jsx', formats: ['iife'], name: 'HomeTest',
        fileName: () => 'test.js', cssFileName: 'test' } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="test.css"></head><body><div id="root"></div><script>window.fetch=()=>{throw Error("Network disabled in homepage fixture")}</script><script src="test.js"></script></body></html>');
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--allow-file-access-from-files', '--disable-background-networking', '--disable-component-update',
      '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', '--window-size=1400,1000',
      `--user-data-dir=${directory}/profile`, `file://${directory}/index.html`],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(wsURL);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data), item = pending.get(message.id);
    if (item) { clearTimeout(item.timer); pending.delete(message.id);
      message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(item => item.type === 'page' && item.url.startsWith('file:'));
  assert.ok(target, 'homepage fixture page exists');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await send('Runtime.evaluate', { expression: 'new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.querySelector("#home-highlights-heading")){clearInterval(id);resolve(true)}else if(++n>200){clearInterval(id);reject(Error("Homepage fixture timed out"))}},50)})', awaitPromise: true }, sessionId);
  const content = (await send('Runtime.evaluate', { expression: `(() => ({
    headings: [...document.querySelectorAll('main h1, main h2, main h3')].map(node => node.textContent),
    headingCount: document.querySelectorAll('main h1').length,
    text: document.querySelector('main').textContent,
    signupButtons: [...document.querySelectorAll('button')].filter(node => /create an account|sign up free/i.test(node.textContent)).length,
    plansLink: document.querySelector('a[href="/features"]')?.textContent,
    anchor: document.querySelector('a[href="#highlights"]')?.textContent,
  }))()`, returnByValue: true }, sessionId)).result.value;
  assert.equal(content.headingCount, 1);
  assert.equal(content.headings[0], 'Plan your teaching week with confidence');
  for (const phrase of ['weekly or Week A/B timetable', 'lesson titles and notes', 'academic year',
    'weekend visibility', 'pasted text, PDF, images, Excel or CSV', 'add them to your draft',
    'save the academic year', 'editable preview', 'does not save events', 'Class Monitor',
    'Excel or print', 'home screen', 'test notification']) {
    assert.ok(content.text.toLowerCase().includes(phrase.toLowerCase()), `homepage describes ${phrase}`);
  }
  assert.doesNotMatch(content.text, /automatic morning summaries|calendar export|offline access|department sharing|MIS integration|School Pro/);
  assert.equal(content.signupButtons, 2);
  assert.ok(content.plansLink && content.anchor, 'existing feature and highlight links remain');
  const widths = [320, 375, 390, 430, 768, 820, 1024, 1366];
  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const layout = (await send('Runtime.evaluate', { expression: `(() => {
      const fits = node => { const r = node.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; };
      return { scroll: document.documentElement.scrollWidth, cards: [...document.querySelectorAll('.home-highlights-card')].every(fits),
        buttons: [...document.querySelectorAll('.hero-button,.cta-actions .button')].every(fits),
        heading: fits(document.querySelector('#home-highlights-heading')) };
    })()`, returnByValue: true }, sessionId)).result.value;
    assert.ok(layout.scroll <= width + 1 && layout.cards && layout.buttons && layout.heading,
      `${width}px homepage content fits: ${JSON.stringify(layout)}`);
  }
  console.log(`Homepage copy, links, headings and ${widths.length} responsive widths passed.`);
  await send('Runtime.evaluate', { expression: 'document.querySelector(".hero-button-secondary").click()', returnByValue: true }, sessionId);
  await send('Runtime.evaluate', { expression: 'new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.querySelector(".features-page")){clearInterval(id);resolve(true)}else if(++n>200){clearInterval(id);reject(Error("Features navigation timed out"))}},50)})', awaitPromise: true }, sessionId);
  const features = (await send('Runtime.evaluate', { expression: `(() => ({
    title: document.querySelector('.features-title')?.textContent,
    headings: [...document.querySelectorAll('.features-card-heading')].map(node => node.textContent),
    text: document.querySelector('.features-page').textContent,
    signup: document.querySelector('.features-card-signup')?.textContent,
  }))()`, returnByValue: true }, sessionId)).result.value;
  assert.equal(features.title, 'Explore what Plannix can do');
  assert.deepEqual(features.headings, ['Plan your teaching year', 'Review AI import suggestions', 'Review and keep in touch']);
  for (const phrase of ['weekly or alternating Week A/B timetable', 'lesson titles and notes',
    'academic year', 'school holidays and closures', 'weekend events', 'pasted text, PDF, images, Excel or CSV',
    'academic-year draft', 'explicitly save', 'editable preview', 'does not save events',
    'Class Monitor', 'inclusive dates', 'Excel or print', 'home screen', 'test notification']) {
    assert.ok(features.text.toLowerCase().includes(phrase.toLowerCase()), `Features describes ${phrase}`);
  }
  assert.doesNotMatch(features.text, /morning summar|calendar export|offline access|department sharing|MIS integration|School Pro|enterprise-style|persist in the browser/i);
  assert.equal(features.signup, 'Sign up');
  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const layout = (await send('Runtime.evaluate', { expression: `(() => {
      const fits = node => { const r = node.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; };
      const cards = [...document.querySelectorAll('.features-card')];
      return { scroll: document.documentElement.scrollWidth, count: cards.length,
        cards: cards.every(node => fits(node) && node.scrollWidth <= node.clientWidth + 1),
        title: fits(document.querySelector('.features-title')),
        signup: fits(document.querySelector('.features-card-signup')) };
    })()`, returnByValue: true }, sessionId)).result.value;
    assert.ok(layout.scroll <= width + 1 && layout.count === 3 && layout.cards && layout.title && layout.signup,
      `${width}px Features content fits: ${JSON.stringify(layout)}`);
  }
  console.log(`Features copy, homepage navigation, signup and ${widths.length} responsive widths passed.`);
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000); }); }
  await rm(directory, { recursive: true, force: true });
}
