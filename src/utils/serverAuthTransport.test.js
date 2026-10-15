import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const csrf='a'.repeat(43);
const session='__Host-plannix-s-2';
const owner='dd000000-0000-4000-8000-000000000001';
async function loadServerMode() {
  const directory=await mkdtemp(path.join(tmpdir(),'plannix-server-auth-transport-'));
  const original=await readFile(new URL('./serverAuthTransport.js',import.meta.url),'utf8');
  const transformed=original.replace('import.meta.env?.VITE_PLANNIX_AUTH_MODE',
    `({VITE_PLANNIX_AUTH_MODE:'server'}).VITE_PLANNIX_AUTH_MODE`)
    .replace("import { observeAuthTestOperation } from './serverAuthTestObserver.js';",
      'const observeAuthTestOperation = () => {};');
  const file=path.join(directory,'transport.mjs');
  await writeFile(file,transformed);
  return {module:await import(`file://${file}`),cleanup:()=>rm(directory,{recursive:true,force:true})};
}

test('cookie transport uses same-origin credentials and session-bound CSRF without bearer fallback',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  const calls=[];
  const fetchImpl=async(input,init)=>{
    calls.push({input,init});
    if (input.endsWith('/bootstrap')) return Response.json({ready:true,csrfToken:csrf});
    return Response.json({ok:true});
  };
  try {
    await module.bootstrapServerSession(fetchImpl);
    module.setServerSessionContext(session,csrf,owner);
    const operationContext=module.captureServerOperationContext(owner);
    const response=await module.serverAuthFetch('/api/events',{method:'POST',
      headers:{Authorization:'Bearer synthetic-should-be-discarded','Content-Type':'application/json'},
      body:'{}'},{fetchImpl,operationContext});
    assert.deepEqual(await response.json(),{ok:true});
    assert.equal(calls.length,2);
    assert.equal(calls[1].input,'https://app.plannix.test/api/events');
    assert.equal(calls[1].init.credentials,'same-origin');
    assert.equal(calls[1].init.headers.get('X-Plannix-CSRF'),csrf);
    assert.equal(calls[1].init.headers.get('X-Plannix-Expected-Session'),session);
    assert.equal(calls[1].init.headers.has('Authorization'),false);
    await assert.rejects(module.serverAuthFetch('https://foreign.test/api/events',{},
      {fetchImpl}),/same-origin/);
    assert.equal(calls.length,2);
  } finally { globalThis.location=previousLocation; globalThis.BroadcastChannel=previousChannel;
    await cleanup(); }
});

test('authenticated mutation without captured context fails before status or write transport',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  let sends=0;
  try {
    module.setServerSessionContext(session,null,owner);
    await assert.rejects(module.serverAuthFetch('/api/timetable/sessions/batch',
      {method:'PUT',body:'{}'},{fetchImpl:()=>{sends++;return Response.json({});}}),
    error=>error.name==='AbortError');
    assert.equal(sends,0);
  } finally {
    globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    await cleanup();
  }
});

test('account-generation changes reject late data and never retry an unsafe request',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  let resolveRequest;
  const requests=[];
  const fetchImpl=async(input,init)=>{
    requests.push({input,init});
    if (input.endsWith('/bootstrap')) return Response.json({ready:true,csrfToken:csrf});
    return new Promise(resolve=>{resolveRequest=resolve;});
  };
  try {
    await module.bootstrapServerSession(fetchImpl);
    module.setServerSessionContext(session,csrf,owner);
    const operationContext=module.captureServerOperationContext(owner);
    const pending=module.serverAuthFetch('/api/events',{method:'POST',body:'{}'},
      {fetchImpl,operationContext});
    await Promise.resolve();
    assert.equal(requests.length,2);
    module.notifyServerSessionChange();
    resolveRequest(Response.json({events:['stale']}));
    await assert.rejects(pending,error=>error.name==='AbortError');
    assert.equal(requests.length,2);
  } finally { globalThis.location=previousLocation; globalThis.BroadcastChannel=previousChannel;
    await cleanup(); }
});

