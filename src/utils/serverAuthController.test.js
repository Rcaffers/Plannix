import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const account = (id, sessionName) => ({ authenticated:true, userId:id, sessionName });
const ownerA='dd000000-0000-4000-8000-000000000001';
const ownerB='dd000000-0000-4000-8000-000000000002';
const sessionA='__Host-plannix-s-7';
const sessionB='__Host-plannix-s-8';

test('a delayed old logout cannot clear a newer account from the browser adapter',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'plannix-stage4-controller-'));
  const source=await readFile(new URL('./serverAuthController.js',import.meta.url),'utf8');
  await writeFile(path.join(directory,'controller.mjs'),source.replace(
    "'./serverAuthTransport.js'","'./transport.mjs'").replace(
    "import { authTestOperationId, observeAuthTestOperation } from './serverAuthTestObserver.js';",
    'const authTestOperationId = () => null; const observeAuthTestOperation = () => {};'));
  await writeFile(path.join(directory,'transport.mjs'),`
    let status={authenticated:true,userId:'${ownerA}',sessionName:'${sessionA}'};
    let release;
    let releaseProfile;
    let statusFailure=false;
    let notifications=0;
    export const serverManagedAuth=true;
    export const setServerSessionContext=()=>{};
    export const assertServerOperationContext=()=>{};
    export const captureServerOperationContext=()=>Object.freeze({sessionName:status.sessionName,userId:status.userId});
    export const invalidateServerSessionContext=()=>0;
    export const bootstrapServerSession=async()=>({});
    export const serverSessionGeneration=()=>0;
    export const notifyServerSessionChange=()=>{notifications+=1;};
    export const notificationCount=()=>notifications;
    export const serverSessionStatus=async()=>{
      if(statusFailure)throw Object.assign(Error('Synthetic outage'),{status:503});
      return status;
    };
    export const serverAuthFetch=async()=>({ok:true,status:204});
    export const serverAuthJson=async(path)=>path.endsWith('/me')
      ? {user:{id:status.userId,organisationId:'dd000000-0000-4000-8000-000000000003',
          name:'Teacher',email:'teacher@example.test',firstName:'Test',lastName:'Teacher',initials:'TT'}}
      : path.endsWith('/logout') ? new Promise(resolve=>{release=resolve;})
        : path.endsWith('/profile/name') ? new Promise(resolve=>{releaseProfile=resolve;}) : {};
    export const switchAccount=()=>{status={authenticated:true,userId:'${ownerB}',sessionName:'${sessionB}'};};
    export const setSignedOut=()=>{status={authenticated:false};};
    export const setStatusFailure=value=>{statusFailure=value;};
    export const releaseLogout=()=>release?.({});
    export const releaseName=()=>releaseProfile?.({user:{id:'${ownerA}',name:'Old update',
      firstName:'Old',lastName:'Update',initials:'OU'}});
  `);
  const originalAdd=globalThis.addEventListener;
  const originalRemove=globalThis.removeEventListener;
  const listeners=new Map();
  globalThis.addEventListener=(name,callback)=>listeners.set(name,callback);
  globalThis.removeEventListener=name=>listeners.delete(name);
  try {
    const {createServerAuthController}=await import(`file://${directory}/controller.mjs`);
    const transport=await import(`file://${directory}/transport.mjs`);
    const controller=createServerAuthController();
    assert.equal((await controller.restoreSession()).user.id,ownerA);
    assert.equal(controller.isCurrentUser({id:ownerA}),true);
    const oldProfile=controller.updateProfileName({firstName:'Old',lastName:'Update'});
    const pending=controller.logout({expectedUserId:ownerA});
    await new Promise(resolve=>setImmediate(resolve));
    transport.switchAccount();
    assert.equal((await controller.restoreSession()).user.id,ownerB);
    assert.equal(controller.isCurrentUser({id:ownerA}),false);
    assert.equal(controller.isCurrentUser({id:ownerB}),true);
    transport.releaseName();
    await assert.rejects(oldProfile,error=>error.name==='AbortError');
    transport.releaseLogout();
    assert.equal(await pending,false);
    assert.equal(transport.notificationCount(),1,'a different authoritative session triggers reconciliation');
    assert.equal((await controller.restoreSession()).user.id,ownerB);
    assert.deepEqual(await controller.getCurrentSession(),
      {serverManaged:true,sessionName:sessionB,userId:ownerB,generation:0});
    let signedOut=0;let errors=0;
    const unsubscribe=controller.subscribe({onSignedOut:()=>{signedOut+=1;},
      onError:()=>{errors+=1;}});
    transport.setStatusFailure(true);
    listeners.get('focus')(new Event('focus'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(signedOut,0);
    assert.equal(errors,0,'a transient focus-time outage leaves the existing editor mounted');
    unsubscribe();
    assert.equal((await controller.restoreSession()).state,'verification-failure');
    transport.setStatusFailure(false);
    transport.setSignedOut();
    assert.equal((await controller.restoreSession()).state,'signed-out');
  } finally {
    globalThis.addEventListener=originalAdd;
    globalThis.removeEventListener=originalRemove;
    await rm(directory,{recursive:true,force:true});
  }
});

