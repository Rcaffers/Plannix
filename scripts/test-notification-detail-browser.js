import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(tmpdir(),'plannix-detail-browser-'));
const workerSource = await readFile(new URL('../public/push-sw.js',import.meta.url),'utf8');
const fixtureWorker = `${workerSource}\n// Synthetic local subscription; no push service registration or push is sent.
self.registration.pushManager.getSubscription = async () => ({endpoint:'https://push.example.test/device'});
self.addEventListener('message', event => {
  if (event.data?.type === 'fixture-capability' && event.ports?.[0]) {
    event.ports[0].postMessage({locks:typeof self.navigator?.locks?.request,
      subtle:typeof self.crypto?.subtle, pushManager:typeof self.registration?.pushManager?.getSubscription});
    return;
  }
  if (event.data?.type !== 'fixture-deliver' || !event.ports?.[0]) return;
  const port = event.ports[0];
  const payload = {type:'plannix-morning-summary',version:1,
    notificationRef:'cf000000-0000-4000-8000-000000000003',
    title:'Your Plannix day',body:'Open Plannix to view your morning summary.'};
  const work = showMorning(payload).then(() => port.postMessage({done:true}),
    () => port.postMessage({done:false}));
  event.waitUntil(work);
});`;
const page = `<!doctype html><meta charset="utf-8"><script>
window.setup = async () => { window.registration = await navigator.serviceWorker.register('/push-sw.js');
  await navigator.serviceWorker.ready; return true; };
window.command = async (kind,extra={}) => new Promise((resolve,reject) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); };
  window.registration.active.postMessage({type:'plannix-detail-selector',kind,expectedEpoch:0,...extra},[channel.port2]);
});
window.deliver = async () => new Promise((resolve,reject) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); };
  window.registration.active.postMessage({type:'fixture-deliver'},[channel.port2]);
});
window.capability = async () => new Promise(resolve => {
  const channel = new MessageChannel();channel.port1.onmessage=event=>resolve(event.data);
  window.registration.active.postMessage({type:'fixture-capability'},[channel.port2]);
});
</script>`;
let heldDetail = null;
let releaseDetail = null;
let holdNextDetail = true;
let currentSessionName = '__Host-plannix-s-2';
const observedPaths = [];
let server; let chrome; let socket;
let primary;
try {
  server = createServer((request,response) => {
    observedPaths.push(request.url);
    response.setHeader('Cache-Control','no-store');
    if (request.url === '/') {response.setHeader('Content-Type','text/html');response.end(page);return;}
    if (request.url === '/push-sw.js') {response.setHeader('Content-Type','text/javascript');response.end(fixtureWorker);return;}
    if (request.url === '/api/notifications/morning-summary/detail-display-config') {
      response.setHeader('Content-Type','application/json');response.end('{"enabled":true}');return;
    }
    if (request.url === '/__stage3/auth/status') {response.setHeader('Content-Type','application/json');
      response.end(JSON.stringify({authenticated:true,sessionName:currentSessionName}));return;}
    if (request.url === '/api/notifications/morning-summary/detail') {
      const respond = () => {response.setHeader('Content-Type','application/json');
        response.end(JSON.stringify({date:'2026-11-03',week:'A',lessons:[{period:1,
          className:'Synthetic class',title:'Synthetic lesson',isPpa:false}],
          events:[],eventTitlesIncluded:false}));};
      if (!holdNextDetail) {respond();return;}
      heldDetail?.();
      releaseDetail = respond;
      return;
    }
    response.writeHead(404);response.end();
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless','--disable-background-networking','--disable-component-update','--no-first-run',
      '--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${directory}/profile`,origin],
    {stdio:['ignore','ignore','pipe']});
  const websocketUrl = await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')),20000);
    chrome.on('error',reject);
    chrome.stderr.on('data',chunk => {const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {clearTimeout(timer);resolve(match[1]);}});
  });
  socket = new WebSocket(websocketUrl);
  await new Promise((resolve,reject) => {socket.onopen=resolve;socket.onerror=reject;});
  let serial = 0;
  const pending = new Map();
  socket.onmessage = event => {const message=JSON.parse(event.data);const item=pending.get(message.id);
    if (!item) return;clearTimeout(item.timer);pending.delete(message.id);
    message.error?item.reject(Error(message.error.message)):item.resolve(message.result);};
  const send = (method,params={},sessionId) => new Promise((resolve,reject) => {
    const id=++serial;const timer=setTimeout(() => {pending.delete(id);reject(Error(`${method} timed out`));},15000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,
      ...(sessionId?{sessionId}:{})}));});
  const evaluate = async (sessionId,expression) => {const result=await send('Runtime.evaluate',
    {expression,awaitPromise:true,returnByValue:true},sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;};
  const until = async (condition,label) => {const deadline=Date.now()+10000;
    while (Date.now()<deadline) {if (await condition()) return;
      await new Promise(resolve => setTimeout(resolve,25));}
    throw Error(`${label} was not observed`);};
  await send('Browser.grantPermissions',{origin,permissions:['notifications']});
  const {targetInfos}=await send('Target.getTargets');
  const first=targetInfos.find(item => item.type==='page' && item.url.startsWith(origin));
  assert.ok(first);
  const {sessionId:tab}=await send('Target.attachToTarget',{targetId:first.targetId,flatten:true});
  await until(async () => await evaluate(tab,"typeof window.setup === 'function'"),
    'fixture page ready');
  assert.equal(await evaluate(tab,'window.setup()'),true);
  const capability=await evaluate(tab,'window.capability()');
  assert.equal(capability.locks,'function','worker must expose shared Web Locks');
  assert.equal(capability.subtle,'object','worker must expose Web Crypto');
  assert.equal(capability.pushManager,'function','worker must have push subscription access');
  const observed=await evaluate(tab,"window.command('observe')");
  assert.equal(observed.ok,true);
  const committed=await evaluate(tab,`window.command('commit',{expectedEpoch:${observed.epoch},
    selector:{sessionName:'__Host-plannix-s-2',installationVersion:'cf000000-0000-4000-8000-000000000001',
      policyVersion:'cf000000-0000-4000-8000-000000000002'}})`);
  assert.equal(committed.ok,true);
  await evaluate(tab,`(()=>{window.releaseTabLock=null;window.tabLock=new Promise(resolve=>{window.releaseTabLock=resolve});
    window.heldLock=navigator.locks.request('plannix-push-device',{mode:'exclusive'},()=>window.tabLock);return true})()`);
  await until(async () => (await evaluate(tab,
    "navigator.locks.query().then(result=>result.held.some(item=>item.name==='plannix-push-device'))")),
  'tab-held device lock');
  let arrived;
  const arrivedPromise=new Promise(resolve => {arrived=resolve;});
  heldDetail=arrived;
  await evaluate(tab,'window.delivery=window.deliver();true');
  await until(async () => await evaluate(tab,
    "navigator.locks.query().then(result=>result.pending.some(item=>item.name==='plannix-push-device'))"),
  'worker waiting for native tab lock');
  assert.equal(releaseDetail,null,'worker cannot authorize while tab owns the lock');
  await evaluate(tab,'window.releaseTabLock();window.heldLock.then(()=>true)');
  const firstOutcome=await Promise.race([arrivedPromise.then(()=>'arrived'),
    evaluate(tab,'window.delivery').then(()=>'completed'),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('Detail request did not arrive')),10000))]);
  assert.equal(firstOutcome,'arrived',`worker completed before detail; paths: ${observedPaths.join(',')}`);
  const invalidated=await evaluate(tab,"window.command('invalidate')");
  assert.equal(invalidated.ok,true);
  releaseDetail();releaseDetail=null;
  assert.equal((await evaluate(tab,'window.delivery')).done,true);
  const notifications=await evaluate(tab,`window.registration.getNotifications({tag:'plannix-morning-summary'})
    .then(items=>items.map(item=>({body:item.body,title:item.title})))`);
  assert.equal(notifications.length,1);
  assert.equal(notifications[0].body,'Open Plannix to view your morning summary.');
  assert.doesNotMatch(JSON.stringify(notifications),/Synthetic lesson/);
  holdNextDetail=false;
  const fresh=await evaluate(tab,"window.command('observe')");
  assert.equal((await evaluate(tab,`window.command('commit',{expectedEpoch:${fresh.epoch},
    selector:{sessionName:'__Host-plannix-s-2',installationVersion:'cf000000-0000-4000-8000-000000000001',
      policyVersion:'cf000000-0000-4000-8000-000000000004'}})`)).ok,true);
  assert.equal((await evaluate(tab,'window.deliver()')).done,true);
  const detailed=await evaluate(tab,`window.registration.getNotifications({tag:'plannix-morning-summary'})
    .then(items=>items.map(item=>item.body))`);
  assert.equal(detailed.length,1);
  assert.match(detailed[0],/Synthetic lesson/);
  currentSessionName='__Host-plannix-s-3';
  assert.equal((await evaluate(tab,'window.deliver()')).done,true);
  const replaced=await evaluate(tab,`window.registration.getNotifications({tag:'plannix-morning-summary'})
    .then(items=>items.map(item=>item.body))`);
  assert.deepEqual(replaced,['Open Plannix to view your morning summary.']);
  console.log('Native Chrome worker/tab lock, stale selector, synthetic detail display and same-account session mismatch passed.');
} catch (error) {primary=error;}
finally {
  const cleanup=[];
  try {releaseDetail?.();} catch (error) {cleanup.push(error);}
  try {socket?.close();} catch (error) {cleanup.push(error);}
  try {if (chrome && chrome.exitCode===null && chrome.signalCode===null) {
    const awaitExit = milliseconds => new Promise(resolve => {
      if (chrome.exitCode!==null || chrome.signalCode!==null) {resolve(true);return;}
      const timer=setTimeout(() => {chrome.off('exit',done);resolve(false);},milliseconds);
      const done=() => {clearTimeout(timer);resolve(true);};
      chrome.once('exit',done);
    });
    chrome.kill();
    if (!await awaitExit(3000)) {
      chrome.kill('SIGKILL');
      if (!await awaitExit(2000)) throw Error('Chrome did not exit during cleanup.');
    }
  }} catch (error) {cleanup.push(error);}
  try {if (server) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
  catch (error) {cleanup.push(error);}
  try {await rm(directory,{recursive:true,force:true});} catch (error) {cleanup.push(error);}
  if (!primary && cleanup.length) primary=cleanup[0];
  else if (primary && cleanup.length) console.error('Secondary browser cleanup failed.');
}
if (primary) throw primary;
