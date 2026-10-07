// Local-only GA4 isolation proof. Never forwards collection requests to Google.
import assert from 'node:assert/strict';
import https from 'node:https';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { build } from 'vite';
import { analyticsHostBoundary } from '../server/config/analyticsHost.js';
import { createProductionCspConfig } from '../server/config/csp.js';

const appHost = 'app.plannix.test';
const analyticsHost = 'analytics.plannix.test';
assert.notEqual(appHost, analyticsHost, 'allow-same-origin must never share the parent host');

const id = 'G-YFG3PYKMXG';
const profile = await mkdtemp(path.join(tmpdir(), 'plannix-ga-origin-'));
let chrome, socket, server;
const paused = [];
const external = [];
const targets = [];
const diagnostics = [];
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', path.join(profile, 'key.pem'), '-out', path.join(profile, 'cert.pem'),
    '-subj', '/CN=app.plannix.test',
    '-addext', 'subjectAltName=DNS:app.plannix.test,DNS:analytics.plannix.test'], { stdio: 'ignore' });
  const app = express();
  let boundary;
  let mainHelmet;
  app.use((req, res, next) => boundary(req, res, next));
  const policy = createProductionCspConfig({ supabaseUrl: 'https://project.supabase.test',
    frontendOrigins: ['https://app.plannix.test'], analyticsFrameOrigin: 'https://analytics.plannix.test',
    gaMeasurementId: id });
  app.use((req, res, next) => mainHelmet(req, res, next));
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><title>Public test page</title><div id="private-marker">Synthetic private marker</div><script src="/parent.js"></script>'));
  app.get('/parent.js', (_req, res) => res.type('application/javascript').send(`
    const frameOrigin='https://analytics.plannix.test:${server.address().port}';
    document.cookie='app_only=synthetic; Path=/; SameSite=Lax';
    window.accept=(source=frameOrigin+'/analytics-frame.html')=>{const f=document.createElement('iframe');f.sandbox='allow-scripts allow-same-origin';f.src=source;
      f.onload=()=>f.contentWindow.postMessage({type:'plannix:analytics-page',id:'${id}',page_location:location.origin+'/',page_title:'Plannix | Home',page_referrer:''},frameOrigin);
      document.body.append(f);return f;};
    window.withdraw=()=>document.querySelector('iframe')?.remove();
    window.cleanup=()=>new Promise(resolve=>{const f=document.querySelector('iframe');if(!f){resolve(false);return}
      const token=12345;const done=(ok)=>{clearTimeout(timer);window.removeEventListener('message',receive);f.remove();resolve(ok)};
      const receive=(event)=>{if(event.source===f.contentWindow&&event.origin===frameOrigin
        &&event.data?.type==='plannix:analytics-cleanup-done'&&event.data.token===token)done(event.data.cleared)};
      const timer=setTimeout(()=>done(false),500);window.addEventListener('message',receive);
      f.contentWindow.postMessage({type:'plannix:analytics-cleanup',token},frameOrigin);
    });`));
  app.get('/api/private', (_req, res) => res.json({ synthetic: true }));
  const fixtureDirectory = path.join(profile, 'fixture');
  app.use(express.static(fixtureDirectory));
  server = https.createServer({ key: await readFile(path.join(profile, 'key.pem')),
    cert: await readFile(path.join(profile, 'cert.pem')) }, app);
  await new Promise((resolve, reject) => { server.listen(0, '127.0.0.1', resolve); server.once('error', reject); });
  const port = server.address().port;
  const appOrigin = `https://${appHost}:${port}`;
  const frameOrigin = `https://${analyticsHost}:${port}`;
  mainHelmet = helmet({ contentSecurityPolicy: { ...policy.contentSecurityPolicy,
    directives: { ...policy.contentSecurityPolicy.directives, frameSrc: [frameOrigin] } } });
  boundary = analyticsHostBoundary({ analyticsFrameOrigin: frameOrigin, applicationOrigin: appOrigin,
    measurementId: id, frameCsp: { ...policy.analyticsFrameContentSecurityPolicy,
      directives: { ...policy.analyticsFrameContentSecurityPolicy.directives, frameAncestors: [appOrigin] } } });
  await build({ configFile: false, logLevel: 'error', define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.VITE_GA_MEASUREMENT_ID': JSON.stringify(id),
    'import.meta.env.VITE_ANALYTICS_FRAME_ORIGIN': JSON.stringify(frameOrigin),
  }, esbuild: { jsx: 'automatic' }, build: { outDir: fixtureDirectory, emptyOutDir: false,
    lib: { entry: 'src/components/Analytics.browser-test.jsx', formats: ['iife'], name: 'AnalyticsTest',
      fileName: () => 'fixture.js', cssFileName: 'fixture' } } });
  await writeFile(path.join(fixtureDirectory, 'fixture.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-gpu',
      '--ignore-certificate-errors', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--host-resolver-rules=MAP app.plannix.test 127.0.0.1, MAP analytics.plannix.test 127.0.0.1', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 20000);
    chrome.once('error', reject);
    chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const calls = new Map();
  const sessions = new Set();
  let childSession;
  let holdTag = true;
  const heldTags = [];
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const callId = ++nextId;
    const timer = setTimeout(() => { calls.delete(callId); reject(Error(`${method} timeout`)); }, 15000);
    calls.set(callId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: callId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const capture = message => {
    const url = new URL(message.params.request.url);
    if (url.hostname === appHost || url.hostname === analyticsHost) {
      void send('Fetch.continueRequest', { requestId: message.params.requestId }, message.sessionId).catch(() => {});
      return;
    }
    external.push({ host: url.hostname, path: url.pathname });
    if (url.hostname.endsWith('google-analytics.com') || url.pathname.includes('/collect')) {
      assert.ok(!/synthetic|settings|private-marker|token=/.test(message.params.request.url), 'collection request contains no private test data');
      paused.push({ host: url.hostname, path: url.pathname, page: url.searchParams.get('dl'), title: url.searchParams.get('dt'), referrer: url.searchParams.get('dr') });
      void send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 204 }, message.sessionId).catch(() => {});
    } else if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
      assert.ok(!Object.keys(message.params.request.headers).some(name => name.toLowerCase() === 'referer'), 'tag request omits referrer');
      if (holdTag) heldTags.push({ requestId: message.params.requestId, sessionId: message.sessionId });
      else void send('Fetch.continueRequest', { requestId: message.params.requestId }, message.sessionId).catch(() => {});
    } else {
      void send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' }, message.sessionId).catch(() => {});
    }
  };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Fetch.requestPaused') capture(message);
    if (message.method === 'Network.loadingFailed') diagnostics.push({ type: 'failed', reason: message.params.errorText });
    if (message.method === 'Network.responseReceived' && message.params.response.url.includes('googletagmanager')) diagnostics.push({ type: 'tag-response', status: message.params.response.status });
    if (message.method === 'Runtime.exceptionThrown') diagnostics.push({ type: 'exception', text: message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text });
    if (message.method === 'Target.attachedToTarget') {
      targets.push({ type: message.params.targetInfo.type, url: message.params.targetInfo.url });
      const sid = message.params.sessionId;
      if (message.params.targetInfo.type === 'iframe') childSession = sid;
      sessions.add(sid);
      void (async () => { await send('Network.enable', {}, sid); await send('Runtime.enable', {}, sid); await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*', requestStage: 'Request' }] }, sid);
        await send('Runtime.runIfWaitingForDebugger', {}, sid); })().catch(() => {});
    }
    const call = calls.get(message.id);
    if (call) { clearTimeout(call.timer); calls.delete(message.id);
      message.error ? call.reject(Error(message.error.message)) : call.resolve(message.result); }
  };
  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find(item => item.type === 'page' && item.url === 'about:blank');
  assert.ok(page);
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*', requestStage: 'Request' }] }, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: `${appOrigin}/` }, sessionId);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  try {
    await evaluate('new Promise((resolve,reject)=>{let n=0;let t=setInterval(()=>{if(window.accept){clearInterval(t);resolve(true)}else if(++n>100){clearInterval(t);reject(Error("page timeout"))}},50)})');
  } catch (error) {
    const state = await evaluate('({url:location.href,title:document.title,body:document.body?.innerText,scripts:[...document.scripts].map(x=>x.src)})');
    throw Error(`${error.message}: ${JSON.stringify({ state, diagnostics })}`);
  }
  assert.equal(paused.length, 0, 'no pre-consent collection');
  assert.equal(external.length, 0, 'no Google requests before acceptance');
  await evaluate('window.accept(); true');
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`Bounded observation timed out: ${JSON.stringify({ external, diagnostics, targets })}`);
  };
  await waitFor(() => heldTags.length === 1);
  await evaluate('window.withdraw(); true');
  for (const held of heldTags) {
    await send('Fetch.failRequest', { requestId: held.requestId, errorReason: 'BlockedByClient' }, held.sessionId).catch(() => {});
  }
  holdTag = false;
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(paused.length, 0, 'withdrawal while tag is pending prevents collection');
  await evaluate('window.accept(); true');
  await waitFor(() => paused.some(item => item.path.includes('/collect')));
  assert.equal(paused.length, 1, 'one validated visit produces one collection attempt');
  const frameTree = await send('Page.getFrameTree', {}, sessionId);
  const frameId = frameTree.frameTree.childFrames?.find(child => child.frame.url === `${frameOrigin}/analytics-frame.html`)?.frame.id;
  assert.ok(frameId || childSession, `separate-origin frame loaded: ${JSON.stringify({ tree: frameTree.frameTree.childFrames, diagnostics, targets })}`);
  const isolated = frameId && !childSession
    ? await send('Page.createIsolatedWorld', { frameId, worldName: 'plannix-proof' }, sessionId) : null;
  const inspected = await send('Runtime.evaluate', { ...(isolated ? { contextId: isolated.executionContextId } : {}), returnByValue: true,
    expression: `(() => {document.cookie='frame_only=synthetic; Path=/; SameSite=Lax';let parentReadable=true,parentStorageReadable=true;
      try{void parent.document.body.innerText}catch{parentReadable=false};try{void parent.localStorage.length}catch{parentStorageReadable=false};
      return {parentReadable,parentStorageReadable,cookieNames:document.cookie.split(';').map(x=>x.split('=')[0].trim())}})()` }, childSession || sessionId);
  const snapshot = inspected.result.value;
  assert.equal(snapshot.parentReadable, false);
  assert.equal(snapshot.parentStorageReadable, false);
  assert.ok(snapshot.cookieNames.includes('frame_only'));
  assert.ok(!snapshot.cookieNames.includes('app_only'));
  const frame = await evaluate(`(() => {const f=document.querySelector('iframe');return {sandbox:f.sandbox.value,src:f.src,parentCookie:document.cookie}})()`);
  assert.match(frame.sandbox, /allow-scripts allow-same-origin/);
  const localRequest = (url, host) => new Promise((resolve, reject) => {
    const outgoing = https.request(`https://127.0.0.1:${port}${url}`, {
      rejectUnauthorized: false, headers: { Host: `${host}:${port}` },
    }, response => { response.resume(); response.on('end', () => resolve(response)); });
    outgoing.on('error', reject); outgoing.end();
  });
  const [analyticsAsset, mainDocument, frameDocument] = await Promise.all([
    localRequest('/api/auth', analyticsHost), localRequest('/', appHost), localRequest('/analytics-frame.html', analyticsHost),
  ]);
  assert.equal(analyticsAsset.statusCode, 404);
  assert.doesNotMatch(mainDocument.headers['content-security-policy'], /googletagmanager|google-analytics/);
  assert.match(frameDocument.headers['content-security-policy'], /googletagmanager\.com/);
  const cookies = (await send('Storage.getCookies', {}, sessionId)).cookies
    .filter(cookie => /app_only|frame_only|^_ga/.test(cookie.name))
    .map(cookie => ({ name: cookie.name, domain: cookie.domain }));
  assert.ok(cookies.some(cookie => cookie.name === 'app_only' && cookie.domain === appHost));
  assert.ok(cookies.some(cookie => cookie.name === 'frame_only' && cookie.domain === analyticsHost));
  assert.ok(cookies.filter(cookie => /^_ga/.test(cookie.name)).every(cookie => cookie.domain === analyticsHost));
  const firstCount = paused.length;
  await evaluate(`document.querySelector('iframe').contentWindow.postMessage({type:'plannix:analytics-page',id:'${id}',page_location:location.origin+'/settings?token=synthetic',page_title:'Private title',page_referrer:''},'${frameOrigin}'); true`);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(paused.length, firstCount, 'private URL/title message rejected');
  await evaluate(`(() => { const sender=document.createElement('iframe'); sender.srcdoc='<script>parent.frames[0].postMessage({type:"plannix:analytics-page",id:"${id}",page_location:"${appOrigin}/features",page_title:"Plannix | Features",page_referrer:""},"${frameOrigin}")<\\/script>';document.body.append(sender);return true;})()`);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(paused.length, firstCount, 'non-parent message source rejected');
  assert.equal(await evaluate(`history.replaceState({},'', '/settings?token=synthetic');window.cleanup()`), true,
    'analytics host acknowledges cookie cleanup');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(paused.length, firstCount, 'excluded navigation destroys frame without further collection');
  const postWithdrawalCookies = (await send('Storage.getCookies', {}, sessionId)).cookies;
  assert.ok(!postWithdrawalCookies.some(cookie => /^_ga/.test(cookie.name) && cookie.domain === analyticsHost),
    'withdrawal clears host-only GA cookies');
  await evaluate(`window.accept('${frameOrigin}/missing.html');true`);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(paused.length, firstCount, 'failed frame does not collect');
  await send('Page.navigate', { url: `${appOrigin}/fixture.html` }, sessionId);
  const fixtureReady = async selector => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return; }
      catch { /* Navigation may have replaced the execution context. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const state = await evaluate('({url:location.href,title:document.title,body:document.body?.innerText,scripts:[...document.scripts].map(x=>x.src)})');
    throw Error(`Rendered consent fixture did not show ${selector}: ${JSON.stringify({ state, diagnostics })}`);
  };
  await fixtureReady('.cookie-consent-dialog');
  const beforeConsent = external.length;
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0);
  assert.equal(external.length, beforeConsent, 'rendered app loads no Google tag before consent');
  await evaluate('document.querySelector(".cookie-consent-reject").click()');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0);
  await evaluate('document.querySelector(".footer-legal a:last-child").click()');
  await evaluate('document.querySelector(".cookie-consent-accept").click()');
  await fixtureReady('iframe');
  await waitFor(() => paused.length > firstCount);
  const acceptedCount = paused.length;
  await evaluate('document.querySelector("#test-private").click()');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'private navigation removes the frame');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(paused.length, acceptedCount, 'private navigation sends no collection');
  await evaluate('document.querySelector("#test-features").click()');
  await fixtureReady('iframe');
  await waitFor(() => paused.length > acceptedCount);
  const featuresCount = paused.length;
  await evaluate('document.querySelector("#test-auth").click()');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'authentication removes the frame');
  await evaluate('document.querySelector("#test-contact").click()');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'signed-in public route stays excluded');
  assert.equal(paused.length, featuresCount);
  await evaluate('document.querySelector("#test-auth").click()');
  await fixtureReady('iframe');
  await waitFor(() => paused.length > featuresCount);
  const beforeRenderedWithdrawal = paused.length;
  await evaluate('document.querySelector(".footer-legal a:last-child").click()');
  await evaluate('document.querySelector(".cookie-consent-reject").click()');
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'withdrawal removes the rendered frame');
  assert.equal(paused.length, beforeRenderedWithdrawal, 'withdrawal sends no extra collection');
  const afterRenderedWithdrawal = (await send('Storage.getCookies', {}, sessionId)).cookies;
  assert.ok(!afterRenderedWithdrawal.some(cookie => /^_ga/.test(cookie.name) && cookie.domain === analyticsHost),
    'rendered withdrawal clears analytics-host cookies');
  await evaluate(`localStorage.setItem('plannix_cookie_consent_v2',JSON.stringify({version:2,choice:'analytics'}));
    window.dispatchEvent(new StorageEvent('storage',{key:'plannix_cookie_consent_v2'}));true`);
  await fixtureReady('iframe');
  await waitFor(() => paused.length > beforeRenderedWithdrawal);
  const beforeCrossTabRejection = paused.length;
  await evaluate(`localStorage.setItem('plannix_cookie_consent_v2',JSON.stringify({version:2,choice:'necessary_only'}));
    window.dispatchEvent(new StorageEvent('storage',{key:'plannix_cookie_consent_v2'}));true`);
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'cross-tab rejection removes the frame');
  assert.equal(paused.length, beforeCrossTabRejection);
  assert.ok(paused.some(item => item.path.includes('/collect')), 'real tag must attempt collection');
  const allowedPages = new Map([['/', 'Plannix | Home'], ['/features', 'Plannix | Features'],
    ['/contact', 'Plannix | Contact']]);
  for (const item of paused) {
    assert.equal(item.host, 'region1.google-analytics.com');
    assert.equal(item.path, '/g/collect');
    const page = new URL(item.page);
    assert.equal(page.origin, appOrigin);
    assert.equal(item.page, `${appOrigin}${page.pathname}`);
    assert.equal(item.title, allowedPages.get(page.pathname));
    assert.ok(item.referrer === '' || [...allowedPages.keys()].some(route => item.referrer === `${appOrigin}${route}`));
  }
  console.log(`Separate-origin Chrome proof passed: ${paused.length} GA4 collection attempts intercepted before transmission; host isolation, consent, private-route teardown and cookie cleanup verified.`);
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGKILL');
    await Promise.race([new Promise(resolve => chrome.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
