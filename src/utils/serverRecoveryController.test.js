import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function fixture(readStatus, statusTimeoutMs = 100) {
  const directory = await mkdtemp(path.join(tmpdir(),'plannix-recovery-controller-'));
  const key = `__recoveryControllerTest_${Math.random().toString(36).slice(2)}`;
  const previousEvents = [globalThis.addEventListener,globalThis.removeEventListener,
    globalThis.dispatchEvent];
  const events = new EventTarget();
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  globalThis.dispatchEvent = events.dispatchEvent.bind(events);
  let context = null;
  const calls = { password:0, email:0 };
  globalThis[key] = {
    bootstrapServerSession:async()=>{}, notifyServerSessionChange:()=>{},
    serverAuthFetch:async()=>{calls.password += 1;return new Response(null,{status:204});},
    serverSessionStatus:async()=>{},
    captureServerRecoveryContext:name=>{
      if (context?.sessionName !== name) throw new DOMException('Changed.','AbortError');
      return context;
    },
    INVALID_RECOVERY_MESSAGE:'Invalid link.',
    RECOVERY_ACKNOWLEDGEMENT:'Acknowledged.',
    validateRecoveryPasswords:()=>null,
  };
  const source = await readFile(new URL('./serverRecoveryController.js',import.meta.url),'utf8');
  const transformed = source.replace(/^import [\s\S]*?from '\.\/serverAuthTransport\.js';\n/m,
    `const { bootstrapServerSession, notifyServerSessionChange, serverAuthFetch, serverSessionStatus, captureServerRecoveryContext } = globalThis[${JSON.stringify(key)}];\n`)
    .replace(/^import [\s\S]*?from '\.\/supabaseRecovery\.js';\n/m,
      `const { INVALID_RECOVERY_MESSAGE, RECOVERY_ACKNOWLEDGEMENT, validateRecoveryPasswords } = globalThis[${JSON.stringify(key)}];\n`)
    .replace(/^import [\s\S]*?from '\.\/serverAuthTestObserver\.js';\n/m,
      'const authTestOperationId = () => null; const observeAuthTestOperation = () => {};\n');
  const file=path.join(directory,'controller.mjs');
  await writeFile(file,transformed);
  const {createServerRecoveryController}=await import(`file://${file}`);
  return {controller:createServerRecoveryController({readStatus:async options=>{
    const result=await readStatus(options);
    if (result?.recovery) context=Object.freeze({sessionName:result.sessionName,
      csrfToken:'a'.repeat(43),generation:0});
    return result;
  },statusTimeoutMs}),calls,
  clearContext:()=>{context=null;globalThis.dispatchEvent(new Event('plannix-recovery-session-invalidated'));},
  cleanup:async()=>{delete globalThis[key];
    [globalThis.addEventListener,globalThis.removeEventListener,globalThis.dispatchEvent] = previousEvents;
    await rm(directory,{recursive:true,force:true});}};
}

const recovery={authenticated:false,recovery:true,sessionName:'__Host-plannix-r-3'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('initial service failure has status-only Retry, which can establish recovery eligibility',async()=>{
  let reads=0;const events=[];
  const item=await fixture(async()=>{reads+=1;
    if(reads===1)throw Object.assign(new Error('network'),{status:503});
    return recovery;});
  try {
    const unsubscribe=item.controller.subscribe({onReady:()=>events.push('ready'),
      onInvalid:()=>events.push('invalid'),onUnavailable:()=>events.push('unavailable')});
    await tick();await tick();
    assert.deepEqual(events,['unavailable']);
    unsubscribe.retry();
    await tick();await tick();
    assert.deepEqual(events,['unavailable','ready']);
    assert.equal(reads,2);
    assert.equal(item.calls.password,0);
    unsubscribe();
  } finally {await item.cleanup();}
});

test('confirmed ineligible status requests a new link and cannot Retry',async()=>{
  let reads=0;const events=[];
  const item=await fixture(async()=>{reads+=1;return {authenticated:false};});
  try {
    const unsubscribe=item.controller.subscribe({onReady:()=>events.push('ready'),
      onInvalid:()=>events.push('invalid'),onUnavailable:()=>events.push('unavailable')});
    await tick();await tick();
    assert.deepEqual(events,['invalid']);
    unsubscribe.retry();await tick();
    assert.equal(reads,1);
    assert.equal(item.calls.password,0);
    unsubscribe();
  } finally {await item.cleanup();}
});

test('timeout and unmount ignore late, abort-ignoring status responses',async()=>{
  const events=[];let release;
  const item=await fixture(()=>new Promise(resolve=>{release=resolve;}),5);
  try {
    const unsubscribe=item.controller.subscribe({onReady:()=>events.push('ready'),
      onInvalid:()=>events.push('invalid'),onUnavailable:()=>events.push('unavailable')});
    await new Promise(resolve=>setTimeout(resolve,15));
    assert.deepEqual(events,['unavailable']);
    unsubscribe();
    release(recovery);await tick();await tick();
    assert.deepEqual(events,['unavailable']);
    assert.equal(item.calls.password,0);
  } finally {await item.cleanup();}
});

test('replacement invalidates ready context and a previous subscription cannot affect a remount',async()=>{
  const events=[];let releaseOld;let reads=0;
  const item=await fixture(()=>{reads+=1;return reads===1?Promise.resolve(recovery)
    :new Promise(resolve=>{releaseOld=resolve;});});
  try {
    const old=item.controller.subscribe({onReady:()=>events.push('old-ready'),
      onInvalid:()=>events.push('old-invalid')});
    await tick();await tick();
    item.clearContext();
    assert.deepEqual(events,['old-ready','old-invalid']);
    old();
    const newer=item.controller.subscribe({onReady:()=>events.push('new-ready'),
      onUnavailable:()=>events.push('new-unavailable')});
    await tick();
    newer();
    releaseOld(recovery);await tick();await tick();
    assert.deepEqual(events,['old-ready','old-invalid']);
    assert.equal(item.calls.password,0);
  } finally {await item.cleanup();}
});

test('a late verification from a replaced subscription cannot re-enable the new form',async()=>{
  let releaseOld;let reads=0;const events=[];
  const item=await fixture(()=>{reads+=1;
    return reads===1?new Promise(resolve=>{releaseOld=resolve;})
      :Promise.resolve({authenticated:false});});
  try {
    const old=item.controller.subscribe({onReady:()=>events.push('old-ready'),
      onInvalid:()=>events.push('old-invalid'),onUnavailable:()=>events.push('old-unavailable')});
    await tick();
    old();
    const newer=item.controller.subscribe({onReady:()=>events.push('new-ready'),
      onInvalid:()=>events.push('new-invalid')});
    await tick();await tick();
    assert.deepEqual(events,['new-invalid']);
    releaseOld(recovery);await tick();await tick();
    assert.deepEqual(events,['new-invalid']);
    assert.equal(item.calls.password,0);
    newer();
  } finally {await item.cleanup();}
});
