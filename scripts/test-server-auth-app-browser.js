// Stage 4 synthetic browser integration. No Supabase or push transport is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import { createServerSessionTestApp } from '../server/auth/serverSessionTestApp.js';
import { createRequireServerSession } from '../server/auth/requireServerSession.js';
import { registerServerAuthMembershipRoutes } from '../server/routes/server-auth-membership-routes.js';
import { registerAcademicYearRoutes } from '../server/routes/academic-year-routes.js';

const owner='dd000000-0000-4000-8000-000000000001';
const otherOwner='dd000000-0000-4000-8000-000000000002';
const organisation='dd000000-0000-4000-8000-000000000003';
const marker=`__Host-plannix-b-1=${'a'.repeat(43)}`;
const work=await mkdtemp(path.join(tmpdir(),'plannix-stage4-browser-'));
let server; let chrome; let socket;let testFailure;
let holdOldRead=false;let oldReadHeld=false;let releaseOldRead;let oldReadOperationId;
let heldProfileStatuses=[];let holdProfileStatuses=0;let holdStatusPurpose='profile-entry';
let profileHoldSerial=0;
let failProfileStatus=false;let profileFailures=0;
let deletions=0;
let profileUpdates=0;
try {
  const probe=createServer().listen(0,'localhost');
  await new Promise(resolve=>probe.once('listening',resolve));
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const origin=`http://localhost:${port}`;
  const build=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','build',
      '--mode','stage4-app-browser-test',
      '--outDir',path.join(work,'dist'),'--emptyOutDir'],{
      cwd:process.cwd(),env:{...process.env,VITE_PLANNIX_AUTH_MODE:'server',
        VITE_API_BASE_URL:origin},stdio:['ignore','ignore','pipe']});
    child.stderr.resume();
    child.once('error',reject);
    child.once('exit',code=>code===0?resolve(true):reject(Error('Synthetic browser build failed.')));
  });
  assert.equal(build,true);
  const htmlPath=path.join(work,'dist','index.html');
  const html=await readFile(htmlPath,'utf8');
  const observer=`<script>window.__authTestOperations=[];
    window.__plannixAuthTestObserver=event=>window.__authTestOperations.push(event);</script>`;
  await writeFile(htmlPath,html.replace('<script type="module"',observer+'<script type="module"'));
  let current=null;let latest=null;let sessionGeneration=1;
  const repository={
    async issueBinding(){return {state:'issued',setCookie:`${marker}; Path=/; Secure; HttpOnly; SameSite=Lax`};},
    async resolve(header){
      if(!header)return {state:'missing'};
      if(!header.includes(marker))return {state:'invalid'};
      const selected=current&&header.includes(current.cookie)?current.cookie:null;
      return {state:'selected',header:[marker,selected].filter(Boolean).join('; '),
        markerName:'__Host-plannix-b-1',sessionName:selected?.split('=')[0]||null,cleanup:[]};
    },
    async begin(){latest=randomUUID();return {state:'started',intentId:latest};},
    async settle(intent,outcome,details){
      if(intent!==latest)return {state:'superseded'};
      if(outcome!=='created')return {state:outcome};
      sessionGeneration+=1;
      current={cookie:`__Host-plannix-s-${sessionGeneration}=${String(sessionGeneration).repeat(43).slice(0,43)}`,
        ownerId:details.confirmedOwnerId,
        accessToken:details.accessToken};
      return {state:'created',setCookie:`${current.cookie}; Path=/; Secure; HttpOnly; SameSite=Lax`};
    },
    async readTokens(header,kind){return kind==='ordinary'&&current&&header.includes(current.cookie)
        ? {state:'current',ownerId:current.ownerId,accessToken:current.accessToken,
          tokenVersion:1}:{state:'absent'};},
    async resolveForApplication(header){const selected=await this.resolve(header);
      if(selected.state!=='selected'||!selected.sessionName)return selected;
      const tokens=await this.readTokens(selected.header,'ordinary');
      return tokens.state==='current'?{...selected,...tokens}:tokens;},
    async inspect(header,kind){const found=await this.readTokens(header,kind);
      return found.state==='current'?{state:'current',ownerId:owner,tokenVersion:1}:found;},
    async logout(header){if(!current||!header.includes(current.cookie))return {state:'absent'};
      const cleanup=current.cookie.split('=')[0];current=null;return {state:'revoked',cleanup};},
  };
  const identity={
    async login({email}){const id=email.startsWith('other')?otherOwner:owner;
      return {user:{id},session:{access_token:`synthetic-access-${id}`,
        refresh_token:`synthetic-refresh-${id}`}};},
    async validateAccess({expectedUserId}){return {userId:expectedUserId,
      email:'synthetic@example.test'};},
    async loadCurrentUser({expectedUserId}){return {id:expectedUserId,
      name:expectedUserId===owner?'Synthetic Teacher':'Other Teacher',
      email:'synthetic@example.test',firstName:'Synthetic',lastName:'Teacher',
      initials:'ST',organisationId:organisation};},
    async deleteAccount(){deletions+=1;holdStatusPurpose='deletion-reconcile';
      holdProfileStatuses+=1;},
    async updateProfileName({expectedUserId,firstName,lastName}){
      profileUpdates+=1;
      return {id:expectedUserId,name:`${firstName} ${lastName}`,firstName,lastName,
        initials:`${firstName[0]}${lastName[0]}`};
    },
  };
  const boundary={repository,identity,origin,csrfKey:Buffer.alloc(32,8),requireLogoutVersion:true,
    beforeAuth(req,res,next){
      if(req.path==='/status'&&holdOldRead){
        holdOldRead=false;oldReadHeld=true;
        oldReadOperationId=req.get('X-Plannix-Test-Operation');
        releaseOldRead=()=>res.json({authenticated:false,csrfToken:'a'.repeat(43)});
        return;
      }
      if(req.path==='/status'&&req.get('X-Plannix-Verification')==='profile-entry'
        &&failProfileStatus){
        failProfileStatus=false;profileFailures+=1;
        res.status(503).json({message:'Synthetic status outage.'});return;
      }
      if(req.path==='/status'&&req.get('X-Plannix-Verification')===holdStatusPurpose
        &&holdProfileStatuses>0){
        holdProfileStatuses-=1;heldProfileStatuses.push({id:++profileHoldSerial,
          purpose:req.get('X-Plannix-Verification'),
          operationId:req.get('X-Plannix-Test-Operation'),release:next,
          fail:()=>res.status(503).json({message:'Synthetic status outage.'})});return;
      }
      next();
    }};
  const app=createServerSessionTestApp(boundary);
  app.use(express.json({limit:'8kb'}));
  const guard=createRequireServerSession(boundary);
  const requireAuth=(req,res,next)=>guard(req,res,()=>{
    req.auth={userId:req.serverSession.userId,accessToken:req.serverSession.accessToken};next();
  });
  const observed=[];
  const mutations=[];
  const createRequestClient=auth=>({from(table){
    const query={select(){return query;},eq(){return query;},in(){return query;},
      order(){return query;},then(resolve,reject){
        observed.push({table,userId:auth.userId,token:auth.accessToken});
        return Promise.resolve({data:[],error:null}).then(resolve,reject);
      }};
    return query;
  },rpc(name,args){mutations.push({name,userId:auth.userId,args});
    return Promise.resolve({data:organisation,error:null});}});
  registerServerAuthMembershipRoutes({app,requireAuth,createRequestClient});
  registerAcademicYearRoutes({app,requireAuth,createRequestClient});
  app.use(express.static(path.join(work,'dist')));
  app.get(/.*/,(req,res)=>res.sendFile(path.join(work,'dist','index.html')));
  server=createServer(app);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'localhost',resolve);});
  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless','--disable-background-networking','--disable-component-update',
      '--no-first-run','--disable-gpu','--remote-debugging-port=0',
      `--user-data-dir=${path.join(work,'chrome')}`,origin],
    {stdio:['ignore','ignore','pipe']});
  const wsUrl=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Chrome startup timeout')),15000);
    chrome.once('error',reject);
    chrome.stderr.on('data',chunk=>{const found=String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if(found){clearTimeout(timer);resolve(found[1]);}});
  });
  socket=new WebSocket(wsUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let serial=0;const pending=new Map();
  socket.onmessage=event=>{const message=JSON.parse(event.data);const call=pending.get(message.id);
    if(!call)return;clearTimeout(call.timer);pending.delete(message.id);
    message.error?call.reject(Error(message.error.message)):call.resolve(message.result);};
  const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timeout`));},12000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,
      ...(sessionId?{sessionId}:{})}));});
  const {targetInfos}=await cdp('Target.getTargets');
  const target=targetInfos.find(item=>item.type==='page'&&item.url.startsWith(origin));
  assert.ok(target);
  const {sessionId:tab}=await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const evaluate=async(expression,sessionId=tab)=>{const result=await cdp('Runtime.evaluate',
    {expression,awaitPromise:true,returnByValue:true},sessionId);
    if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
  const waitFor=async expression=>{const until=Date.now()+10000;
    for(;;){if(await evaluate(expression))return;
      if(Date.now()>until)throw Error('Synthetic browser state timeout');
      await new Promise(resolve=>setTimeout(resolve,50));}};
  const waitForHeldProfileStatus=async(count,purpose)=>{
    const until=Date.now()+5000;
    while(heldProfileStatuses.length<count){
      if(Date.now()>until)throw Error(`Tagged ${purpose} request did not reach server hold ${count}`);
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    const held=heldProfileStatuses[count-1];
    assert.equal(held.purpose,purpose,'the intended verification request reached the hold');
    assert.ok(held.id,'the held request has a unique server identifier');
    assert.match(held.operationId,/^[0-9a-f-]{36}$/i,
      'the held request carries its client handler operation ID');
    return held;
  };
  const awaitFinalDecision=async(held,kind)=>{
    await waitFor(`window.__authTestOperations.some(event=>event.kind==='status-terminal'
      &&event.id===${JSON.stringify(held.operationId)})`);
    await waitFor(`window.__authTestOperations.some(event=>event.kind===${JSON.stringify(kind)}
      &&event.id===${JSON.stringify(held.operationId)})`);
  };
  await waitFor("Boolean(document.querySelector('.nav-login') && !document.querySelector('.nav-login').disabled)");
  await evaluate("document.querySelector('.nav-login').click()");
  await waitFor("Boolean(document.querySelector('#login-email'))");
  holdOldRead=true;
  await evaluate("window.dispatchEvent(new Event('focus'))");
  const oldReadDeadline=Date.now()+5000;
  while(!oldReadHeld&&Date.now()<oldReadDeadline)
    await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(oldReadHeld,true,'a signed-out status read is held before login');
  await evaluate(`(() => {
    for(const [id,value] of [['login-email','synthetic@example.test'],
      ['login-password','synthetic-password']]) {
      const input=document.getElementById(id);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    document.querySelector('.login-form .login-submit').click();
  })()`);
  await waitFor("location.pathname==='/timetable'");
  await waitFor("document.body.textContent.includes('Synthetic Teacher')");
  const releaseDelayedStatus=releaseOldRead;
  releaseOldRead=null;
  releaseDelayedStatus();
  assert.match(oldReadOperationId,/^[0-9a-f-]{36}$/i);
  await waitFor(`window.__authTestOperations.some(event=>
    event.kind==='subscription-terminal'&&event.id===${JSON.stringify(oldReadOperationId)}
    &&event.outcome==='ignored')`);
  assert.equal(await evaluate("location.pathname==='/timetable' && document.body.textContent.includes('Synthetic Teacher')"),true,
    'the delayed signed-out response cannot dismount the protected timetable');
  const membershipDeadline=Date.now()+5000;
  while(!observed.some(item=>item.path==='/api/memberships')
    && Date.now()<membershipDeadline) await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(observed.some(item=>item.table==='plannix_organisation_users'
    && item.userId===owner && item.token===`synthetic-access-${owner}`));
  const guarded=await evaluate(`(async()=>{
    const session=await fetch('/__stage3/auth/status').then(r=>r.json());
    const response=await fetch('/api/academic-years?organisationId=${organisation}',
      {headers:{'X-Plannix-Expected-Session':session.sessionName}});
    return {status:response.status,body:await response.json()};
  })()`);
  assert.equal(guarded.status,200);
  assert.deepEqual(guarded.body.academicYears,[]);
  assert.ok(observed.some(item=>item.table==='plannix_academic_years'&&item.userId===owner));
  assert.equal(await evaluate("fetch('/api/memberships',{credentials:'omit'}).then(r=>r.status)"),401);
  assert.equal(await evaluate(`fetch('/api/academic-years?organisationId=${organisation}',
    {credentials:'omit'}).then(r=>r.status)`),401);
  const storage=await evaluate('Object.keys(localStorage)');
  assert.ok(storage.every(name=>!name.includes('supabase')&&!name.includes('auth-token')));
  assert.equal(await evaluate('document.cookie'),'');
  await evaluate('location.reload()');
  await waitFor("document.body.textContent.includes('Synthetic Teacher')");
  const {targetId:secondTarget}=await cdp('Target.createTarget',{url:origin});
  const {sessionId:secondTab}=await cdp('Target.attachToTarget',
    {targetId:secondTarget,flatten:true});
  const secondDeadline=Date.now()+10000;
  while(!(await evaluate('Boolean(document.querySelector(".page-shell"))',secondTab))) {
    if(Date.now()>secondDeadline)throw Error('Second synthetic tab timeout');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  const switched=await evaluate(`(async()=>{
    const status=await fetch('/__stage3/auth/status').then(r=>r.json());
    const result=await fetch('/__stage3/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json','X-Plannix-CSRF':status.csrfToken},
      body:JSON.stringify({email:'other@example.test',password:'synthetic-password'})});
    return result.status;
  })()`,secondTab);
  assert.equal(switched,200);
  await cdp('Target.activateTarget',{targetId:target.targetId});
  await waitFor("document.body.textContent.includes('Other Teacher')");
  const switchedMembershipDeadline=Date.now()+5000;
  while(!observed.some(item=>item.table==='plannix_organisation_users'
    && item.userId===otherOwner) && Date.now()<switchedMembershipDeadline)
    await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(observed.some(item=>item.table==='plannix_organisation_users'
    && item.userId===otherOwner && item.token===`synthetic-access-${otherOwner}`));
  const visit=path=>evaluate(`(() => {history.pushState(null,'',${JSON.stringify(path)});
    dispatchEvent(new PopStateEvent('popstate'));return true;})()`);
  holdStatusPurpose='profile-entry';holdProfileStatuses=1;
  await visit('/profile');
  await waitFor("document.body.textContent.includes('Checking your current session')");
  await waitForHeldProfileStatus(1,'profile-entry');
  assert.equal(await evaluate("Boolean(document.querySelector('#personal-details-title'))"),false,
    'profile details stay hidden during initial verification');
  assert.equal(await evaluate("document.body.textContent.includes('Other Teacher')"),false,
    'the old account is not presented as confirmed during verification');
  heldProfileStatuses.shift().release();
  await waitFor("Boolean(document.querySelector('#personal-details-title'))");

  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Delete account').click()");
  await waitFor("Boolean(document.querySelector('#delete-account-password'))");
  await evaluate(`(() => {const input=document.querySelector('#delete-account-password');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'synthetic-password');
    input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor("![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Permanently delete account').disabled");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Permanently delete account').click()");
  const deletionDeadline=Date.now()+5000;
  while((deletions!==1||heldProfileStatuses.length!==1)&&Date.now()<deletionDeadline)
    await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(deletions,1,'one deletion was accepted before its status check');
  await waitForHeldProfileStatus(1,'deletion-reconcile');
  await visit('/settings');
  await waitFor("location.pathname==='/settings'");
  holdStatusPurpose='profile-entry';holdProfileStatuses=1;
  await visit('/profile');
  await waitFor("document.body.textContent.includes('Checking your current session')");
  await waitForHeldProfileStatus(2,'profile-entry');
  const disposedDeletionHold=heldProfileStatuses.shift();disposedDeletionHold.release();
  await awaitFinalDecision(disposedDeletionHold,'deletion-reconcile-terminal');
  assert.equal(await evaluate("location.pathname==='/profile' && document.body.textContent.includes('Checking your current session')"),true,
    'old disposed status cannot redirect or update remounted UI');
  heldProfileStatuses.shift().release();
  await waitFor("Boolean(document.querySelector('.nav-login') && !document.querySelector('.nav-login').disabled)");
  assert.equal(deletions,1,'remount never repeats deletion');

  // A failed entry check is unknown. Retry only reads status and never resends deletion.
  await evaluate("document.querySelector('.nav-login').click()");
  await waitFor("Boolean(document.querySelector('#login-email'))");
  await evaluate(`(() => {for(const [id,value] of [['login-email','other@example.test'],
    ['login-password','synthetic-password']]) {const input=document.getElementById(id);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));}
    document.querySelector('.login-form .login-submit').click();})()`);
  await waitFor("location.pathname==='/timetable'");
  failProfileStatus=true;
  await visit('/profile');
  await waitFor("document.body.textContent.includes('Retry session check')");
  assert.equal(profileFailures,1,'only the tagged Profile verification receives the outage');
  assert.equal(await evaluate("Boolean(document.querySelector('#personal-details-title'))"),false);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retry session check').click()");
  await waitFor("Boolean(document.querySelector('#personal-details-title'))");
  assert.equal(deletions,1,'entry Retry is status-only');

  holdStatusPurpose='profile-entry';holdProfileStatuses=1;
  await visit('/settings');
  await visit('/profile');
  await waitFor("document.body.textContent.includes('Checking your current session')");
  await waitForHeldProfileStatus(1,'profile-entry');
  await waitFor("document.body.textContent.includes('Your current session could not be confirmed')");
  assert.equal(await evaluate("Boolean(document.querySelector('#personal-details-title'))"),false,
    'timeout cannot present the old account as confirmed');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retry session check').click()");
  await waitFor("Boolean(document.querySelector('#personal-details-title'))");
  const timedOutHold=heldProfileStatuses.shift();timedOutHold.release();
  await awaitFinalDecision(timedOutHold,'profile-gate-terminal');
  assert.equal(await evaluate("Boolean(document.querySelector('#personal-details-title'))"),true,
    'late timed-out status cannot replace successful Retry');
  assert.equal(deletions,1);

  holdStatusPurpose='profile-entry';holdProfileStatuses=1;
  await visit('/settings');
  await visit('/profile');
  await waitFor("document.body.textContent.includes('Checking your current session')");
  await waitForHeldProfileStatus(1,'profile-entry');
  await visit('/settings');
  // Simulate an abort-ignoring status dependency completing after unmount.
  await waitFor("location.pathname==='/settings'");
  assert.equal(await evaluate("location.pathname==='/settings'"),true,
    'an unresolved initial verification cannot hold route navigation');
  const unmountedHold=heldProfileStatuses.shift();unmountedHold.release();
  await awaitFinalDecision(unmountedHold,'profile-gate-terminal');
  assert.equal(await evaluate("location.pathname==='/settings'"),true);
  assert.equal(deletions,1);

  holdStatusPurpose='profile-entry';holdProfileStatuses=1;
  await visit('/profile');
  await waitFor("document.body.textContent.includes('Checking your current session')");
  await waitForHeldProfileStatus(1,'profile-entry');
  await visit('/settings');
  const failedUnmountedHold=heldProfileStatuses.shift();failedUnmountedHold.fail();
  await awaitFinalDecision(failedUnmountedHold,'profile-gate-terminal');
  assert.equal(await evaluate("location.pathname==='/settings' && document.body.textContent.includes('Other Teacher')"),true,
    'late failed verification after unmount preserves the current account and route');

  holdStatusPurpose='profile-entry';holdProfileStatuses=1;
  await visit('/profile');
  await waitFor("document.body.textContent.includes('Checking your current session')");
  await waitForHeldProfileStatus(1,'profile-entry');
  const newerLogin=await evaluate(`(async()=>{
    const status=await fetch('/__stage3/auth/status').then(r=>r.json());
    return (await fetch('/__stage3/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json','X-Plannix-CSRF':status.csrfToken},
      body:JSON.stringify({email:'synthetic@example.test',password:'synthetic-password'})})).status;
  })()`,secondTab);
  assert.equal(newerLogin,200);
  const newerStatus=await evaluate("fetch('/__stage3/auth/status').then(r=>r.json())");
  assert.equal(newerStatus.userId,owner,'the newer account is authoritative in shared cookies');
  await cdp('Target.activateTarget',{targetId:target.targetId});
  await evaluate("dispatchEvent(new Event('focus'))");
  const previousAccountHold=heldProfileStatuses.shift();previousAccountHold.release();
  await awaitFinalDecision(previousAccountHold,'profile-gate-terminal');
  await waitFor("Boolean(document.querySelector('#personal-details-title')) && !document.body.textContent.includes('Other Teacher')");
  assert.equal(await evaluate("Boolean(document.querySelector('#personal-details-title')) && !document.body.textContent.includes('Other Teacher')"),true,
    'old verification cannot clear a newer account');
  assert.equal(deletions,1);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit name').click()");
  await waitFor("Boolean(document.querySelector('.profile-form input'))");
  await evaluate(`(() => {const input=document.querySelector('.profile-form input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Old-account-draft');
    input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const oldSessionName=await evaluate("fetch('/__stage3/auth/status').then(r=>r.json()).then(s=>s.sessionName)");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Delete account').click()");
  await waitFor("Boolean(document.querySelector('#delete-account-password'))");
  await evaluate(`(() => {const input=document.querySelector('#delete-account-password');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'synthetic-password');
    input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor("![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Permanently delete account').disabled");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Permanently delete account').click()");
  const secondDeletionDeadline=Date.now()+5000;
  while((deletions!==2||heldProfileStatuses.length!==1)&&Date.now()<secondDeletionDeadline)
    await new Promise(resolve=>setTimeout(resolve,25));
  await waitForHeldProfileStatus(1,'deletion-reconcile');
  const loginAfterDeletion=await evaluate(`(async()=>{
    const status=await fetch('/__stage3/auth/status').then(r=>r.json());
    return (await fetch('/__stage3/auth/login',{method:'POST',
      headers:{'Content-Type':'application/json','X-Plannix-CSRF':status.csrfToken},
      body:JSON.stringify({email:'other@example.test',password:'synthetic-password'})})).status;
  })()`,secondTab);
  assert.equal(loginAfterDeletion,200);
  const laterDeletionHold=heldProfileStatuses.shift();laterDeletionHold.release();
  await awaitFinalDecision(laterDeletionHold,'deletion-reconcile-terminal');
  await waitFor("Boolean(document.querySelector('#personal-details-title')) && document.body.textContent.includes('Other Teacher')");
  assert.equal(await evaluate("document.body.textContent.includes('Old-account-draft') || [...document.querySelectorAll('.profile-form input')].some(input=>input.value==='Old-account-draft')"),false,
    'A draft is discarded rather than transferred into B\'s Profile');
  const blockedOldEdit=await evaluate(`(async()=>{
    const status=await fetch('/__stage3/auth/status').then(r=>r.json());
    return (await fetch('/__stage3/auth/profile/name',{method:'PUT',
      headers:{'Content-Type':'application/json','X-Plannix-CSRF':status.csrfToken,
        'X-Plannix-Expected-Session':${JSON.stringify(oldSessionName)}},
      body:JSON.stringify({firstName:'Old',lastName:'Draft'})})).status;
  })()`);
  assert.equal(blockedOldEdit,409,'B CSRF cannot authorize A\'s displayed-session mutation');
  assert.equal(profileUpdates,0,'the mismatched request never reaches the provider mutation');
  const blockedYearWrite=await evaluate(`(async()=>{
    const status=await fetch('/__stage3/auth/status').then(r=>r.json());
    return (await fetch('/api/academic-year',{method:'PUT',
      headers:{'Content-Type':'application/json','X-Plannix-CSRF':status.csrfToken,
        'X-Plannix-Expected-Session':${JSON.stringify(oldSessionName)}},
      body:JSON.stringify({organisationId:${JSON.stringify(organisation)},plan:{
        label:'Synthetic year',startDate:'2026-09-01',endDate:'2027-08-31',holidays:[]}})})).status;
  })()`);
  assert.equal(blockedYearWrite,409,'production academic-year route rejects A context under B cookie');
  assert.equal(mutations.length,0,'the mismatched application request never reaches its RPC');
  console.log('Stage 4 Chrome proof passed: auth, cookie API, Profile reconciliation without focus, deletion disposal, Retry, timeout and account switching.');
} catch(error) { testFailure=error; } finally {
  const cleanupErrors=[];
  const cleanup=async work=>{try{await work();}catch(error){cleanupErrors.push(error);}};
  await cleanup(async()=>{releaseOldRead?.();
    for (const held of heldProfileStatuses) held.release();});
  await cleanup(async()=>socket?.close());
  let chromeStopped=!chrome||chrome.exitCode!==null||chrome.signalCode!==null;
  await cleanup(async()=>{if(chrome&&!chromeStopped){
    const awaitExit=ms=>new Promise(resolve=>{
      const timer=setTimeout(()=>resolve(false),ms);
      chrome.once('exit',()=>{clearTimeout(timer);resolve(true);});
    });
    const graceful=awaitExit(3000);chrome.kill('SIGTERM');chromeStopped=await graceful;
    if(!chromeStopped){const forced=awaitExit(3000);chrome.kill('SIGKILL');chromeStopped=await forced;}
    if(!chromeStopped)throw Error('Synthetic Chrome did not exit before cleanup.');
  }});
  await cleanup(async()=>{if(server){server.closeAllConnections();
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}});
  if(chromeStopped)await cleanup(()=>rm(work,{recursive:true,force:true,maxRetries:12,retryDelay:150}));
  if(cleanupErrors.length){
    if(testFailure)console.error('Cleanup errors after primary assertion:',cleanupErrors);
    else testFailure=new AggregateError(cleanupErrors,'Browser fixture cleanup failed.');
  }
}
if(testFailure)throw testFailure;
