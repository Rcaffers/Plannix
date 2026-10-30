import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const csrf='a'.repeat(43);
const session='__Host-plannix-s-2';
const recoverySession='__Host-plannix-r-3';
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

test('recovery status survives ordinary signed-out reconciliation and sends one scoped password request',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  const sends=[];
  const fetchImpl=async(input,init)=>{
    sends.push({input,init});
    return input.endsWith('/status')
      ? Response.json({authenticated:false,recovery:true,sessionName:recoverySession,csrfToken:csrf})
      : new Response(null,{status:204});
  };
  try {
    const status=await module.serverSessionStatus(fetchImpl);
    assert.equal(status.authenticated,false);
    const captured=module.captureServerRecoveryContext(status.sessionName);
    module.setServerSessionContext(null);
    assert.equal(module.captureServerRecoveryContext(status.sessionName),captured);
    await module.serverAuthFetch('/__stage3/auth/recovery/password',
      {method:'POST',body:'{}'},{fetchImpl,recoveryOperationContext:captured});
    assert.equal(sends.length,2);
    assert.equal(sends[1].init.headers.get('X-Plannix-Expected-Session'),recoverySession);
    assert.equal(sends[1].init.headers.get('X-Plannix-CSRF'),csrf);
    await assert.rejects(module.serverAuthFetch('/api/events',{method:'POST',body:'{}'},
      {fetchImpl}),error=>error.name==='AbortError');
    assert.equal(sends.length,2);
    await module.serverSessionStatus(async()=>Response.json({authenticated:false,csrfToken:csrf}));
    assert.throws(()=>module.captureServerRecoveryContext(recoverySession),
      error=>error.name==='AbortError');
  } finally {globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    await cleanup();}
});

test('definitive recovery rejection invalidates only its captured context; provider uncertainty does not',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  const previousDispatch=globalThis.dispatchEvent;
  const events=[];
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  globalThis.dispatchEvent=event=>{events.push(event.type);return true;};
  const {module,cleanup}=await loadServerMode();
  try {
    await module.serverSessionStatus(async()=>Response.json({authenticated:false,recovery:true,
      sessionName:recoverySession,csrfToken:csrf}));
    const captured=module.captureServerRecoveryContext(recoverySession);
    const uncertain=await module.serverAuthFetch('/__stage3/auth/recovery/password',
      {method:'POST',body:'{}'},{recoveryOperationContext:captured,
        fetchImpl:async()=>new Response(null,{status:403})});
    assert.equal(uncertain.status,403);
    assert.equal(module.captureServerRecoveryContext(recoverySession),captured);
    const rejected=await module.serverAuthFetch('/__stage3/auth/recovery/password',
      {method:'POST',body:'{}'},{recoveryOperationContext:captured,
        fetchImpl:async()=>new Response(null,{status:409,
          headers:{'X-Plannix-Recovery-Outcome':'invalid-session'}})});
    assert.equal(rejected.status,409);
    assert.deepEqual(events,['plannix-recovery-session-invalidated']);
    assert.throws(()=>module.captureServerRecoveryContext(recoverySession),
      error=>error.name==='AbortError');
  } finally {globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    globalThis.dispatchEvent=previousDispatch;await cleanup();}
});