test('synthetic cross-tab change rejects the other tab\'s pending result',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.location={origin:'https://app.plannix.test'};
  const channels=new Set();
  globalThis.BroadcastChannel=class {
    constructor() { channels.add(this); }
    postMessage(data) { for (const other of channels) if (other!==this) other.onmessage?.({data}); }
  };
  const first=await loadServerMode();
  const second=await loadServerMode();
  let resolveRequest;
  const fetchImpl=async(input)=>input.endsWith('/bootstrap')
    ? Response.json({ready:true,csrfToken:csrf})
    : new Promise(resolve=>{resolveRequest=resolve;});
  try {
    await second.module.bootstrapServerSession(fetchImpl);
    second.module.setServerSessionContext(session,csrf);
    const pending=second.module.serverAuthFetch('/api/events',{method:'GET'},{fetchImpl});
    await Promise.resolve();
    first.module.notifyServerSessionChange();
    resolveRequest(Response.json({events:['old account']}));
    await assert.rejects(pending,error=>error.name==='AbortError');
  } finally { globalThis.location=previousLocation; globalThis.BroadcastChannel=previousChannel;
    await first.cleanup(); await second.cleanup(); }
});

test('aborted status rejects an abort-ignoring response before it can update CSRF',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  const abort=new AbortController();
  let release;
  let suppliedSignal;
  const fetchImpl=(_input,init)=>new Promise(resolve=>{
    suppliedSignal=init.signal;
    release=()=>resolve(Response.json({authenticated:false,csrfToken:csrf}));
  });
  try {
    const pending=module.serverSessionStatus(fetchImpl,{signal:abort.signal});
    assert.equal(suppliedSignal,abort.signal);
    abort.abort();
    release();
    await assert.rejects(pending,error=>error.name==='AbortError');
  } finally {
    globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    await cleanup();
  }
});

test('a B status does not install B CSRF behind A UI or authorize an A mutation',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  const previousAdd=globalThis.addEventListener;
  const previousRemove=globalThis.removeEventListener;
  const previousDispatch=globalThis.dispatchEvent;
  const target=new EventTarget();
  globalThis.addEventListener=target.addEventListener.bind(target);
  globalThis.removeEventListener=target.removeEventListener.bind(target);
  globalThis.dispatchEvent=target.dispatchEvent.bind(target);
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  const csrfB='b'.repeat(43);
  const requests=[];
  let mismatches=0;
  const listener=()=>{mismatches+=1;};
  globalThis.addEventListener('plannix-server-session-mismatch',listener);
  const fetchImpl=async(input,init)=>{
    requests.push({input,init});
    if(input.endsWith('/status')) return Response.json({authenticated:true,
      sessionName:'__Host-plannix-s-3',csrfToken:csrfB});
    return Response.json({ok:true});
  };
  try {
    module.setServerSessionContext(session,csrf);
    await assert.rejects(module.serverSessionStatus(fetchImpl),error=>error.name==='AbortError');
    assert.equal(mismatches,1);
    await assert.rejects(module.serverAuthFetch('/api/events',{method:'POST',body:'{}'},
      {fetchImpl}),error=>error.name==='AbortError');
    assert.equal(requests.some(call=>call.input.endsWith('/api/events')),false);
    assert.equal(mismatches,1,'a repeated mismatch does not fan out reconciliation');
  } finally {
    globalThis.removeEventListener('plannix-server-session-mismatch',listener);
    globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    globalThis.addEventListener=previousAdd;globalThis.removeEventListener=previousRemove;
    globalThis.dispatchEvent=previousDispatch;
    await cleanup();
  }
});

test('a server mismatch rejects the mutation result without replaying under the new session',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  let writes=0;
  try {
    module.setServerSessionContext(session,csrf,owner);
    const operationContext=module.captureServerOperationContext(owner);
    await assert.rejects(module.serverAuthJson('/api/academic-year',
      {method:'PUT',body:'{}'},{fetchImpl:async(_input,init)=>{
        writes+=1;
        assert.equal(init.headers.get('X-Plannix-Expected-Session'),session);
        return Response.json({message:'Authentication changed.'},{status:409});
      },operationContext}),error=>error.name==='AbortError');
    assert.equal(writes,1);
  } finally {
    globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    await cleanup();
  }
});

test('same-account session replacement rejects an old in-flight result',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  let release;
  try {
    module.setServerSessionContext(session,csrf);
    const pending=module.serverAuthFetch('/api/events',{},
      {fetchImpl:()=>new Promise(resolve=>{release=resolve;})});
    await Promise.resolve();
    module.invalidateServerSessionContext();
    module.setServerSessionContext('__Host-plannix-s-3','b'.repeat(43));
    release(Response.json({events:['synthetic old version']}));
    await assert.rejects(pending,error=>error.name==='AbortError');
  } finally {
    globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    await cleanup();
  }
});