test('stale restore and subscription results never announce sign-out after login',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'plannix-stage4-read-order-'));
  const source=await readFile(new URL('./serverAuthController.js',import.meta.url),'utf8');
  await writeFile(path.join(directory,'controller.mjs'),source.replace(
    "'./serverAuthTransport.js'","'./transport.mjs'").replace(
    "import { authTestOperationId, observeAuthTestOperation } from './serverAuthTestObserver.js';",
    'let observerSerial = 0; const authTestOperationId = () => `operation-${++observerSerial}`;'
    + ' const observeAuthTestOperation = event => globalThis.__stage4SubscriberEvents?.push(event);'));
  await writeFile(path.join(directory,'transport.mjs'),`
    const waiting=[]; let listener;
    export const serverManagedAuth=true;
    export const setServerSessionContext=()=>{};
    export const assertServerOperationContext=()=>{};
    export const captureServerOperationContext=()=>Object.freeze({sessionName:'${sessionA}',userId:'${ownerA}'});
    export const invalidateServerSessionContext=()=>0;
    export const bootstrapServerSession=async()=>({});
    export const serverSessionGeneration=()=>0;
    export const notifyServerSessionChange=({reconcileThisTab=true}={})=>{
      if(reconcileThisTab)listener?.();
    };
    export const onChange=fn=>{listener=fn;};
    export const deferStatus=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});
      waiting.push(promise);return resolve;};
    export const serverSessionStatus=async()=>waiting.length?waiting.shift():
      {authenticated:true,userId:'${ownerA}',sessionName:'${sessionA}'};
    export const serverAuthFetch=async()=>({ok:true,status:204});
    export const serverAuthJson=async path=>path.endsWith('/me')
      ? {user:{id:'${ownerA}',organisationId:'dd000000-0000-4000-8000-000000000003',
        name:'Teacher',email:'teacher@example.test',firstName:'Test',lastName:'Teacher',initials:'TT'}}
      : {};
  `);
  const originalAdd=globalThis.addEventListener;
  const originalRemove=globalThis.removeEventListener;
  const previousEvents=globalThis.__stage4SubscriberEvents;
  const observedEvents=[];
  globalThis.__stage4SubscriberEvents=observedEvents;
  const listeners=new Map();
  globalThis.addEventListener=(name,callback)=>listeners.set(name,callback);
  globalThis.removeEventListener=name=>listeners.delete(name);
  try {
    const {createServerAuthController}=await import(`file://${directory}/controller.mjs`);
    const transport=await import(`file://${directory}/transport.mjs`);
    const controller=createServerAuthController();
    let signedOut=0; let authenticatedCount=0; let pendingCount=0;
    controller.subscribe({onPending:()=>{pendingCount++;},onUser:()=>{authenticatedCount++;
      observedEvents.push({kind:'subscriber-callback',outcome:'authenticated'});},
      onSignedOut:()=>{signedOut++;
        observedEvents.push({kind:'subscriber-callback',outcome:'signed-out'});}});
    transport.onChange(()=>listeners.get('plannix-server-session-change')?.());
    const releaseInitial=transport.deferStatus();
    const initial=controller.restoreSession();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await controller.login({email:'synthetic@example.test',password:'synthetic'})).id,ownerA);
    assert.equal(pendingCount,0,'validated same-tab login does not suspend its own planner');
    releaseInitial({authenticated:false});
    assert.equal((await initial).state,'stale');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(signedOut,0);
    const releaseOldFocus=transport.deferStatus();
    listeners.get('focus')(new Event('focus'));
    await new Promise(resolve=>setImmediate(resolve));
    listeners.get('plannix-server-session-change')();
    await new Promise(resolve=>setImmediate(resolve));
    releaseOldFocus({authenticated:false});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(signedOut,0);
    assert.ok(authenticatedCount>=1,
      'explicit reconciliation remains available without a login-triggered local restore');
    const subscriberTerminals=observedEvents.filter(event=>event.kind==='subscription-terminal');
    assert.ok(subscriberTerminals.some(event=>event.outcome==='ignored'));
    for (const terminal of subscriberTerminals) {
      const readIndex=observedEvents.findIndex(event=>event.kind==='session-read-terminal'
        && event.id===terminal.id);
      const terminalIndex=observedEvents.indexOf(terminal);
      assert.ok(readIndex>=0 && readIndex<terminalIndex,
        'session-read completion precedes this subscription decision');
      if (terminal.outcome==='authenticated') assert.equal(
        observedEvents[terminalIndex-1]?.kind,'subscriber-callback',
        'subscriber terminal follows its onUser callback');
    }
  } finally {
    globalThis.addEventListener=originalAdd;
    globalThis.removeEventListener=originalRemove;
    globalThis.__stage4SubscriberEvents=previousEvents;
    await rm(directory,{recursive:true,force:true});
  }
});
