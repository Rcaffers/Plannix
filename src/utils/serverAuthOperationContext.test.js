import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const A='dd000000-0000-4000-8000-000000000001';
const B='dd000000-0000-4000-8000-000000000002';
const YEAR='dd000000-0000-4000-8000-000000000003';
const SESSION_A='__Host-plannix-s-2';
const SESSION_B='__Host-plannix-s-3';
const CSRF_A='a'.repeat(43);
const CSRF_B='b'.repeat(43);
const changed=error=>error?.name==='AbortError';
const deferred=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});
  return {promise,release};};

async function fixture() {
  const root=await mkdtemp(path.join(tmpdir(),'plannix-operation-context-'));
  const previous={location:globalThis.location,channel:globalThis.BroadcastChannel};
  globalThis.location={origin:'https://app.plannix.test'};
  globalThis.BroadcastChannel=undefined;
  const source=async name=>readFile(new URL(`./${name}`,import.meta.url),'utf8');
  await writeFile(path.join(root,'serverAuthTestObserver.mjs'),
    await source('serverAuthTestObserver.js'));
  await writeFile(path.join(root,'transport.mjs'),(await source('serverAuthTransport.js'))
    .replace('import.meta.env?.VITE_PLANNIX_AUTH_MODE',
      `({VITE_PLANNIX_AUTH_MODE:'server'}).VITE_PLANNIX_AUTH_MODE`)
    .replace("'./serverAuthTestObserver.js'","'./serverAuthTestObserver.mjs'"));
  await writeFile(path.join(root,'supabase.mjs'),
    'export const getSupabaseClient=()=>{throw Error("No provider access in server mode.");};');
  await writeFile(path.join(root,'api.mjs'),`export const API_BASE_URL='';
    export const JSON_POST_HEADERS={'Content-Type':'application/json'};
    export const deleteAccount=()=>{throw Error('No deletion transport configured.');};
    export class ApiError extends Error { constructor(message,details={}) {
      super(message);Object.assign(this,details); } }
    export const parseJsonSafe=response=>response.json();`);
  await writeFile(path.join(root,'pushDeviceLock.mjs'),await source('pushDeviceLock.js'));
  await writeFile(path.join(root,'timetableSessionState.mjs'),await source('timetableSessionState.js'));
  await writeFile(path.join(root,'timetableOperationContext.mjs'),
    (await source('timetableOperationContext.js')).replace("'./serverAuthTransport.js'","'./transport.mjs'"));
  for(const name of ['pushNotifications','morningSummaryApi','accountDeletion']) {
    await writeFile(path.join(root,`${name}.mjs`),(await source(`${name}.js`))
      .replace("'../lib/supabase.js'","'./supabase.mjs'")
      .replace("'./serverAuthTransport.js'","'./transport.mjs'")
      .replace("'./serverAuthTestObserver.js'","'./serverAuthTestObserver.mjs'")
      .replace("'./api.js'","'./api.mjs'")
      .replace("'./pushDeviceLock.js'","'./pushDeviceLock.mjs'"));
  }
  const transport=await import(`file://${root}/transport.mjs`);
  const push=await import(`file://${root}/pushNotifications.mjs`);
  const summary=await import(`file://${root}/morningSummaryApi.mjs`);
  const deletion=await import(`file://${root}/accountDeletion.mjs`);
  const queue=await import(`file://${root}/timetableSessionState.mjs`);
  const preparation=await import(`file://${root}/timetableOperationContext.mjs`);
  const selectA=()=>transport.setServerSessionContext(SESSION_A,CSRF_A,A);
  const selectB=()=>{transport.invalidateServerSessionContext();
    transport.setServerSessionContext(SESSION_B,CSRF_B,B);};
  const replaceA=()=>{transport.invalidateServerSessionContext();
    transport.setServerSessionContext('__Host-plannix-s-4','c'.repeat(43),A);};
  return {transport,push,summary,deletion,queue,preparation,selectA,selectB,replaceA,
    async close(){globalThis.location=previous.location;globalThis.BroadcastChannel=previous.channel;
      await rm(root,{recursive:true,force:true});}};
}

test('push registration rejects an account change during status preflight without sending',async()=>{
  const f=await fixture();const status=deferred();const calls=[];
  try {
    f.selectA();
    const work=f.push.pushRequest('register',{subscription:{endpoint:'synthetic'}},{
      expectedUserId:A,fetchImpl:(url,init)=>{calls.push({url,init});return status.promise;}});
    assert.equal(calls.length,1);
    f.selectB();
    status.release(Response.json({authenticated:true,userId:A,sessionName:SESSION_A,csrfToken:CSRF_A}));
    await assert.rejects(work,changed);
    assert.equal(calls.length,1,'no registration request or provider write');
  } finally {await f.close();}
});

