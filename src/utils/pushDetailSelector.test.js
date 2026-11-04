import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { commitDetailSelector, invalidateDetailSelector, observeDetailSelector,
  withDetailTransition } from './pushDetailSelector.js';

const sessionA = '__Host-plannix-s-2';
const sessionB = '__Host-plannix-s-3';
const versionA = 'cf000000-0000-4000-8000-000000000001';
const versionB = 'cf000000-0000-4000-8000-000000000002';
const policy = 'cf000000-0000-4000-8000-000000000003';

function fixture() {
  let epoch = 0;
  let selector = null;
  const calls = [];
  const worker = { postMessage(message, ports) {
    calls.push(message.kind);
    queueMicrotask(() => {
      const port = ports[0];
      if (message.kind === 'observe') port.postMessage({ ok:true, epoch, selector });
      else if (message.kind === 'invalidate') { epoch++; selector = null; port.postMessage({ok:true,epoch}); }
      else if (message.kind === 'commit' && message.expectedEpoch === epoch) {
        epoch++; selector = message.selector; port.postMessage({ok:true,epoch});
      } else port.postMessage({ok:false});
      port.close();
    });
  } };
  const browser = { MessageChannel, setTimeout, clearTimeout,
    navigator: { serviceWorker: { getRegistration: async () => ({active:worker}) } } };
  return { browser, calls, state: () => ({epoch,selector}) };
}

test('older registration response cannot replace a newer selector or an invalidation tombstone', async () => {
  const h = fixture();
  const a = await observeDetailSelector(h.browser);
  const b = await observeDetailSelector(h.browser);
  await commitDetailSelector({expectedEpoch:b.epoch,sessionName:sessionB,
    installationVersion:versionB,policyVersion:policy},h.browser);
  await assert.rejects(commitDetailSelector({expectedEpoch:a.epoch,sessionName:sessionA,
    installationVersion:versionA,policyVersion:policy},h.browser));
  assert.equal(h.state().selector.sessionName,sessionB);
  await invalidateDetailSelector(h.browser);
  await assert.rejects(commitDetailSelector({expectedEpoch:b.epoch,sessionName:sessionA,
    installationVersion:versionA,policyVersion:policy},h.browser));
  assert.equal(h.state().selector,null);
});

test('same-account replacement invalidates the old selector before a new explicit enable', async () => {
  const h = fixture();
  const old = await observeDetailSelector(h.browser);
  await commitDetailSelector({expectedEpoch:old.epoch,sessionName:sessionA,
    installationVersion:versionA,policyVersion:policy},h.browser);
  await invalidateDetailSelector(h.browser);
  assert.equal(h.state().selector,null);
  const next = await observeDetailSelector(h.browser);
  await commitDetailSelector({expectedEpoch:next.epoch,sessionName:sessionB,
    installationVersion:versionB,policyVersion:policy},h.browser);
  assert.equal(h.state().selector.sessionName,sessionB);
});

test('failed lock acquisition does not run an auth transition twice', async () => {
  const h = fixture();
  let attempts = 0;
  h.browser.navigator.locks = { request: async () => { throw new Error('lock unavailable'); } };
  const result = await withDetailTransition(async () => { attempts++; return 'done'; }, {browser:h.browser});
  assert.equal(result,'done');
  assert.equal(attempts,1);
  assert.equal(h.state().epoch,1);
});

test('a transition error after lock entry remains the original error with no replay', async () => {
  const h = fixture();
  const failure = new Error('synthetic original');
  let attempts = 0;
  h.browser.navigator.locks = { request: async (_name,_options,callback) => callback({}) };
  await assert.rejects(withDetailTransition(() => { attempts++; throw failure; },
    {browser:h.browser}), error => error === failure);
  assert.equal(attempts,1);
  assert.equal(h.state().epoch,1);
});

test('late lock callback after failed acquisition cannot replay an auth mutation', async () => {
  const h=fixture();let callback;let sends=0;
  h.browser.navigator.locks={request:(_name,_options,work)=>{
    callback=work;return Promise.reject(new Error('acquisition failed'));
  }};
  assert.equal(await withDetailTransition(() => {sends++;return 'accepted';},
    {browser:h.browser}),'accepted');
  await assert.rejects(callback({}),/coordination is unavailable/);
  assert.equal(sends,1);
});

test('an abort-ignoring lock wait has a finite fallback and late callback is inert', async () => {
  const h=fixture();let callback;let sends=0;
  h.browser.setTimeout=done=>setTimeout(done,10);
  h.browser.navigator.locks={request:(_name,_options,work)=>{
    callback=work;return new Promise(() => {});
  }};
  assert.equal(await withDetailTransition(() => {sends++;return 'accepted';},
    {browser:h.browser}),'accepted');
  await assert.rejects(callback({}),/coordination is unavailable/);
  assert.equal(sends,1);
});

test('a non-settling worker registration lookup is bounded and cannot send late work', async () => {
  const h=fixture();
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  h.browser.navigator.serviceWorker.getRegistration=()=>pending;
  h.browser.setTimeout=callback=>setTimeout(callback,10);
  await assert.rejects(observeDetailSelector(h.browser),/timed out/);
  release({active:{postMessage:()=>assert.fail('late worker message sent')}});
  await Promise.resolve();
  assert.deepEqual(h.calls,[]);
});
