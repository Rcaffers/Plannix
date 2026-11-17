import assert from 'node:assert/strict';
import test from 'node:test';
import { activateWaitingPushWorker, observePushWorkerUpdates } from './pushWorkerUpdates.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
class MockWorker extends EventTarget {
  constructor() { super(); this.state = 'activated'; this.scriptURL = 'https://plannix.test/push-sw.js'; }
}
function fixture() {
  const active = new MockWorker();
  const registration = new EventTarget();
  registration.active = active;
  registration.waiting = null;
  registration.installing = null;
  let checks = 0;
  registration.update = async () => { checks++; };
  const container = new EventTarget();
  container.getRegistration = async () => registration;
  const document = new EventTarget();
  document.visibilityState = 'visible';
  const browser = { navigator:{serviceWorker:container}, document,
    location:{origin:'https://plannix.test'}, setTimeout, clearTimeout };
  return { registration, container, document, browser, checks:() => checks };
}
function waitingWorker(registration) {
  const worker = new MockWorker();
  worker.state = 'installed';
  registration.waiting = worker;
  return worker;
}
test('existing waiting update and newly arriving update are reported without activation or reload', async () => {
  const {registration,browser,checks} = fixture();
  const first = waitingWorker(registration);
  const seen = [];
  const stop = observePushWorkerUpdates({onWaiting:value => seen.push(value)},browser);
  await tick();
  assert.equal(seen.at(-1),first);
  assert.equal(checks(),0,'a waiting worker is not replaced by an automatic check');
  registration.waiting = null;
  registration.dispatchEvent(new Event('updatefound'));
  const second = waitingWorker(registration);
  registration.dispatchEvent(new Event('updatefound'));
  assert.equal(seen.at(-1),second);
  stop();
});
test('multiple tabs observe the same update and activation; deferral never changes registration', async () => {
  const {registration,browser,container} = fixture();
  const tabA=[]; const tabB=[];
  const stopA=observePushWorkerUpdates({onWaiting:value=>tabA.push(value)},browser);
  const stopB=observePushWorkerUpdates({onWaiting:value=>tabB.push(value)},browser);
  await tick();
  const worker=waitingWorker(registration);
  registration.dispatchEvent(new Event('updatefound'));
  assert.equal(tabA.at(-1),worker);
  assert.equal(tabB.at(-1),worker);
  assert.equal(registration.active.state,'activated');
  assert.equal(worker.state,'installed');
  registration.active=worker; registration.waiting=null; worker.state='activated';
  worker.dispatchEvent(new Event('statechange'));
  container.dispatchEvent(new Event('controllerchange'));
  assert.equal(tabA.at(-1),null);
  assert.equal(tabB.at(-1),null);
  stopA();stopB();
});
test('explicit update waits for the device lock and completes without a page reload', async () => {
  const {registration,browser} = fixture();
  const worker=waitingWorker(registration);
  let releaseLock; let entered=false; let posted=false;
  browser.navigator.locks={request:async (_name,_options,task) => {
    await new Promise(resolve => { releaseLock=resolve; });
    entered=true;
    return task({});
  }};
  browser.MessageChannel=class {
    constructor() {
      this.port1={onmessage:null,close() {}};
      this.port2={postMessage:data => this.port1.onmessage?.({data})};
    }
  };
  worker.postMessage=(_message,[port]) => {
    posted=true;
    port.postMessage({accepted:true});
    registration.active=worker; registration.waiting=null; worker.state='activated';
    worker.dispatchEvent(new Event('statechange'));
  };
  const result=activateWaitingPushWorker(worker,browser);
  await tick();
  assert.equal(posted,false);
  releaseLock();
  assert.equal(await result,true);
  assert.equal(entered,true);
  assert.equal(posted,true);
});
test('activation wait releases the device lock so an older pending push can finish', async () => {
  const {registration,browser}=fixture();
  const worker=waitingWorker(registration);
  let held=false; let posted=false;
  browser.navigator.locks={request:async (_name,_options,task) => {
    held=true;
    try {return await task({});} finally {held=false;}
  }};
  browser.MessageChannel=class {constructor() {
    this.port1={onmessage:null,close() {}};
    this.port2={postMessage:data => this.port1.onmessage?.({data})};
  }};
  worker.postMessage=(_message,[port]) => {posted=true;port.postMessage({accepted:true});};
  const result=activateWaitingPushWorker(worker,browser);
  for (let n=0;n<20 && !posted;n++) await tick();
  assert.equal(posted,true);
  await tick();
  assert.equal(held,false,'the activation wait cannot hold the shared display lock');
  registration.active=worker; registration.waiting=null; worker.state='activated';
  worker.dispatchEvent(new Event('statechange'));
  assert.equal(await result,true);
});
test('stale waiting worker and unavailable coordination cannot force an update', async () => {
  const {registration,browser}=fixture();
  const stale=waitingWorker(registration);
  registration.waiting=new MockWorker();
  browser.navigator.locks={request:()=>{throw Error('lock should not run');}};
  browser.MessageChannel=class {};
  await assert.rejects(activateWaitingPushWorker(stale,browser),/changed/);
  assert.equal(stale.state,'installed');
});
test('a replaced waiting worker during lock acquisition is never messaged', async () => {
  const {registration,browser}=fixture();
  const stale=waitingWorker(registration);
  let release;
  browser.navigator.locks={request:async (_name,_options,task) => {
    await new Promise(resolve => {release=resolve;});
    return task({});
  }};
  browser.MessageChannel=class {};
  let posts=0;
  stale.postMessage=() => {posts++;};
  const result=activateWaitingPushWorker(stale,browser);
  for (let n=0;n<20 && !release;n++) await tick();
  registration.waiting=new MockWorker();
  release();
  await assert.rejects(result,/changed/);
  assert.equal(posts,0);
});
test('an unrelated waiting script is ignored and a replaced active worker cannot report success', async () => {
  const {registration,browser}=fixture();
  const unrelated=waitingWorker(registration);
  unrelated.scriptURL='https://plannix.test/other-sw.js';
  const seen=[];
  const stop=observePushWorkerUpdates({onWaiting:value=>seen.push(value)},browser);
  await tick();
  assert.equal(seen.at(-1),null);
  stop();
  const waiting=waitingWorker(registration);
  browser.navigator.locks={request:async (_name,_options,task)=>task({})};
  browser.MessageChannel=class {constructor() {
    this.port1={onmessage:null,close() {}};
    this.port2={postMessage:data=>this.port1.onmessage?.({data})};
  }};
  waiting.postMessage=(_message,[port])=>{
    port.postMessage({accepted:true});
    waiting.state='activated';waiting.dispatchEvent(new Event('statechange'));
    registration.waiting=new MockWorker();
  };
  await assert.rejects(activateWaitingPushWorker(waiting,browser),/changed/);
  assert.notEqual(registration.active,waiting);
});
test('a throwing port close does not retain the device lock or change a confirmed activation', async () => {
  const {registration,browser}=fixture();
  const waiting=waitingWorker(registration);
  let locked=false;
  browser.navigator.locks={request:async (_name,_options,task) => {
    locked=true;
    try {return await task({});} finally {locked=false;}
  }};
  browser.MessageChannel=class {constructor() {
    this.port1={onmessage:null,close() {throw Error('port close failed');}};
    this.port2={postMessage:data => this.port1.onmessage?.({data})};
  }};
  waiting.postMessage=(_message,[port]) => {
    port.postMessage({accepted:true});
    registration.active=waiting; registration.waiting=null; waiting.state='activated';
    waiting.dispatchEvent(new Event('statechange'));
  };
  assert.equal(await activateWaitingPushWorker(waiting,browser),true);
  assert.equal(locked,false);
});
test('missing activation acknowledgement times out, releases the lock and never retries automatically', async () => {
  const {registration,browser}=fixture();
  const waiting=waitingWorker(registration);
  let expire; let locked=false; let posts=0;
  browser.setTimeout=callback => {expire=callback; return 1;};
  browser.clearTimeout=()=>{};
  browser.navigator.locks={request:async (_name,_options,task) => {
    locked=true;
    try {return await task({});} finally {locked=false;}
  }};
  browser.MessageChannel=class {constructor() {
    this.port1={onmessage:null,close() {}};
    this.port2={postMessage() {}};
  }};
  waiting.postMessage=() => {posts++;};
  const result=activateWaitingPushWorker(waiting,browser);
  for (let n=0;n<20 && !posts;n++) await tick();
  assert.equal(posts,1);
  assert.equal(locked,true);
  expire();
  await assert.rejects(result,/unconfirmed/);
  assert.equal(locked,false);
  assert.equal(posts,1);
  assert.equal(waiting.state,'installed');
});
