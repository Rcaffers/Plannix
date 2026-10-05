import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import helmet from 'helmet';
import { createProductionCspConfig } from '../server/config/csp.js';
import { registerAnalyticsFrameStatic } from '../server/config/analyticsFrameStatic.js';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-analytics-browser-'));
let chrome, socket, server;
try {
  await build({ configFile: false, logLevel: 'error', define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.VITE_GA_MEASUREMENT_ID': '"G-KB7KT8NJW8"',
  }, esbuild: { jsx: 'automatic' }, build: { outDir: directory, emptyOutDir: false,
    lib: { entry: 'src/components/Analytics.browser-test.jsx', formats: ['iife'], name: 'AnalyticsTest',
      fileName: () => 'test.js', cssFileName: 'test' } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/test.css"></head><body><div id="root"></div><script src="/guard.js"></script><script src="/test.js"></script></body></html>');
  await writeFile(path.join(directory, 'guard.js'), "window.__nativeFetch=window.fetch.bind(window);window.fetch=()=>{throw Error('Network disabled in analytics fixture')};");
  await writeFile(path.join(directory, 'analytics-frame.html'),
    await readFile('public/analytics-frame.html'));
  const frameSource = await readFile('public/analytics-frame.js', 'utf8');
  assert.ok(frameSource.includes('document.head.appendChild(script);'));
  await writeFile(path.join(directory, 'analytics-frame.js'), frameSource.replace(
    'document.head.appendChild(script);',
    `window.addEventListener('popstate', () => { window.__automaticHistory = [...(window.__automaticHistory || []), location.href]; });
     window.__syntheticTag = script;`,
  ) + `
    window.addEventListener('message', event => {
      if (event.data?.type === 'test:complete') { window.__syntheticTag?.onload(); return; }
      if (event.data?.type !== 'test:snapshot') return;
      let parentReadable = true;
      try { void window.parent.location.href; } catch { parentReadable = false; }
      window.parent.postMessage({ type: 'test:snapshot',
        events: (window.dataLayer || []).filter(item => item[0] === 'event').map(item => item[2]),
        tag: window.__syntheticTag?.src, parentReadable,
        frameUrl: location.href, automaticHistory: window.__automaticHistory || [] }, '*');
    });`);
  const csp = createProductionCspConfig({
    supabaseUrl: 'https://project.supabase.test',
    frontendOrigins: ['https://app.example.test'],
    gaMeasurementId: 'G-KB7KT8NJW8',
  });
  const app = express();
  app.use(helmet({ contentSecurityPolicy: csp.contentSecurityPolicy }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('error', reject); server.once('listening', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  registerAnalyticsFrameStatic({ app, distDirectory: directory, frameCsp: {
    ...csp.analyticsFrameContentSecurityPolicy,
    directives: { ...csp.analyticsFrameContentSecurityPolicy.directives,
      scriptSrc: [origin, 'https://www.googletagmanager.com'] },
  } });
  app.use(express.static(directory, { index: ['index.html'] }));
  const mainResponse = await fetch(origin);
  const mainPolicy = mainResponse.headers.get('content-security-policy');
  assert.ok(mainPolicy.includes("script-src 'self'") && !mainPolicy.includes('googletagmanager.com')
    && !mainPolicy.includes('google-analytics.com'), 'main document cannot load or connect to Google');
  const frameResponse = await fetch(`${origin}/analytics-frame.html`);
  assert.ok(frameResponse.headers.get('content-security-policy').includes('https://www.googletagmanager.com'));
  const bootstrapResponse = await fetch(`${origin}/analytics-frame.js`);
  assert.equal(bootstrapResponse.headers.get('cross-origin-resource-policy'), 'cross-origin');
  const otherResponse = await fetch(`${origin}/guard.js`);
  assert.equal(otherResponse.headers.get('cross-origin-resource-policy'), 'same-origin',
    'CORP exception applies only to the frame bootstrap');
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-gpu',
      '--remote-debugging-port=0', '--window-size=1400,1000', `--user-data-dir=${directory}/profile`, origin],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(wsURL); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0; const pending = new Map();
  const pausedGoogle = [];
  socket.onmessage = event => { const message = JSON.parse(event.data), item = pending.get(message.id);
    if (message.method === 'Fetch.requestPaused') {
      pausedGoogle.push(message.params.request.url);
      void send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 204 },
        message.sessionId).catch(() => {});
    }
    if (item) { clearTimeout(item.timer); pending.delete(message.id);
      message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(item => item.type === 'page' && item.url.startsWith(origin));
  assert.ok(target);
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*google*', requestStage: 'Request' }] }, sessionId);
  const reload = async () => {
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.removeEventListener('message', onMessage); reject(Error('Page reload timed out')); }, 10000);
      const onMessage = event => {
        const message = JSON.parse(event.data);
        if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
          clearTimeout(timer); socket.removeEventListener('message', onMessage); resolve();
        }
      };
      socket.addEventListener('message', onMessage);
    });
    await send('Page.reload', {}, sessionId);
    await loaded;
  };
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const evaluateAfterReload = async expression => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { return await evaluate(expression); }
      catch (error) {
        if (!/Execution context was destroyed|Cannot find context|Cannot find default execution context/.test(error.message) || attempt === 39) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  };
  const tick = 'new Promise(resolve=>setTimeout(resolve,30))';
  await evaluateAfterReload('new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(window.__nativeFetch && document.querySelector(".cookie-consent-dialog")){clearInterval(id);resolve(true)}else if(++n>200){clearInterval(id);reject(Error("Consent fixture timed out"))}},50)})');
  const blockedMainGoogle = await evaluateAfterReload(`Promise.all([
    new Promise(resolve => {
      const script=document.createElement('script');
      script.src='https://www.googletagmanager.com/gtag/js?id=G-KB7KT8NJW8';
      script.onload=()=>resolve(false);script.onerror=()=>resolve(true);
      document.head.appendChild(script);
    }),
    window.__nativeFetch('https://www.google-analytics.com/g/collect?test=1')
      .then(()=>false,()=>true)
  ])`);
  assert.deepEqual(blockedMainGoogle, [true, true], 'main CSP blocks Google script and connection');
  assert.deepEqual(pausedGoogle, [], 'blocked requests never reach the synthetic network interceptor');
  const snapshot = async () => evaluate(`new Promise((resolve,reject) => {
    const frame=document.querySelector('iframe[src="/analytics-frame.html"]');
    if(!frame) { reject(Error('Analytics frame missing')); return; }
    const timeout=setTimeout(()=>{window.removeEventListener('message',receive);reject(Error('Frame snapshot timed out'))},2000);
    function receive(event) { if(event.source!==frame.contentWindow || event.data?.type!=='test:snapshot') return;
      clearTimeout(timeout);window.removeEventListener('message',receive);resolve(event.data); }
    window.addEventListener('message',receive);
    frame.contentWindow.postMessage({type:'test:snapshot'},'*');
  })`);
  const completeTag = async () => {
    await evaluate('document.querySelector("iframe").contentWindow.postMessage({type:"test:complete"},"*")');
    await evaluate(tick);
  };
  await evaluateAfterReload('new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.querySelector(".cookie-consent-dialog")){clearInterval(id);resolve(true)}else if(++n>200){clearInterval(id);reject(Error("Consent fixture timed out"))}},50)})');
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'no frame before consent');
  assert.equal(await evaluate('document.activeElement?.textContent'), 'Reject analytics', 'keyboard focus enters the consent dialog');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }, sessionId);
  assert.equal(await evaluate('document.activeElement?.textContent'), 'Accept analytics', 'Shift+Tab wraps within dialog');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
  assert.equal(await evaluate('document.activeElement?.textContent'), 'Reject analytics', 'Tab wraps within dialog');
  assert.equal(await evaluate('document.querySelector("nav")?.inert'), true, 'background is inert');
  for (const width of [320, 375, 390, 430, 820, 1366]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const layout = await evaluate(`(() => { const dialog=document.querySelector('.cookie-consent-dialog'), r=dialog.getBoundingClientRect();
      const buttons=[...dialog.querySelectorAll('button')]; return {scroll:document.documentElement.scrollWidth,
        fits:r.left>=0&&r.right<=innerWidth, buttons:buttons.length===2&&buttons.every(b=>{
          const q=b.getBoundingClientRect();return q.height>=44&&q.left>=r.left&&q.right<=r.right})}; })()`);
    assert.ok(layout.scroll <= width + 1 && layout.fits && layout.buttons, `${width}px consent dialog fits: ${JSON.stringify(layout)}`);
  }
  await evaluate('document.querySelector(".cookie-consent-reject").click()'); await evaluate(tick);
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'reject loads no tag');
  await evaluate('document.querySelector(".footer-legal a:last-child").focus(); document.querySelector(".footer-legal a:last-child").click()');
  await evaluate('document.querySelector(".cookie-consent-accept").click()'); await evaluate(tick);
  assert.equal(await evaluate('document.activeElement?.getAttribute("aria-label")'), 'Cookie settings',
    'closing restores focus to the invoking footer control');
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 1);
  assert.equal(await evaluate('window.dataLayer === undefined'), true, 'Google tag never runs in the application');
  const first = await snapshot();
  assert.equal(first.events.length, 0, 'synthetic tag delays queued event processing');
  assert.equal(first.parentReadable, false, 'opaque frame cannot read parent URL');
  assert.equal(first.frameUrl.endsWith('/analytics-frame.html'), true);
  await completeTag();
  assert.equal((await snapshot()).events[0].page_location, origin + '/');
  await evaluate('document.querySelector("#test-features").click()'); await evaluate(tick);
  const publicNavigation = await snapshot();
  assert.equal(publicNavigation.events.length, 2);
  assert.deepEqual(publicNavigation.automaticHistory, [], 'parent history never reaches frame history listeners');
  await evaluate('document.querySelector("#test-private").click()'); await evaluate(tick);
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'private navigation destroys tag context');
  await evaluate('document.querySelector("#test-auth").click()'); await evaluate(tick);
  await evaluate('document.querySelector("#test-contact").click()'); await evaluate(tick);
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'signed-in public page excluded');
  await evaluate('document.querySelector("#test-auth").click()'); await evaluate(tick);
  await completeTag();
  assert.equal((await snapshot()).events.length, 1);
  await evaluate('document.querySelector("#test-query").click()'); await evaluate(tick);
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'query route excluded');
  await evaluate('document.querySelector(".footer-legal a:last-child").click()');
  await evaluate('document.querySelector(".cookie-consent-reject").click()'); await evaluate(tick);
  await evaluate('document.querySelector("#test-features").click()'); await evaluate(tick);
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'withdrawal keeps tag absent');
  await evaluate(`(() => { localStorage.setItem('plannix_cookie_consent_v2', JSON.stringify({version:2,choice:'analytics'}));
    window.dispatchEvent(new StorageEvent('storage',{key:'plannix_cookie_consent_v2'})); })()`); await evaluate(tick);
  await completeTag();
  assert.equal((await snapshot()).events.length, 1, 'cross-tab acceptance applies');
  await evaluate(`(() => { localStorage.setItem('plannix_cookie_consent_v2', JSON.stringify({version:2,choice:'necessary_only'}));
    window.dispatchEvent(new StorageEvent('storage',{key:'plannix_cookie_consent_v2'})); })()`); await evaluate(tick);
  await evaluate('document.querySelector("#test-contact").click()'); await evaluate(tick);
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'cross-tab withdrawal destroys tag');
  await evaluate(`localStorage.setItem('plannix_cookie_consent_v2', JSON.stringify({version:2,choice:'analytics'}))`);
  await reload();
  await evaluateAfterReload('new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.querySelector("iframe")){clearInterval(id);resolve(true)}else if(++n>200){clearInterval(id);reject(Error("Reloaded analytics fixture timed out"))}},50)})');
  await completeTag();
  assert.equal((await snapshot()).events.length, 1, 'saved acceptance loads once after reload');
  await evaluate('document.querySelector(".footer-legal a:last-child").click()');
  await evaluate('document.querySelector(".cookie-consent-reject").click()'); await evaluate(tick);
  await reload();
  await evaluateAfterReload('new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.querySelector(".footer-legal")){clearInterval(id);resolve(true)}else if(++n>200){clearInterval(id);reject(Error("Reloaded consent fixture timed out"))}},50)})');
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0);
  await evaluate('document.querySelector(".footer-legal a:last-child").click()');
  await evaluate('document.querySelector(".cookie-consent-accept").click()'); await evaluate(tick);
  assert.equal((await snapshot()).events.length, 0, 'accepted but unprocessed event stays inside isolated frame');
  await evaluate('document.querySelector(".footer-legal a:last-child").click()');
  await evaluate('document.querySelector(".cookie-consent-reject").click()'); await evaluate(tick);
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'withdrawal discards queued frame');
  console.log('Isolated tag, consent, reload, private-route teardown, cross-tab updates, focus containment and six responsive widths passed.');
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000); }); }
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