for (const replacement of ['different account','same account, new session']) {
  test(`dated snapshot preparation cannot save after ${replacement}`,async()=>{
    const f=await fixture();const snapshots=deferred();let saves=0;
    try {
      f.selectA();const context=f.transport.captureServerOperationContext(A);
      const work=f.preparation.prepareTimetableSnapshots(context,()=>snapshots.promise)
        .then(()=>f.transport.serverAuthFetch('/api/timetable/sessions/batch',
          {method:'PUT',body:'{}'},{operationContext:context,fetchImpl:()=>{saves++;return Response.json({});}}));
      if (replacement==='different account') f.selectB(); else f.replaceA();
      snapshots.release([{sessions:[{title:'synthetic A draft'}]}]);
      await assert.rejects(work,changed);
      assert.equal(saves,0);
    } finally {await f.close();}
  });

  test(`queued second edit cannot dispatch after ${replacement}`,async()=>{
    const f=await fixture();const first=deferred();const sends=[];const applied=[];
    try {
      f.selectA();const context=f.transport.captureServerOperationContext(A);
      const queue=f.queue.createSerializedSaveQueue({
        save:async entry=>{
          f.transport.assertServerOperationContext(entry.operationContext);
          sends.push(entry.sessions);
          return sends.length===1?first.promise:{revision:2};
        },
        onOptimistic:()=>{},
        onAuthoritative:(_result,_queued,entry)=>{
          try {f.transport.assertServerOperationContext(entry.operationContext);applied.push(entry.sessions);}
          catch { /* The originating account changed. */ }
        },
        onError:()=>{},
      });
      queue.enqueue({sessions:['first A edit'],operationContext:context});
      queue.enqueue({sessions:['second A edit'],operationContext:context});
      if (replacement==='different account') f.selectB(); else f.replaceA();
      first.release({revision:1});
      await new Promise(resolve=>setImmediate(resolve));
      assert.deepEqual(sends,[['first A edit']]);
      assert.deepEqual(applied,[],'late first completion cannot update the new timetable');
    } finally {await f.close();}
  });
}

test('captured context cannot use another account CSRF after preflight, or a replacement version',async()=>{
  const f=await fixture();const calls=[];
  const fetchImpl=(url,init)=>{calls.push({url,init});return Response.json({ok:true});};
  try {
    f.selectA();const context=f.transport.captureServerOperationContext(A);
    const preflight=deferred();
    const checking=f.transport.serverSessionStatus(()=>preflight.promise,
      {operationContext:context});
    preflight.release(Response.json({authenticated:true,userId:A,
      sessionName:SESSION_A,csrfToken:CSRF_A}));
    assert.equal((await checking).userId,A);
    f.selectB();
    await assert.rejects(f.transport.serverAuthFetch('/api/notifications/register',
      {method:'POST',body:'{}'},{fetchImpl,operationContext:context}),changed);
    assert.equal(calls.length,0,'B CSRF and B expected-session cannot carry A input');
    f.selectA();const sameAccount=f.transport.captureServerOperationContext(A);
    f.replaceA();
    await assert.rejects(f.transport.serverAuthFetch('/api/academic-year',
      {method:'PUT',body:'{}'},{fetchImpl,operationContext:sameAccount}),changed);
    assert.equal(calls.length,0,'same-account session replacement is not retried');
  } finally {await f.close();}
});

test('morning preference save rejects change before or during status and sends no write',async()=>{
  const f=await fixture();const status=deferred();const calls=[];
  const value={enabled:true,deliveryTime:'07:30',revision:0,academicYearId:YEAR};
  try {
    f.selectA();const api=f.summary.createMorningSummaryApi({fetchImpl:(url,init)=>{
      calls.push({url,init});return status.promise;}});
    const pending=api.save(A,value);
    assert.equal(calls.length,1);
    f.selectB();
    status.release(Response.json({authenticated:true,userId:A,sessionName:SESSION_A,csrfToken:CSRF_A}));
    await assert.rejects(pending,changed);
    assert.equal(calls.length,1);
    await assert.rejects(api.save(A,value),changed);
    assert.equal(calls.length,1,'a stale account is rejected before status preflight');
  } finally {await f.close();}
});

test('same-account session replacement during a deferred preference preflight sends no write',async()=>{
  const f=await fixture();const status=deferred();const calls=[];
  try {
    f.selectA();const api=f.summary.createMorningSummaryApi({fetchImpl:(url,init)=>{
      calls.push({url,init});return status.promise;}});
    const pending=api.save(A,{enabled:true,deliveryTime:'07:30',revision:0,academicYearId:YEAR});
    assert.equal(calls.length,1);
    f.replaceA();
    status.release(Response.json({authenticated:true,userId:A,sessionName:SESSION_A,csrfToken:CSRF_A}));
    await assert.rejects(pending,changed);
    assert.equal(calls.length,1,'the old version cannot write under its replacement');
  } finally {await f.close();}
});

test('device-lock wait cannot let an old account remove a newer subscription',async()=>{
  const f=await fixture();const lock=deferred();const requests=[];let entered=false;
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',
    toJSON:()=>({keys:{auth:'a',p256dh:'p'}}),unsubscribe:()=>assert.fail('No unsubscribe')};
  const browser={navigator:{locks:{request:async(_name,_options,task)=>{
    entered=true;await lock.promise;return task({});}},serviceWorker:{getRegistration:async()=>({
    pushManager:{getSubscription:async()=>subscription}})}}};
  try {
    f.selectA();const pending=f.push.disableCurrentDevice({browser,expectedUserId:A,
      request:async path=>{requests.push(path);return {state:'current',version:'synthetic'};}});
    assert.equal(entered,true);
    f.selectB();lock.release();
    await assert.rejects(pending,changed);
    assert.deepEqual(requests,[]);
  } finally {await f.close();}
});

test('account deletion rejects a changed session after deferred initial verification without a request',async()=>{
  const f=await fixture();const status=deferred();let writes=0;
  try {
    f.selectA();const controller=f.deletion.createAccountDeletionController({
      getSession:()=>status.promise,requestDeletion:()=>{writes+=1;},
      initialVerificationDeadlineMs:1000,
    });
    const pending=controller.submit('synthetic-password');
    f.selectB();
    status.release({serverManaged:true,userId:A,sessionName:SESSION_A,generation:0});
    await assert.rejects(pending,changed);
    assert.equal(writes,0);
    controller.dispose();
  } finally {await f.close();}
});