test('two successful bootstraps and four signed-out recovery statuses still allow exactly one reset POST',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  const requests=[];
  const fetchImpl=async(input,init)=>{
    const route=new URL(input).pathname;
    requests.push({route,method:init.method,headers:init.headers});
    if(route.endsWith('/bootstrap')) return Response.json({ready:true,csrfToken:csrf});
    if(route.endsWith('/status')) return Response.json({authenticated:false,
      recovery:true,sessionName:recoverySession,csrfToken:csrf});
    return new Response(null,{status:204});
  };
  try {
    // The live recording had this read pattern before Save. HTTP 200 is not
    // sufficient: each status must explicitly select the recovery session.
    for(const route of ['status','bootstrap','status','bootstrap','status','status']){
      if(route==='bootstrap') await module.bootstrapServerSession(fetchImpl);
      else {
        const result=await module.serverSessionStatus(fetchImpl);
        assert.equal(result.authenticated,false);
        assert.equal(result.recovery,true);
        assert.equal(result.sessionName,recoverySession);
        module.setServerSessionContext(null);
      }
    }
    const captured=module.captureServerRecoveryContext(recoverySession);
    const response=await module.serverAuthFetch('/__stage3/auth/recovery/password',
      {method:'POST',body:'{}'},{fetchImpl,recoveryOperationContext:captured});
    assert.equal(response.status,204);
    assert.deepEqual(requests.map(request=>request.route.split('/').at(-1)),
      ['status','bootstrap','status','bootstrap','status','status','password']);
    assert.equal(requests.filter(request=>request.method==='POST').length,1);
    assert.equal(requests.at(-1).headers.get('X-Plannix-CSRF'),csrf);
    assert.equal(requests.at(-1).headers.get('X-Plannix-Expected-Session'),recoverySession);
  } finally {globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    await cleanup();}
});

test('HTTP 200 status without recovery eligibility cannot authorize password transport',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  let sends=0;
  try {
    const result=await module.serverSessionStatus(async()=>Response.json({
      authenticated:false,csrfToken:csrf}));
    assert.equal(result.recovery,undefined);
    assert.throws(()=>module.captureServerRecoveryContext(recoverySession),
      error=>error.name==='AbortError');
    await assert.rejects(module.serverAuthFetch('/__stage3/auth/recovery/password',
      {method:'POST',body:'{}'},{fetchImpl:()=>{sends+=1;return new Response(null,{status:204});}}),
    error=>error.name==='AbortError');
    assert.equal(sends,0);
  } finally {globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    await cleanup();}
});

test('late recovery status and replaced recovery context cannot restore an old CSRF token',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  const nextSession='__Host-plannix-r-4';
  const nextCsrf='b'.repeat(43);
  let releaseOld;
  const old=()=>new Promise(resolve=>{releaseOld=resolve;});
  try {
    const pending=module.serverSessionStatus(old);
    await Promise.resolve();
    const newer=await module.serverSessionStatus(async()=>Response.json({authenticated:false,
      recovery:true,sessionName:nextSession,csrfToken:nextCsrf}));
    const captured=module.captureServerRecoveryContext(newer.sessionName);
    releaseOld(Response.json({authenticated:false,recovery:true,
      sessionName:recoverySession,csrfToken:csrf}));
    await assert.rejects(pending,error=>error.name==='AbortError');
    assert.equal(module.captureServerRecoveryContext(nextSession),captured);
    module.setServerSessionContext(session,csrf,owner);
    assert.throws(()=>module.captureServerRecoveryContext(nextSession),
      error=>error.name==='AbortError');
    module.notifyServerSessionChange();
    await assert.rejects(module.serverAuthFetch('/__stage3/auth/recovery/password',
      {method:'POST',body:'{}'},{fetchImpl:()=>{throw Error('network was reached');},
        recoveryOperationContext:captured}),error=>error.name==='AbortError');
  } finally {globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    await cleanup();}
});

test('a confirmed recovery response remains confirmed after a later cross-tab change',async()=>{
  const previousLocation=globalThis.location;
  const previousChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;
  globalThis.location={origin:'https://app.plannix.test'};
  const {module,cleanup}=await loadServerMode();
  let release;
  const fetchImpl=()=>new Promise(resolve=>{release=resolve;});
  try {
    await module.serverSessionStatus(async()=>Response.json({authenticated:false,recovery:true,
      sessionName:recoverySession,csrfToken:csrf}));
    const captured=module.captureServerRecoveryContext(recoverySession);
    const pending=module.serverAuthFetch('/__stage3/auth/recovery/password',
      {method:'POST',body:'{}'},{fetchImpl,recoveryOperationContext:captured});
    module.notifyServerSessionChange();
    release(new Response(null,{status:204}));
    assert.equal((await pending).status,204);
    assert.throws(()=>module.captureServerRecoveryContext(recoverySession),
      error=>error.name==='AbortError');
  } finally {globalThis.location=previousLocation;globalThis.BroadcastChannel=previousChannel;
    await cleanup();}
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
