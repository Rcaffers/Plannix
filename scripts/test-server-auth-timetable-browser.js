// Rendered server-mode timetable proof with real ProjectCard, provider, transport and HTTP guards.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import express from 'express';
import { createServerSessionTestApp } from '../server/auth/serverSessionTestApp.js';
import { createRequireServerSession } from '../server/auth/requireServerSession.js';
import { registerTimetableSessionRoutes } from '../server/routes/timetable-session-routes.js';

const A='dd000000-0000-4000-8000-000000000001';
const B='dd000000-0000-4000-8000-000000000002';
const ids={organisation:'dd000000-0000-4000-8000-000000000003',
  year:'dd000000-0000-4000-8000-000000000004',timetable:'dd000000-0000-4000-8000-000000000005',
  week:'dd000000-0000-4000-8000-000000000006',collection:'dd000000-0000-4000-8000-000000000007',
  period:'dd000000-0000-4000-8000-000000000008',class:'dd000000-0000-4000-8000-000000000009',
  lesson:'dd000000-0000-4000-8000-000000000010'};
const marker=`__Host-plannix-b-1=${'a'.repeat(43)}`;
const directory=await mkdtemp(path.join(tmpdir(),'plannix-server-timetable-'));
let server,chrome,socket;
let failure;
const requests=[];const reads=[];const writes=[];const heldReads=[];const heldWrites=[];
const heldRecurring=[];
const heldLoginRestores=[];
const routeErrors=[];
let heldSnapshotDate=null,holdSave=false,failNextSave=false,holdInitialRecurring=false,failNextRecurring=false;
let holdPostLoginBootstrap=false,postLoginBootstrapCount=0,holdFirstMembership=false;
const heldMemberships=[];
const records=new Map([[A,{revision:1,title:'Initial A'}],[B,{revision:1,title:'Initial B'}]]);
const waitForServer=async (predicate,label) => {
  const deadline=Date.now()+10000;
  while(!predicate()) {
    if(Date.now()>deadline)throw Error(`Timed out waiting for ${label}`);
    await new Promise(resolve=>setTimeout(resolve,20));
  }
};
try {
  const probe=createServer().listen(0,'localhost');
  await new Promise(resolve=>probe.once('listening',resolve));
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const origin=`http://localhost:${port}`;
  const oldMode=process.env.VITE_PLANNIX_AUTH_MODE;
  const oldApi=process.env.VITE_API_BASE_URL;
  process.env.VITE_PLANNIX_AUTH_MODE='server';process.env.VITE_API_BASE_URL=origin;
  try {
    await build({configFile:false,mode:'stage4-timetable-browser-test',logLevel:'error',
      build:{outDir:path.join(directory,'dist'),emptyOutDir:true},
      plugins:[react(),{name:'timetable-real-app-observer',enforce:'pre',resolveId(source,importer){
        if (importer?.endsWith('/App.jsx')
          && (source === './pages/Timetable' || source === './context/TimetableSessionContext'))
          return path.resolve('src/components/TimetableServerContext.browser-test.jsx');
        if (source.endsWith('/lib/supabase.js'))
          return path.resolve('src/lib/serverAuthSupabaseStub.js');
        return null;
      }}]});
  } finally {
    if(oldMode===undefined)delete process.env.VITE_PLANNIX_AUTH_MODE;
    else process.env.VITE_PLANNIX_AUTH_MODE=oldMode;
    if(oldApi===undefined)delete process.env.VITE_API_BASE_URL;
    else process.env.VITE_API_BASE_URL=oldApi;
  }


  // The test-mode observer is called from the real operation's terminal handler.
  const htmlPath=path.join(directory,'dist','index.html');
  const html=await readFile(htmlPath,'utf8');
  const observer=`<script>(()=>{
    window.__timetableOperations=[];
    window.__timetableActualCommits=[];
    window.__timetablePendingUpdateIds=new Map();
    window.__timetableAbandonedUpdates=[];
    window.__plannixTimetableOperationObserver=event=>{
      window.__timetableOperations.push(event);
      if(event.kind==='save-update-start'){
        if(event.providerId&&event.observerId)window.__timetablePendingUpdateIds.set(event.id,event);
        else window.__timetableAbandonedUpdates.push({id:event.id,reason:'no-mounted-observer'});
      }
      if(event.kind==='observer-unmount'||event.kind==='provider-unmount'){
        for(const [id,pending] of window.__timetablePendingUpdateIds){
          if(event.kind==='observer-unmount'?pending.observerId===event.observerId
            :pending.providerId===event.providerId){
            window.__timetablePendingUpdateIds.delete(id);
            window.__timetableAbandonedUpdates.push({id,reason:event.kind});
          }
        }
      }
    };
  })();</script>`;
  await writeFile(htmlPath,html.replace('<script type="module"',observer+'<script type="module"'));

  let current=null,latest=null,version=1;
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
      version+=1;current={cookie:`__Host-plannix-s-${version}=${String(version).repeat(43).slice(0,43)}`,
        ownerId:details.confirmedOwnerId,accessToken:details.accessToken};
      return {state:'created',setCookie:`${current.cookie}; Path=/; Secure; HttpOnly; SameSite=Lax`};
    },
    async readTokens(header,kind){return kind==='ordinary'&&current&&header.includes(current.cookie)
      ? {state:'current',ownerId:current.ownerId,accessToken:current.accessToken,tokenVersion:1}
      : {state:'absent'};},
    async resolveForApplication(header){const selected=await this.resolve(header);
      if(selected.state!=='selected'||!selected.sessionName)return selected;
      const tokens=await this.readTokens(selected.header,'ordinary');
      return tokens.state==='current'?{...selected,...tokens}:tokens;},
    async inspect(header,kind){const found=await this.readTokens(header,kind);
      return found.state==='current'?{state:'current',ownerId:current.ownerId,tokenVersion:1}:found;},
    async logout(header){if(!current||!header.includes(current.cookie))return {state:'absent'};
      const cleanup=current.cookie.split('=')[0];current=null;return {state:'revoked',cleanup};},
  };
  const identity={
    async login({email}){const id=email.startsWith('other')?B:A;
      if(email==='synthetic@example.test' && holdFirstMembership) {
        holdPostLoginBootstrap=true;postLoginBootstrapCount=0;
      }
      return {user:{id},session:{access_token:`synthetic-access-${id}`,
        refresh_token:`synthetic-refresh-${id}`}};},
    async validateAccess({expectedUserId}){return {userId:expectedUserId,email:'synthetic@example.test'};},
    async loadCurrentUser({expectedUserId}){return {id:expectedUserId,
      name:expectedUserId===A?'Synthetic Teacher':'Other Teacher',
      email:'synthetic@example.test',firstName:'Synthetic',lastName:'Teacher',
      initials:'ST',organisationId:ids.organisation,email_confirmed_at:'2026-09-01T00:00:00Z'};},
  };
  let authClockOffset=0;
  const boundary={repository,identity,origin,csrfKey:Buffer.alloc(32,8),requireLogoutVersion:true,
    now:()=>Date.now()+authClockOffset,
    beforeAuth(req,_res,next){
      if(req.path==='/bootstrap' && holdPostLoginBootstrap) {
        postLoginBootstrapCount+=1;
        heldLoginRestores.push({release:next});return;
      }
      next();
    }};
  const app=createServerSessionTestApp(boundary);
  app.use(express.json({limit:'8kb'}));
  const guard=createRequireServerSession(boundary);
  const requireAuth=(req,res,next)=>guard(req,res,()=>{
    req.auth={userId:req.serverSession.userId,accessToken:req.serverSession.accessToken,
      expectedSession:req.get('X-Plannix-Expected-Session'),
      selectedSessionName:current?.cookie.split('=')[0],fixtureId:req.fixtureId};next();
  });
  app.use('/api/timetable/sessions',(req,res,next)=>{
    req.fixtureId=randomUUID();res.setHeader('X-Test-Request-Id',req.fixtureId);
    requests.push({id:req.fixtureId,method:req.method,path:req.path,
      expectedSession:req.get('X-Plannix-Expected-Session') || null,
      cookieVersions:[...String(req.get('Cookie')||'').matchAll(/__Host-plannix-s-[1-9]\d*/g)]
        .map(match=>match[0])});
    next();
  });
  const session=(title,id=true)=>({...(id?{id:ids.lesson}:{}),day:0,
    periodId:ids.period,classId:ids.class,title,notes:''});
  const responseFor=(owner,name,args)=>{
    const record=records.get(owner);
    if(name==='plannix_get_recurring_timetable_sessions')return {revision:record.revision,
      weeks:[{weekId:ids.week,code:'A',collectionId:ids.collection,sessions:[session(record.title)]}]};
    if(name==='plannix_get_dated_timetable_sessions'){
      const date=args.target_week_start_date;
      const isCurrentWeek=date===initialWeek;
      return {revision:record.revision,week_start_date:date,repeating_week_id:ids.week,
        source:isCurrentWeek?'override':'recurring',override_exists:isCurrentWeek,
        collection_id:isCurrentWeek?ids.collection:null,
        sessions:[session(isCurrentWeek?record.title:'',isCurrentWeek)]};
    }
    if(name==='plannix_save_dated_timetable_sessions'){
      record.revision+=1;record.title=args.target_sessions[0]?.title||'';
      return {revision:record.revision,collection_id:ids.collection,repeating_week_id:ids.week,
        sessions:[session(record.title)]};
    }
    if(name==='plannix_apply_timetable_session_batch'){
      record.revision+=1;
      return {revision:record.revision,collections:args.target_mutations.map(mutation=>({
        type:mutation.type,collectionId:ids.collection,weekId:ids.week,
        weekStartDate:mutation.weekStartDate,sessions:mutation.sessions.map(item=>session(item.title))}))};
    }
    throw Error(`Unexpected timetable RPC: ${name}`);
  };
  const year={id:ids.year,label:'2026/2027',startDate:'2026-09-01',
    endDate:'2027-08-31',holidays:[]};
  const layout={timetableId:ids.timetable,revision:1,name:'Synthetic timetable',
    cycle:'one-week',periodsPerDay:1,periodLengthMinutes:60,schoolStartTime:'09:00',
    registration:{enabled:false,startTime:'08:40',lengthMinutes:15},breaks:[],
    lunch:{startTime:'12:30',lengthMinutes:45},showBreaksInTimetable:false,
    showLunchInTimetable:false,weeks:[{id:ids.week,code:'A',name:'Week A'}],
    periods:[{id:ids.period,type:'teaching',number:1,label:'Period 1',
      startTime:'09:00',endTime:'10:00',enabled:true,visible:true,order:0}]};
  app.get('/api/academic-years',requireAuth,(_req,res)=>res.json({academicYears:[year]}));
  app.get('/api/academic-year',requireAuth,(_req,res)=>res.json({plan:year}));
  app.get('/api/timetable/layout',requireAuth,(_req,res)=>res.json({layout}));
  app.get('/api/classes',requireAuth,(_req,res)=>res.json({revision:1,
    entries:[{id:ids.class,name:'Synthetic Class',frequency:5}]}));
  app.get('/api/memberships',requireAuth,(_req,res)=>{
    if(holdFirstMembership){holdFirstMembership=false;
      heldMemberships.push({release:()=>res.json({memberships:[]})});return;}
    res.json({memberships:[]});
  });
  let initialWeek;
  registerTimetableSessionRoutes({app,requireAuth,createRequestClient(auth){return {
    rpc(name,args){
      const write=name.startsWith('plannix_save_')||name==='plannix_apply_timetable_session_batch';
      const item={id:auth.fixtureId,name,owner:auth.userId,token:auth.accessToken,args,
        expectedSession:auth.expectedSession,selectedSessionName:auth.selectedSessionName};
      if(write)writes.push(item);else reads.push(item);
      if(name==='plannix_get_dated_timetable_sessions'&&!initialWeek)
        initialWeek=args.target_week_start_date;
      const finish=()=>{
        if(!write&&name==='plannix_get_recurring_timetable_sessions'&&failNextRecurring){
          failNextRecurring=false;return {data:null,error:{code:'40001',message:'Synthetic recurring failure'}};}
        if(write&&failNextSave){failNextSave=false;
          return {data:null,error:{code:'40001',message:'Synthetic conflict'}};}
        try { return {data:[responseFor(auth.userId,name,args)],error:null}; }
        catch(error) { routeErrors.push(`RPC ${name}: ${error.message}`); throw error; }
      };
      if(!write&&holdInitialRecurring&&name==='plannix_get_recurring_timetable_sessions'
        && auth.userId===A){holdInitialRecurring=false;
        return new Promise(resolve=>heldRecurring.push({item,release:()=>resolve(finish())}));}
      if(!write&&heldSnapshotDate&&name==='plannix_get_dated_timetable_sessions'
        && args.target_week_start_date === heldSnapshotDate) { heldSnapshotDate=null;
        return new Promise(resolve=>heldReads.push({item,release:()=>resolve(finish())})); }
      if(write&&holdSave)
        return new Promise(resolve=>heldWrites.push({item,release:()=>resolve(finish())}));
      return Promise.resolve(finish());
    },
  };}});
  app.get('/api/events',requireAuth,(_req,res)=>res.json({events:[]}));
  app.use((error,_req,res,_next)=>{routeErrors.push(error?.message || 'unknown');
    res.status(error?.status || 500).json({message:'Synthetic route failure.'});});
  app.use(express.static(path.join(directory,'dist')));
  app.get(/.*/,(req,res)=>res.sendFile(path.join(directory,'dist','index.html')));
  server=createServer(app);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'localhost',resolve);});

  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless','--disable-background-networking','--disable-component-update','--no-first-run',
      '--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${path.join(directory,'chrome')}`,origin],
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
    const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timeout`));},15000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,
      ...(sessionId?{sessionId}:{})}));});
  const {targetInfos}=await cdp('Target.getTargets');
  const target=targetInfos.find(item=>item.type==='page'&&item.url.startsWith(origin));
  assert.ok(target);
  const {sessionId:tab}=await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  await cdp('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false},tab);
  const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',
    {expression,awaitPromise:true,returnByValue:true},tab);
    if(result.exceptionDetails)throw Error(result.exceptionDetails.text);
    return result.result.value;};
  const waitFor=async(expression,label)=>{
    const deadline=Date.now()+10000;
    while(!await evaluate(expression)){
      if(Date.now()>deadline)throw Error(`Timed out waiting for ${label}: `
        + JSON.stringify(await evaluate('({text:document.body.innerText,html:document.body.innerHTML.slice(0,500),observed:!!window.__timetableContextTest,state:window.__timetableContextTest?.state(),path:location.pathname})')));
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  };
  const lastOperation=async(kind,title)=>evaluate(`window.__timetableOperations.filter(event=>
    event.kind===${JSON.stringify(kind)}${title===undefined?'':`&&event.title===${JSON.stringify(title)}`}).at(-1)`);
  const awaitTerminal=async(id,kind,label)=>waitFor(`window.__timetableOperations.some(event=>
    event.id===${JSON.stringify(id)}&&event.kind===${JSON.stringify(kind)})`,label);
  const awaitActualCommit=async(id,sessionName,label)=>{
    await waitFor(`window.__timetableActualCommits.some(entry=>
      entry.operationIds.includes(${JSON.stringify(id)})&&entry.sessionName===${JSON.stringify(sessionName)}
      &&entry.providerId===window.__timetableContextTest?.id
      &&entry.userId===window.__timetableCommittedState?.userId)`,label);
    return evaluate(`window.__timetableActualCommits.find(entry=>
      entry.operationIds.includes(${JSON.stringify(id)})&&entry.sessionName===${JSON.stringify(sessionName)}
      &&entry.providerId===window.__timetableContextTest?.id)`);
  };
  const issueLogin=async email=>{
    const result=await evaluate(`(async()=>{
      const status=await fetch('/__stage3/auth/status').then(r=>r.json());
      const response=await fetch('/__stage3/auth/login',{method:'POST',
        headers:{'Content-Type':'application/json','X-Plannix-CSRF':status.csrfToken,
          ...(status.sessionName?{'X-Plannix-Expected-Session':status.sessionName}:{})},
        body:JSON.stringify({email:${JSON.stringify(email)},password:'synthetic-password'})});
      if(!response.ok)return {status:response.status,body:await response.text()};
      return {status:response.status};
    })()`);
    assert.equal(result.status,200,JSON.stringify(result));
    return evaluate("fetch('/__stage3/auth/status').then(r=>r.json())");
  };
  const login=async(email,{beforeLoaded}={})=>{
    await issueLogin(email);
    await evaluate("window.dispatchEvent(new Event('focus'))");
    if(beforeLoaded)await beforeLoaded();
    await waitFor(`document.body.textContent.includes(${JSON.stringify(email.startsWith('other')?'Other Teacher':'Synthetic Teacher')})`,
      'App session reconciliation');
    if (!await evaluate("location.pathname==='/timetable'"))
      await evaluate("document.querySelector('a[href=\"/timetable\"]')?.click()");
    await waitFor(`Boolean(window.__timetableContextTest?.state().dated)
      && document.body.textContent.includes(${JSON.stringify(email.startsWith('other')?'Other Teacher':'Synthetic Teacher')})`,
      `${email} timetable loaded through App reconciliation`);
    const status=await evaluate("fetch('/__stage3/auth/status').then(r=>r.json())");
    return {userId:status.userId,sessionName:status.sessionName};
  };
  await waitFor("Boolean(document.querySelector('.nav-login') && !document.querySelector('.nav-login').disabled)",'App signed-out bootstrap');
  holdFirstMembership=true;
  await evaluate("document.querySelector('.nav-login').click()");
  await waitFor("Boolean(document.querySelector('#login-email'))",'login form');
  await evaluate(`(() => {
    for(const [id,value] of [['login-email','synthetic@example.test'],
      ['login-password','synthetic-password']]) {
      const input=document.getElementById(id);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    document.querySelector('.login-form .login-submit').click();
  })()`);
  await waitFor("location.pathname==='/timetable'",'first validated login navigation');
  try { await waitForServer(()=>heldMemberships.length===1,'delayed first-login membership request'); }
  catch (error) { console.error('First-login membership diagnostic',
    { postLoginBootstrapCount,restores:heldLoginRestores.length,
      planner:await evaluate('window.__firstLoginPlannerState') });
    throw error; }
  await waitFor(`window.__firstLoginPlannerState?.yearId===${JSON.stringify(ids.year)}
    &&window.__firstLoginPlannerState.classNames.includes('Synthetic Class')
    &&window.__firstLoginPlannerState.timetableId===${JSON.stringify(ids.timetable)}
    &&window.__firstLoginPlannerState.lessonTitle==='Initial A'`, 'existing planner after first login');
  assert.equal(heldLoginRestores.length,0,
    'validated same-tab login does not start a redundant restoration');
  assert.equal(postLoginBootstrapCount,0,
    'the same-tab login sends no second bootstrap request');
  heldMemberships.shift().release();
  holdPostLoginBootstrap=false;
  current=null;
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await waitFor("Boolean(document.querySelector('.nav-login') && !document.querySelector('.nav-login').disabled)",
    'fixture signed-out reset before existing account-switch scenarios');
  const firstLoginDatedReads=reads.filter(item=>item.owner===A
    && item.name==='plannix_get_dated_timetable_sessions').length;
  holdInitialRecurring=true;
  const a=await issueLogin('synthetic@example.test');
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await waitForServer(()=>heldRecurring.length===1,'initial recurring read barrier');
  await evaluate("document.querySelector('a[href=\"/timetable\"]')?.click()");
  await waitFor("location.pathname==='/timetable'",'navigate while recurring readiness is pending');
  const firstRecurring=await lastOperation('recurring-start');
  assert.equal(reads.filter(item=>item.owner===A
    && item.name==='plannix_get_dated_timetable_sessions').length,firstLoginDatedReads,
    'dated load waits for authoritative recurring readiness');
  failNextRecurring=true;heldRecurring.shift().release();
  await awaitTerminal(firstRecurring.id,'recurring-terminal','failed recurring handler settled');
  assert.equal(await evaluate("window.__timetableOperations.find(event=>event.kind==='recurring-terminal'&&event.id==='"+firstRecurring.id+"')?.outcome"),'error');
  assert.equal(reads.filter(item=>item.owner===A
    && item.name==='plannix_get_dated_timetable_sessions').length,firstLoginDatedReads,
    'failed recurring load does not start a dated read');
  await waitFor("Boolean(document.querySelector('.schedule-titlebar-actions button') && document.body.textContent.includes('Synthetic route failure.'))",'visible recurring error');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reload').click()");
  await waitFor("window.__timetableContextTest?.state().sessions?.[0]?.title==='Initial A'",'recurring Retry loads dated timetable');
  assert.equal(a.userId,A);
  assert.equal(await evaluate("window.__timetableContextTest.state().sessions[0].title"),'Initial A');

  // Actual ProjectCard dated-week preparation is held at the production session route.
  const futureWeek=new Date(`${initialWeek}T12:00:00Z`);
  futureWeek.setUTCDate(futureWeek.getUTCDate()+7);
  heldSnapshotDate=futureWeek.toISOString().slice(0,10);
  await evaluate("[...document.querySelectorAll('.lesson-card')].find(b=>b.textContent.includes('Initial A')).click()");
  await waitFor("Boolean(document.querySelector('button[aria-label=\"Push lesson details right one step\"]'))",'lesson dialog');
  await evaluate("document.querySelector('button[aria-label=\"Push lesson details right one step\"]').click()");
  const snapshotOperation=await lastOperation('snapshot-start');
  try { await waitForServer(()=>heldReads.length===1,'identified future dated snapshot read'); }
  catch(error) { console.error('Snapshot diagnostic',heldReads.length,
    await evaluate("document.querySelector('.lesson-modal')?.innerText")); throw error; }
  const writesBeforeSnapshot=writes.length;
  assert.equal(heldReads.length,1,'only the identified snapshot is held while auth remains usable');
  const b=await login('other@example.test');
  assert.equal(b.userId,B);
  const bBeforeSnapshot=await evaluate('window.__timetableCommittedState');
  const releasedSnapshot=heldReads.shift();releasedSnapshot.release();
  assert.equal(releasedSnapshot.item.args.target_week_start_date,
    futureWeek.toISOString().slice(0,10),'only the identified future week was paused');
  await awaitTerminal(snapshotOperation.id,'snapshot-terminal','late A snapshot handler settled');
  const bAfterSnapshot=await evaluate('window.__timetableCommittedState');
  await waitFor("window.__timetableContextTest.state().sessions?.[0]?.title==='Initial B'",'B timetable after A snapshot');
  assert.equal(writes.length,writesBeforeSnapshot,'A snapshot work sends no batch under B');
  assert.equal(records.get(B).title,'Initial B');
  assert.equal(await evaluate("window.__timetableContextTest.state().saved"),false);
  assert.equal(bAfterSnapshot.sessionName,b.sessionName);
  assert.equal(bAfterSnapshot.commitSequence,bBeforeSnapshot.commitSequence,
    'stale snapshot handling schedules no new provider commit');
  assert.deepEqual(bAfterSnapshot.state,bBeforeSnapshot.state,
    'A snapshot terminal handler leaves B committed cache and save state intact');

  // A's first request is already accepted. Its queued second edit must not dispatch as B.
  await login('synthetic@example.test');
  holdSave=true;
  assert.equal(await evaluate("window.__timetableContextTest.edit('A first')"),true);
  const firstOperation=await lastOperation('save-start','A first');
  await waitForServer(()=>heldWrites.length===1,'A first accepted write');
  assert.equal(await evaluate("window.__timetableContextTest.edit('A queued')"),true);
  const queuedOperation=await lastOperation('save-start','A queued');
  assert.notEqual(queuedOperation.id,firstOperation.id);
  const firstAccepted=heldWrites.shift();
  assert.equal(firstAccepted.item.args.target_sessions[0].title,firstOperation.title,
    'the terminal barrier identifies the held first save');
  const beforeSwitch=writes.length;
  const bAfterSuccess=await login('other@example.test');
  const bBeforeSuccess=await evaluate('window.__timetableCommittedState');
  holdSave=false;firstAccepted.release();
  await awaitTerminal(queuedOperation.id,'save-terminal','queued A edit discarded on reset');
  assert.equal(await evaluate(`window.__timetableOperations.find(event=>event.kind==='save-terminal'&&event.id===${JSON.stringify(queuedOperation.id)})?.outcome`),'discarded');
  await awaitTerminal(firstOperation.id,'save-terminal','late accepted A save handler settled');
  const lateSuccess=await evaluate(`window.__timetableOperations.find(event=>event.kind==='save-terminal'&&event.id===${JSON.stringify(firstOperation.id)})`);
  assert.equal(lateSuccess.outcome,'stale');
  assert.equal(lateSuccess.scheduledSettlementUpdate,false);
  assert.equal(await evaluate(`window.__timetableOperations.some(event=>event.kind==='save-update-start'&&event.id===${JSON.stringify(firstOperation.id)})`),false);
  await waitFor("window.__timetableContextTest.state().sessions?.[0]?.title==='Initial B'",'B after late A success');
  assert.equal(writes.length,beforeSwitch,'queued A work never dispatches under B');
  assert.equal(firstAccepted.item.owner,A,'first request was accepted under A before switch');
  assert.equal(firstAccepted.item.expectedSession,firstAccepted.item.selectedSessionName);
  assert.equal(records.get(B).title,'Initial B');
  assert.equal(await evaluate("window.__timetableContextTest.state().saved"),false,
    'late A success cannot change B save status');
  const bCommittedAfterSuccess=await evaluate('window.__timetableCommittedState');
  assert.equal(bCommittedAfterSuccess.sessionName,bAfterSuccess.sessionName);
  assert.equal(bCommittedAfterSuccess.commitSequence,bBeforeSuccess.commitSequence,
    'stale success schedules no provider commit');
  assert.deepEqual(bCommittedAfterSuccess.state,bBeforeSuccess.state,
    'late A success cannot change B committed timetable, cache or status');

  // Same-account replacement changes cookie version and invalidates its older queue.
  await login('synthetic@example.test');
  holdSave=true;
  assert.equal(await evaluate("window.__timetableContextTest.edit('A replacement first')"),true);
  const replacementOperation=await lastOperation('save-start','A replacement first');
  await waitForServer(()=>heldWrites.length===1,'pre-replacement accepted write');
  assert.equal(await evaluate("window.__timetableContextTest.edit('A replacement queued')"),true);
  const oldVersion=heldWrites.shift();const beforeReplacement=writes.length;
  assert.equal(oldVersion.item.args.target_sessions[0].title,replacementOperation.title,
    'the terminal barrier identifies the held replacement-version save');
  const providerMountBefore=await evaluate('window.__timetableProviderMountId');
  await evaluate("document.querySelector('a[href=\"/profile\"]')?.click()");
  await waitFor("location.pathname==='/profile' && Boolean(document.querySelector('#personal-details-title'))",
    'Profile verifies old session while provider remains mounted');
  const replacement=await issueLogin('synthetic@example.test');
  assert.notEqual(replacement.sessionName,oldVersion.item.expectedSession);
  // Profile's next visit uses the real controller verification path without an App-wide
  // pending state. App keeps the same-account TimetableSessionProvider mounted.
  await evaluate("document.querySelector('a[href=\"/settings\"]')?.click()");
  await waitFor("location.pathname==='/settings'",'Settings navigation before verification');
  await evaluate("document.querySelector('a[href=\"/profile\"]')?.click()");
  await waitFor("location.pathname==='/profile' && Boolean(document.querySelector('#personal-details-title'))",
    'Profile verifies replacement session');
  assert.equal(await evaluate('window.__timetableProviderMountId'),providerMountBefore,
    'the production provider remains mounted across same-account replacement');
  holdSave=false;oldVersion.release();
  await awaitTerminal(replacementOperation.id,'save-terminal','late old-version save handler settled');
  assert.equal(await evaluate(`window.__timetableOperations.find(event=>event.kind==='save-terminal'&&event.id===${JSON.stringify(replacementOperation.id)})?.outcome`),'stale');
  assert.equal(writes.length,beforeReplacement,
    'the mounted provider does not dispatch its queued old-version edit');
  await evaluate("document.querySelector('a[href=\"/timetable\"]')?.click()");
  await waitFor("window.__timetableContextTest?.state().sessions?.[0]?.title==='A replacement first'",
    'new-session timetable reloads the accepted A save');
  assert.equal(records.get(A).title,'A replacement first',
    'the old request was already accepted under A before replacement');
  assert.equal(writes.length,beforeReplacement,'old-version queue never dispatches');
  assert.equal(await evaluate("window.__timetableContextTest.state().saved"),false);

  // A late failed accepted request also cannot set B's error, cache or save state.
  holdSave=true;failNextSave=true;
  assert.equal(await evaluate("window.__timetableContextTest.edit('A late error')"),true);
  const errorOperation=await lastOperation('save-start','A late error');
  await waitForServer(()=>heldWrites.length===1,'accepted write for late error');
  const failed=heldWrites.shift();const beforeLateError=writes.length;
  assert.equal(failed.item.args.target_sessions[0].title,errorOperation.title,
    'the terminal barrier identifies the held error response');
  const bAfterError=await login('other@example.test');
  const bBeforeError=await evaluate('window.__timetableCommittedState');
  holdSave=false;failed.release();
  await awaitTerminal(errorOperation.id,'save-terminal','late A error handler settled');
  const lateError=await evaluate(`window.__timetableOperations.find(event=>event.kind==='save-terminal'&&event.id===${JSON.stringify(errorOperation.id)})`);
  assert.equal(lateError.outcome,'stale');
  assert.equal(lateError.scheduledSettlementUpdate,false);
  assert.equal(await evaluate(`window.__timetableOperations.some(event=>event.kind==='save-update-start'&&event.id===${JSON.stringify(errorOperation.id)})`),false);
  await waitFor("window.__timetableContextTest.state().sessions?.[0]?.title==='Initial B'",'B after late error');
  assert.equal(writes.length,beforeLateError);
  assert.equal(await evaluate("window.__timetableContextTest.state().error"),'');
  assert.equal(await evaluate("window.__timetableContextTest.state().saved"),false);
  assert.equal(records.get(B).title,'Initial B');
  const bCommittedAfterError=await evaluate('window.__timetableCommittedState');
  assert.equal(bCommittedAfterError.sessionName,bAfterError.sessionName);
  assert.equal(bCommittedAfterError.commitSequence,bBeforeError.commitSequence,
    'stale error schedules no provider commit');
  assert.deepEqual(bCommittedAfterError.state,bBeforeError.state,
    'late A error cannot change B committed timetable, cache or status');

  // Ordinary server-mode edit, deliberate Retry and the real ProjectCard batch path.
  failNextSave=true;
  assert.equal(await evaluate("window.__timetableContextTest.edit('B retry')"),true);
  const failedRetryOperation=await lastOperation('save-start','B retry');
  await waitFor("Boolean(document.querySelector('.schedule-titlebar-actions button')) && window.__timetableContextTest.state().error.length>0",'save conflict');
  await awaitTerminal(failedRetryOperation.id,'save-terminal','failed B save queue finalized');
  const failedCommit=await awaitActualCommit(failedRetryOperation.id,bAfterError.sessionName,
    'failed B save observed in a real provider commit');
  assert.ok(failedCommit.state.error.length>0);
  const failedCount=writes.length;
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retry save').click()");
  const retryOperation=await lastOperation('save-start','B retry');
  assert.notEqual(retryOperation.id,failedRetryOperation.id,'Retry is a distinct queued operation');
  await awaitTerminal(retryOperation.id,'save-terminal','retried B save queue finalized');
  const retryCommit=await awaitActualCommit(retryOperation.id,bAfterError.sessionName,
    'successful Retry observed in a real provider commit');
  assert.equal(retryCommit.state.saved,true);
  await waitFor("window.__timetableContextTest.state().saved===true",'successful explicit Retry');
  assert.equal(writes.length,failedCount+1);
  assert.equal(records.get(B).title,'B retry');
  assert.equal(await evaluate("window.__timetableContextTest.state().sessions[0].title"),'B retry');
  const beforeBatch=writes.length;
  await evaluate("[...document.querySelectorAll('.lesson-card')].find(b=>b.textContent.includes('B retry')).click()");
  await waitFor("Boolean(document.querySelector('button[aria-label=\"Push lesson details right one step\"]'))",'B lesson dialog');
  await evaluate("document.querySelector('button[aria-label=\"Push lesson details right one step\"]').click()");
  await waitForServer(()=>writes.length>beforeBatch,'ProjectCard batch RPC');
  assert.equal(writes.length,beforeBatch+1,'one batch mutation, not per-week writes');
  assert.equal(writes.at(-1).name,'plannix_apply_timetable_session_batch');
  assert.equal(writes.at(-1).owner,B);
  await waitFor("window.__timetableContextTest.state().saved===true",'authoritative batch save');
  assert.ok([...reads,...writes].every(item=>item.owner===A||item.owner===B));
  assert.ok([...reads,...writes].every(item=>item.token===`synthetic-access-${item.owner}`),
    'guarded route uses the verified session owner token');
  assert.ok([...reads,...writes].every(item=>item.expectedSession===item.selectedSessionName),
    'every RPC uses a matching captured request context and verified cookie session');
  assert.equal(requests.filter(item=>item.method==='PUT').length,writes.length,
    'no unintended attempted writes are hidden before the RPC boundary');
  // A same-context display remount keeps the production provider mounted,
  // but must never inherit commit IDs from its earlier display instance.
  const beforeDisplayUnmount=await evaluate('window.__timetableContextTest.id');
  const realProviderBeforeUnmount=await evaluate('window.__timetableCommittedState.realProviderId');
  const commitsBeforeRemount=await evaluate('window.__timetableActualCommits.length');
  await evaluate("document.querySelector('a[href=\"/profile\"]')?.click()");
  await waitFor("location.pathname==='/profile' && !window.__timetableContextTest",
    'display unmounted');
  await evaluate("document.querySelector('a[href=\"/timetable\"]')?.click()");
  await waitFor("window.__timetableContextTest?.state().sessions?.[0]?.title==='B retry'",
    'same-context timetable remount');
  assert.notEqual(await evaluate('window.__timetableContextTest.id'),beforeDisplayUnmount);
  assert.equal(await evaluate('window.__timetableCommittedState.realProviderId'),realProviderBeforeUnmount,
    'the production provider remains mounted across display remount');
  assert.equal(await evaluate('window.__timetableActualCommits.length'),commitsBeforeRemount,
    'a same-context remount does not attribute old operation IDs to a new commit');
  // A newer account may become active while its predecessor's recurring load is pending.
  // Advance only the synthetic auth-rate-limit clock; no application or browser time changes.
  authClockOffset+=61000;
  holdInitialRecurring=true;
  await issueLogin('synthetic@example.test');
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await waitForServer(()=>heldRecurring.length===1,'A recurring read before account navigation');
  const staleRecurring=await lastOperation('recurring-start');
  const aDatedBefore=reads.filter(item=>item.owner===A
    && item.name==='plannix_get_dated_timetable_sessions').length;
  await login('other@example.test');
  heldRecurring.shift().release();
  await awaitTerminal(staleRecurring.id,'recurring-terminal','stale recurring handler settled');
  assert.equal(reads.filter(item=>item.owner===A
    && item.name==='plannix_get_dated_timetable_sessions').length,aDatedBefore,
    'stale recurring completion starts no old-account dated load');
  assert.equal(await evaluate("window.__timetableContextTest.state().sessions[0].title"),records.get(B).title);
  assert.equal(await evaluate("window.__timetableContextTest.state().saved"),false,
    'B save status survives the old recurring completion');
  const operationAccounting=await evaluate(`(()=>{
    const starts=window.__timetableOperations.filter(event=>event.kind==='save-start');
    const terminals=window.__timetableOperations.filter(event=>event.kind==='save-terminal');
    return { starts:starts.map(event=>event.id),
      terminalCounts:starts.map(start=>terminals.filter(event=>event.id===start.id).length),
      outcomes:terminals.map(event=>event.outcome) };
  })()`);
  assert.equal(new Set(operationAccounting.starts).size,operationAccounting.starts.length,
    'every accepted edit and Retry has a unique test operation ID');
  assert.ok(operationAccounting.terminalCounts.every(count=>count===1),
    'every accepted test operation has exactly one terminal acknowledgement');
  assert.ok(operationAccounting.outcomes.every(outcome=>
    ['success','error','stale','coalesced','discarded'].includes(outcome)));
  console.log('Rendered server-mode timetable context passed: snapshots, queue, replacement, late outcomes, Retry and ProjectCard batching.');
} catch(error) {
  console.error('Fixture diagnostics', {routeErrors:routeErrors.slice(0,3),
    reads:reads.map(item=>[item.owner===A?'A':'B',item.name,item.args.target_week_start_date]),
    requests:requests.length});
  failure=error;
} finally {
  const cleanupErrors=[];
  const cleanup=async work=>{try{await work();}catch(error){cleanupErrors.push(error);}};
  await cleanup(async()=>{heldReads.splice(0).forEach(item=>item.release());
    heldLoginRestores.splice(0).forEach(item=>item.release());
    heldMemberships.splice(0).forEach(item=>item.release());
    heldRecurring.splice(0).forEach(item=>item.release());
    heldWrites.splice(0).forEach(item=>item.release());});
  await cleanup(async()=>socket?.close());
  let chromeExited=!chrome || chrome.exitCode!==null || chrome.signalCode!==null;
  await cleanup(async()=>{
    if(chrome && chrome.exitCode===null && chrome.signalCode===null){
      const exited=new Promise(resolve=>chrome.once('exit',resolve));
      chrome.kill('SIGTERM');
      const graceful=await Promise.race([exited.then(()=>true),
        new Promise(resolve=>setTimeout(()=>resolve(false),3000))]);
      if(!graceful){
        chrome.kill('SIGKILL');
        const forced=await Promise.race([exited.then(()=>true),
          new Promise(resolve=>setTimeout(()=>resolve(false),5000))]);
        if(!forced)throw Error('Chrome did not exit after SIGKILL.');
      }
    }
    chromeExited=true;
  });
  await cleanup(async()=>{if(server){server.closeAllConnections();
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}});
  if(chromeExited)
    await cleanup(()=>rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  else cleanupErrors.push(Error('Chrome remains live; temporary profile was retained.'));
  if(cleanupErrors.length){
    if(failure)console.error('Cleanup errors after original assertion:',cleanupErrors);
    else failure=new AggregateError(cleanupErrors,'Browser fixture cleanup failed.');
  }
}
if(failure)throw failure;
