// Synthetic rendered recovery test: real App, controller, transport, router and guard.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { createServerSessionRouter } from '../server/auth/serverSessionRouter.js';
import { createRequireServerSession } from '../server/auth/requireServerSession.js';
import { registerTimetableSessionRoutes } from '../server/routes/timetable-session-routes.js';

const markerName='__Host-plannix-b-1';
const markerValue='a'.repeat(43);
const marker=`${markerName}=${markerValue}`;
const owner='dd000000-0000-4000-8000-000000000001';
const otherOwner='dd000000-0000-4000-8000-000000000002';
const ids={ organisation:'dd000000-0000-4000-8000-000000000003',
  year:'dd000000-0000-4000-8000-000000000004',timetable:'dd000000-0000-4000-8000-000000000005',
  week:'dd000000-0000-4000-8000-000000000006',collection:'dd000000-0000-4000-8000-000000000007',
  period:'dd000000-0000-4000-8000-000000000008',class:'dd000000-0000-4000-8000-000000000009',
  lesson:'dd000000-0000-4000-8000-000000000010' };
const work=await mkdtemp(path.join(tmpdir(),'plannix-recovery-browser-'));
let server;let chrome;let socket;let failure;
let held=[];let holdApp=false;let holdForm=false;
let holdPasswordResponse=false;let heldPasswordResponse=null;
let failNextFormStatus=0;let formStatusGets=0;let recoveryEmails=0;let callbackGets=0;
let current={number:3,value:'b'.repeat(43)};
let ordinaryMode=false;
let ordinaryOwner=owner;
let ordinaryVersion=20;
const ordinaryCookie=()=>`__Host-plannix-s-${ordinaryVersion}=${'m'.repeat(43)}`;
let passwordPosts=0;let providerUpdates=0;let failProvider=false;
let holdPlannerSave=false;
const heldPlannerSaves=[];const plannerWrites=[];
const plannerRecords=new Map([[owner,{title:'A private lesson',revision:1}],
  [otherOwner,{title:'B lesson',revision:1}]]);
const cookie=()=>`__Host-plannix-r-${current.number}=${current.value}`;
const waitUntil=async(predicate,label,timeout=10000)=>{
  const deadline=Date.now()+timeout;
  while(!await predicate()){
    if(Date.now()>deadline)throw Error(`${label} did not arrive`);
    await new Promise(resolve=>setTimeout(resolve,25));
  }
};
try {
  const probe=createServer().listen(0,'localhost');
  await new Promise(resolve=>probe.once('listening',resolve));
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const origin=`http://localhost:${port}`;
  const previousMode=process.env.VITE_PLANNIX_AUTH_MODE;
  const previousApi=process.env.VITE_API_BASE_URL;
  process.env.VITE_PLANNIX_AUTH_MODE='server';process.env.VITE_API_BASE_URL=origin;
  try {
    await build({configFile:false,mode:'stage4-app-browser-test',logLevel:'error',
      build:{outDir:path.join(work,'dist'),emptyOutDir:true},plugins:[react(),
        {name:'recovery-real-provider-probe',enforce:'pre',resolveId(source,importer){
          if(importer?.endsWith('/App.jsx')&&source==='./context/TimetableSessionContext')
            return path.resolve('src/components/RecoveryPlannerProbe.browser-test.jsx');
          return null;
        }}]});
  } finally {
    if(previousMode===undefined)delete process.env.VITE_PLANNIX_AUTH_MODE;
    else process.env.VITE_PLANNIX_AUTH_MODE=previousMode;
    if(previousApi===undefined)delete process.env.VITE_API_BASE_URL;
    else process.env.VITE_API_BASE_URL=previousApi;
  }
  const htmlPath=path.join(work,'dist','index.html');
  const html=await readFile(htmlPath,'utf8');
  await writeFile(htmlPath,html.replace('<script type="module"',
    `<script>window.__authTestOperations=[];
      window.__plannixAuthTestObserver=event=>window.__authTestOperations.push(event);
      window.__timetableOperations=[];
      window.__plannixTimetableOperationObserver=event=>window.__timetableOperations.push(event);
      const recoveryFixtureFetch=window.fetch.bind(window);
      // Let only the identified recovery-entry read finish after controller disposal.
      window.fetch=(input,init)=>{
        if(sessionStorage.getItem('recovery-ignore-abort')==='1'
          && new URL(input,location.href).pathname==='/__stage3/auth/status'
          && new Headers(init?.headers).get('X-Plannix-Verification')==='recovery-entry'){
          sessionStorage.removeItem('recovery-ignore-abort');
          window.__recoveryAbortIgnored=true;
          return recoveryFixtureFetch(input,{...init,signal:undefined});
        }
        return recoveryFixtureFetch(input,init);
      };</script>
      <script type="module"`));
  const repository={
    async issueBinding(){return {state:'issued',setCookie:`${marker}; Path=/; Secure; HttpOnly; SameSite=Lax`};},
    async resolve(header){
      if(!header?.includes(marker))return {state:header?'invalid':'missing'};
      const selected=ordinaryMode
        ? (header.includes(ordinaryCookie())?ordinaryCookie():null)
        : (header.includes(cookie())?cookie():null);
      return {state:'selected',header:[marker,selected].filter(Boolean).join('; '),
        markerName,sessionName:selected?.split('=')[0]||null,cleanup:[]};
    },
    async readTokens(header,kind){
      if(ordinaryMode){
        if(!header?.includes(ordinaryCookie()))return {state:'absent'};
        if(kind!=='ordinary')return {state:'wrong-kind'};
      } else {
        if(!header?.includes(cookie()))return {state:'absent'};
        if(kind!=='recovery')return {state:'wrong-kind'};
      }
      return {state:'current',ownerId:ordinaryMode?ordinaryOwner:owner,accessToken:'synthetic-access',
        refreshToken:'synthetic-refresh',tokenVersion:1};
    },
    async inspect(header,kind){const found=await this.readTokens(header,kind);
      return found.state==='current'?{state:'current',ownerId:owner}:found;},
    async resolveForApplication(header){const selected=await this.resolve(header);
      if(selected.state!=='selected'||!selected.sessionName)return selected;
      if(!ordinaryMode)return {state:'wrong-kind'};
      const tokens=await this.readTokens(selected.header,'ordinary');
      return tokens.state==='current'?{...selected,...tokens}:tokens;},
    async logout(header){if(!header?.includes(cookie()))return {state:'absent'};
      const name=cookie().split('=')[0];current={number:0,value:''};
      return {state:'revoked',cleanup:name};},
  };
  const identity={
    async login(){throw Error('Unexpected provider login');},
    async validateAccess(){if(!ordinaryMode)throw Error('Recovery must not validate as ordinary access');
      return {userId:ordinaryOwner};},
    async loadCurrentUser(){if(!ordinaryMode)throw Error('Recovery cannot load an ordinary profile');
      return {id:ordinaryOwner,organisationId:ids.organisation,
        name:ordinaryOwner===owner?'Synthetic Teacher':'Other Teacher',email:'teacher@example.test',firstName:'Synthetic',
        lastName:'Teacher',initials:'ST'};},
    async updateRecoveryPassword(){providerUpdates+=1;
      if(failProvider)throw Object.assign(new Error('synthetic provider rejection'),{kind:'password'});
      return {updated:true};},
  };
  const boundary={repository,identity,origin,csrfKey:Buffer.alloc(32,7),
    limiter:{check:async()=>{}},beforeAuth(req,res,next){
      if(req.path==='/recover')recoveryEmails+=1;
      if(req.path==='/callback')callbackGets+=1;
      if(req.path==='/recovery/password'){
        passwordPosts+=1;
        if(holdPasswordResponse){
          const end=res.end.bind(res);
          res.end=(...args)=>{heldPasswordResponse=()=>end(...args);return res;};
        }
      }
      if(req.path==='/status'){
        const form=req.get('X-Plannix-Verification')==='recovery-entry';
        if(form)formStatusGets+=1;
        if(form&&failNextFormStatus>0){failNextFormStatus-=1;
          res.status(503).json({message:'Authentication service is temporarily unavailable.'});return;}
        if(form?holdForm:holdApp){
          held.push({form,release:next,operationId:req.get('X-Plannix-Test-Operation')});
          return;
        }
      }
      next();
    }};
  const app=express();app.disable('x-powered-by');app.set('trust proxy',false);
  app.use('/__stage3/auth',boundary.beforeAuth);
  app.use('/__stage3/auth',createServerSessionRouter(boundary));
  const guard=createRequireServerSession(boundary);
  app.get('/__stage3/protected',guard,
    (req,res)=>res.json({userId:req.serverSession.userId}));
  app.use(express.json({limit:'8kb'}));
  const requireAuth=(req,res,next)=>guard(req,res,()=>{
    req.auth={userId:req.serverSession.userId,accessToken:req.serverSession.accessToken,
      sessionName:req.get('X-Plannix-Expected-Session')};next();
  });
  const year={id:ids.year,label:'2026/2027',startDate:'2026-09-01',endDate:'2027-08-31',holidays:[]};
  const layout={timetableId:ids.timetable,revision:1,name:'Synthetic timetable',cycle:'one-week',
    periodsPerDay:1,periodLengthMinutes:60,schoolStartTime:'09:00',
    registration:{enabled:false,startTime:'08:40',lengthMinutes:15},breaks:[],
    lunch:{startTime:'12:30',lengthMinutes:45},showBreaksInTimetable:false,
    showLunchInTimetable:false,weeks:[{id:ids.week,code:'A',name:'Week A'}],
    periods:[{id:ids.period,type:'teaching',number:1,label:'Period 1',
      startTime:'09:00',endTime:'10:00',enabled:true,visible:true,order:0}]};
  app.get('/api/academic-years',requireAuth,(_req,res)=>res.json({academicYears:[year]}));
  app.get('/api/academic-year',requireAuth,(_req,res)=>res.json({plan:year}));
  app.get('/api/timetable/layout',requireAuth,(_req,res)=>res.json({layout}));
  app.get('/api/classes',requireAuth,(req,res)=>res.json({revision:1,entries:[{
    id:ids.class,name:req.auth.userId===owner?'A private class':'B class',frequency:5}]}));
  app.get('/api/memberships',requireAuth,(_req,res)=>res.json({memberships:[]}));
  app.get('/api/events',requireAuth,(_req,res)=>res.json({events:[]}));
  registerTimetableSessionRoutes({app,requireAuth,createRequestClient(auth){return {rpc(name,args){
    const record=plannerRecords.get(auth.userId);
    const session=title=>({id:ids.lesson,day:0,periodId:ids.period,classId:ids.class,title,notes:''});
    const finish=()=>{
      if(name==='plannix_get_recurring_timetable_sessions')return {data:[{revision:record.revision,
        weeks:[{weekId:ids.week,code:'A',collectionId:ids.collection,sessions:[session(record.title)]}]}],error:null};
      if(name==='plannix_get_dated_timetable_sessions')return {data:[{revision:record.revision,
        week_start_date:args.target_week_start_date,repeating_week_id:ids.week,
        source:'override',override_exists:true,collection_id:ids.collection,
        sessions:[session(record.title)]}],error:null};
      if(name==='plannix_save_dated_timetable_sessions'){
        record.revision+=1;record.title=args.target_sessions[0]?.title||'';
        return {data:[{revision:record.revision,collection_id:ids.collection,
          repeating_week_id:ids.week,sessions:[session(record.title)]}],error:null};
      }
      throw Error('Unexpected synthetic timetable operation.');
    };
    if(name==='plannix_save_dated_timetable_sessions'){
      plannerWrites.push({owner:auth.userId,name,sessionName:auth.sessionName,
        title:args.target_sessions[0]?.title});
      if(holdPlannerSave)return new Promise(resolve=>heldPlannerSaves.push({release:()=>resolve(finish())}));
    }
    return Promise.resolve(finish());
  }};}});
  app.use((error,_req,res,_next)=>res.status(error?.statusCode||500).json({message:'Synthetic route failure.'}));
  app.use(express.static(path.join(work,'dist')));
  app.get(/.*/,(req,res)=>res.sendFile(path.join(work,'dist','index.html')));
  server=createServer(app);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'localhost',resolve);});
  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless','--disable-background-networking','--disable-component-update',
      '--no-first-run','--disable-gpu','--remote-debugging-port=0',
      `--user-data-dir=${path.join(work,'chrome')}`,'about:blank'],
    {stdio:['ignore','ignore','pipe']});
  let chromeStartError;
  chrome.once('error',error=>{chromeStartError=error;});
  chrome.stderr.resume();
  let wsUrl;
  await waitUntil(async()=>{
    if(chromeStartError)throw chromeStartError;
    if(chrome.exitCode!==null || chrome.signalCode!==null)throw Error('Chrome exited before DevTools was ready.');
    try {
      const [port,browserPath]=String(await readFile(path.join(work,'chrome','DevToolsActivePort'),'utf8'))
        .trim().split('\n');
      if(/^\d{1,5}$/.test(port) && /^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath)){
        wsUrl=`ws://127.0.0.1:${port}${browserPath}`;
        return true;
      }
    } catch { /* Chrome has not written its isolated profile's port file yet. */ }
    return false;
  },'Chrome DevTools startup',15000);
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
  const target=targetInfos.find(item=>item.type==='page'&&item.url==='about:blank');
  assert.ok(target);
  const {sessionId:tab}=await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  await cdp('Network.enable',{},tab);
  const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',
    {expression,awaitPromise:true,returnByValue:true},tab);
    if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
  const setCookie=async(name,value)=>{
    const result=await cdp('Network.setCookie',{name,value,url:origin,
      secure:true,httpOnly:true,sameSite:'Lax'},tab);
    assert.equal(result.success,true,`synthetic ${name} cookie installed`);
  };
  await setCookie(markerName,markerValue);
  const loadRecovery=async(pathname='/reset-password')=>{
    await setCookie(cookie().split('=')[0],current.value);
    await cdp('Page.navigate',{url:`${origin}${pathname}`},tab);
  };
  const heldFor=form=>held.filter(item=>item.form===form);
  const release=form=>{for(const item of held.filter(item=>item.form===form))item.release();
    held=held.filter(item=>item.form!==form);
    if(form)holdForm=false;else holdApp=false;};
  const password='synthetic-new-password';
  const submit=async()=>evaluate(`(() => {
    for(const id of ['reset-password-new','reset-password-confirm']) {
      const input=document.getElementById(id);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(password)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    document.querySelector('.reset-password-form button[type="submit"]').click();
  })()`);
  for(const order of ['form-first','app-first']){
    current={number:order==='form-first'?3:4,value:(order==='form-first'?'b':'c').repeat(43)};
    holdApp=true;holdForm=true;held=[];
    await loadRecovery();
    await waitUntil(()=>evaluate("location.pathname==='/reset-password' && Boolean(document.querySelector('.reset-password-form'))"),
      'real reset form mounted');
    await waitUntil(()=>Promise.resolve(heldFor(true).length>=1&&heldFor(false).length>=1),
      `${order} held App/form statuses`);
    const appStatusId=heldFor(false)[0].operationId;
    assert.match(appStatusId,/^[0-9a-f-]{36}$/i);
    if(order==='form-first'){
      release(true);
      await waitUntil(()=>evaluate("!document.querySelector('.reset-password-form button').disabled"),
        'recovery form ready before App restoration');
      release(false);
    } else {
      release(false);
      await waitUntil(()=>evaluate(`window.__authTestOperations.some(e=>
        e.kind==='session-read-terminal'&&e.id===${JSON.stringify(appStatusId)})`),
        'App restoration completed before recovery form status');
      release(true);
    }
    await waitUntil(()=>evaluate("!document.querySelector('.reset-password-form button').disabled"),
      'recovery form ready');
    await waitUntil(()=>evaluate(`window.__authTestOperations.some(e=>
      e.kind==='session-read-terminal'&&e.id===${JSON.stringify(appStatusId)})`),
      'App restoration applied or ignored its held status');
    const focusBefore=await evaluate("window.__authTestOperations.filter(e=>e.kind==='subscription-terminal').length");
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await waitUntil(()=>evaluate(`window.__authTestOperations.filter(e=>
      e.kind==='subscription-terminal').length>${focusBefore}`),
      'App focus reconciliation');
    assert.equal(await evaluate(`window.__authTestOperations.filter(e=>
      e.kind==='subscription-terminal').slice(${focusBefore}).some(e=>e.outcome==='signed-out')`),true);
    if(order==='app-first') await evaluate(`BroadcastChannel.prototype.postMessage=()=>{
      throw Error('synthetic post-success notification failure');
    }`);
    const before=passwordPosts;
    const beforeReconciliation=await evaluate("window.__authTestOperations.filter(e=>e.kind==='subscription-terminal').length");
    const viewId=await evaluate("window.__authTestOperations.filter(e=>e.kind==='recovery-view-mount').at(-1)?.id");
    assert.match(viewId,/^[0-9a-f-]{36}$/i);
    await submit();
    await waitUntil(()=>Promise.resolve(passwordPosts===before+1),
      'one password request reached guard');
    await waitUntil(()=>Promise.resolve(providerUpdates===(order==='form-first'?1:2)),
      'one password provider update');
    await waitUntil(()=>evaluate("location.pathname==='/'"),
      'confirmed password response completed form success handling');
    await waitUntil(()=>evaluate(`window.__authTestOperations.some(e=>
      e.kind==='recovery-submit-terminal'&&e.viewId===${JSON.stringify(viewId)}
      &&e.outcome==='confirmed')`),'confirmed reset handler completed');
    await waitUntil(()=>evaluate(`window.__authTestOperations.filter(e=>
      e.kind==='subscription-terminal').length>${beforeReconciliation}`),
    'post-success App reconciliation completed');
    assert.equal(await evaluate("!document.body.textContent.includes('This reset link is missing or invalid')"),true,
      'post-success reconciliation cannot show the invalid-link view');
    assert.equal(passwordPosts,before+1,'one password POST per form submission');
    assert.equal(await evaluate("document.querySelector('.reset-password-message--error')===null"),true);
  }
  current={number:10,value:'j'.repeat(43)};
  failNextFormStatus=1;
  await loadRecovery();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-lead--warn')?.textContent.includes('could not verify') && document.querySelector('.reset-password-form button:disabled') && document.querySelector('.reset-password-actions button')?.textContent.includes('Retry verification'))"),
    'initial service failure offers status-only Retry');
  const beforeRetry={status:formStatusGets,password:passwordPosts,email:recoveryEmails,callback:callbackGets};
  await evaluate("document.querySelector('.reset-password-form button').click()");
  assert.equal(passwordPosts,beforeRetry.password,'unverified form cannot submit');
  await evaluate("document.querySelector('.reset-password-actions button').click()");
  await waitUntil(()=>Promise.resolve(formStatusGets===beforeRetry.status+1),'Retry recovery status reached server');
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-form button') && !document.querySelector('.reset-password-form button').disabled)"),
    'status-only Retry verified recovery session');
  assert.equal(passwordPosts,beforeRetry.password,'Retry cannot submit a password');
  assert.equal(recoveryEmails,beforeRetry.email,'Retry cannot send an email');
  assert.equal(callbackGets,beforeRetry.callback,'Retry cannot repeat callback exchange');
  current={number:11,value:'k'.repeat(43)};
  holdForm=true;
  await evaluate("sessionStorage.setItem('recovery-ignore-abort','1')");
  await loadRecovery();
  await waitUntil(()=>Promise.resolve(heldFor(true).length===1),'unmount scenario status held');
  const unmountStatusId=heldFor(true)[0].operationId;
  assert.match(unmountStatusId,/^[0-9a-f-]{36}$/i);
  assert.equal(await evaluate('window.__recoveryAbortIgnored===true'),true,
    'test-only fixture keeps the identified status read pending after unmount');
  const beforeUnmount=passwordPosts;
  await evaluate("document.querySelector('.reset-password-breadcrumb a[href=\"/\"]').click()");
  await waitUntil(()=>evaluate("location.pathname==='/' && !document.querySelector('.reset-password-form')"),
    'reset form unmounted before late status');
  await waitUntil(()=>evaluate(`window.__authTestOperations.some(e=>
    e.kind==='recovery-verification-disposed'&&e.id===${JSON.stringify(unmountStatusId)})`),
  'identified recovery subscription disposed before response release');
  assert.equal(await evaluate(`window.__authTestOperations.some(e=>
    e.kind==='recovery-verification-terminal'&&e.id===${JSON.stringify(unmountStatusId)})`),false,
    'handler acknowledgement must wait for the held response');
  release(true);
  await waitUntil(()=>evaluate(`window.__authTestOperations.some(e=>
    e.kind==='recovery-verification-terminal'&&e.id===${JSON.stringify(unmountStatusId)}
    &&e.outcome==='ignored')`),'late recovery status ignored by real handler');
  assert.deepEqual(await evaluate(`window.__authTestOperations.filter(e=>
    e.kind==='recovery-verification-terminal'&&e.id===${JSON.stringify(unmountStatusId)})
    .map(e=>e.outcome)`),['ignored'],'the identified handler has one terminal decision');
  assert.equal(await evaluate("location.pathname==='/' && !document.querySelector('.reset-password-form')"),true,
    'unmounted form receives no late update');
  assert.equal(passwordPosts,beforeUnmount,'late status after unmount cannot submit');
  current={number:5,value:'d'.repeat(43)};
  await loadRecovery();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-form button') && !document.querySelector('.reset-password-form button').disabled)"),
    'third recovery form ready');
  const readyStatus=await evaluate("fetch('/__stage3/auth/status').then(r=>r.json())");
  assert.equal(readyStatus.authenticated,false);
  assert.equal(readyStatus.recovery,true);
  assert.equal(await evaluate("fetch('/__stage3/protected').then(r=>r.status)"),401);
  const beforeCsrf=providerUpdates;
  const csrfRejected=await evaluate(`fetch('/__stage3/auth/recovery/password',{
    method:'POST',headers:{'Content-Type':'application/json',
      'X-Plannix-Expected-Session':${JSON.stringify(readyStatus.sessionName)},
      'X-Plannix-CSRF':'invalid'},body:JSON.stringify({password:${JSON.stringify(password)}})
  }).then(r=>r.status)`);
  assert.equal(csrfRejected,403);
  assert.equal(providerUpdates,beforeCsrf);
  // Replace the browser cookie without notifying the old form. Its captured version must be rejected.
  current={number:6,value:'e'.repeat(43)};
  await setCookie(cookie().split('=')[0],current.value);
  const beforeStale=passwordPosts;
  await submit();
  await waitUntil(()=>Promise.resolve(passwordPosts===beforeStale+1),'stale request reached guard');
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-lead--warn')?.textContent.includes('missing or invalid') && document.querySelector('.reset-password-message--error')?.textContent.includes('invalid or has expired') && document.querySelector('.reset-password-form button:disabled') && document.querySelector('.reset-password-actions button.reset-password-primary'))"),
    'stale rejection invalidated the ready form');
  assert.equal(providerUpdates,beforeCsrf,'stale recovery form cannot update another session');
  await evaluate("document.querySelector('.reset-password-form button').click()");
  assert.equal(passwordPosts,beforeStale+1,'invalidated form cannot send a second POST');
  current={number:8,value:'g'.repeat(43)};
  await loadRecovery();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-form button') && !document.querySelector('.reset-password-form button').disabled)"),
    'expiry scenario form ready');
  const beforeExpiry=passwordPosts;
  const beforeExpiryCheck=await evaluate("window.__authTestOperations.filter(e=>e.kind==='subscription-terminal').length");
  current={number:0,value:''};
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await waitUntil(()=>evaluate(`window.__authTestOperations.filter(e=>e.kind==='subscription-terminal').length>${beforeExpiryCheck}`),
    'expired recovery status handled by App');
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-lead--warn')?.textContent.includes('missing or invalid') && document.querySelector('.reset-password-form button:disabled'))"),
    'definitive expired status invalidated form');
  await evaluate("document.querySelector('.reset-password-form button').click()");
  assert.equal(passwordPosts,beforeExpiry,'expired form cannot send a password POST');
  assert.equal(providerUpdates,beforeCsrf,'expiry cannot reach provider mutation');
  current={number:7,value:'f'.repeat(43)};
  await loadRecovery();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-form button') && !document.querySelector('.reset-password-form button').disabled)"),
    'final recovery form ready');
  holdPasswordResponse=true;
  await submit();
  await waitUntil(()=>Promise.resolve(Boolean(heldPasswordResponse)),
    '204 response held after provider and logout');
  const beforeChange=await evaluate("window.__authTestOperations.filter(e=>e.kind==='subscription-terminal').length");
  await evaluate("new BroadcastChannel('plannix-server-session').postMessage({changed:true})");
  await waitUntil(()=>evaluate(`window.__authTestOperations.filter(e=>
    e.kind==='subscription-terminal').length>${beforeChange}`),
    'cross-tab change processed before response release');
  const releasePassword=heldPasswordResponse;
  heldPasswordResponse=null;holdPasswordResponse=false;releasePassword();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-card--success'))"),
    'confirmed 204 remains a success after session change');
  assert.equal(await evaluate("location.pathname==='/reset-password'"),true,
    'old recovery completion does not redirect a newer context');
  assert.equal(await evaluate("document.querySelector('.reset-password-message--error')===null"),true);
  assert.equal(providerUpdates,3,'a confirmed late response represents one accepted password update');
  // React Router accepts trailing slashes and case variants. Both must retain
  // the confirmed view through the real App reconciliation path.
  for(const [index,pathname] of ['/reset-password/','/RESET-PASSWORD/'].entries()){
  ordinaryMode=false;
  current={number:12+index,value:(index?'o':'n').repeat(43)};
  await setCookie(ordinaryCookie().split('=')[0],ordinaryCookie().split('=')[1]);
  await loadRecovery(pathname);
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-form button') && !document.querySelector('.reset-password-form button').disabled)"),
    'account-change recovery form ready');
  const changingViewId=await evaluate("window.__authTestOperations.filter(e=>e.kind==='recovery-view-mount').at(-1)?.id");
  const beforeChangingPassword=passwordPosts;
  const beforeChangingProvider=providerUpdates;
  holdPasswordResponse=true;
  holdApp=true;
  await submit();
  await waitUntil(()=>Promise.resolve(Boolean(heldPasswordResponse)),
    'account-change 204 held after one provider update');
  ordinaryMode=true;
  await evaluate("new BroadcastChannel('plannix-server-session').postMessage({changed:true})");
  await waitUntil(()=>Promise.resolve(heldFor(false).length>=1),
    'account-change App status reached its hold point');
  const changingStatusId=heldFor(false)[0].operationId;
  const releaseChangingPassword=heldPasswordResponse;
  heldPasswordResponse=null;holdPasswordResponse=false;releaseChangingPassword();
  await waitUntil(()=>evaluate(`window.__authTestOperations.some(e=>
    e.kind==='recovery-submit-terminal'&&e.viewId===${JSON.stringify(changingViewId)}
    &&e.outcome==='confirmed-session-changed')`),'successful reset handler finished before App adoption');
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-card--success'))"),
    'confirmed reset success rendered before App adoption');
  release(false);
  await waitUntil(()=>evaluate(`window.__authTestOperations.some(e=>
    e.kind==='subscription-terminal'&&e.id===${JSON.stringify(changingStatusId)}
    &&e.outcome==='authenticated')`),'changed-account App subscriber completed');
  await waitUntil(()=>evaluate("document.querySelector('.nav-user-name')?.textContent==='Synthetic Teacher'"),
    'changed account committed to the real App header');
  assert.equal(passwordPosts,beforeChangingPassword+1,'account change cannot repeat password POST');
  assert.equal(providerUpdates,beforeChangingProvider+1,'account change cannot repeat provider update');
  const postAdoption=await evaluate(`({success:Boolean(document.querySelector('.reset-password-card--success')),
    oldViewUnmounted:window.__authTestOperations.some(e=>
      e.kind==='recovery-view-unmount'&&e.id===${JSON.stringify(changingViewId)}),
    invalid:document.body.textContent.includes('This reset link is missing or invalid')})`);
  assert.equal(postAdoption.success,true,
    `confirmed recovery success survives App account adoption: ${JSON.stringify(postAdoption)}`);
  assert.equal(postAdoption.oldViewUnmounted,false,
    'App account adoption must not remount the completed reset view');
  assert.equal(await evaluate(`location.pathname===${JSON.stringify(pathname)}`),true,
    'a newer account does not redirect the completed recovery operation');
  assert.equal(await evaluate("!document.body.textContent.includes('This reset link is missing or invalid')"),true);
  }
  await cdp('Page.navigate',{url:`${origin}/reset-password`},tab);
  ordinaryMode=false;
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-lead--warn') && document.querySelector('.reset-password-form button:disabled'))"),
    'invalid recovery view after logout');
  const ineligible=await evaluate("fetch('/__stage3/auth/status').then(async r=>({http:r.status,...await r.json()}))");
  assert.equal(ineligible.http,200,'status transport succeeded');
  assert.equal(ineligible.authenticated,false);
  assert.notEqual(ineligible.recovery,true,'200 does not imply recovery eligibility');
  const beforeInvalid=passwordPosts;
  await evaluate("document.querySelector('.reset-password-form button').click()");
  assert.equal(passwordPosts,beforeInvalid,'an ineligible 200 status cannot send a reset POST');
  current={number:9,value:'h'.repeat(43)};
  await loadRecovery();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-form button') && !document.querySelector('.reset-password-form button').disabled)"),
    'uncertain outcome form ready');
  failProvider=true;
  const beforeUncertain=passwordPosts;
  await submit();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-lead--warn') && document.querySelector('.reset-password-form button:disabled') && document.querySelector('.reset-password-message--error')?.textContent.includes('could not confirm'))"),
    'provider uncertainty displayed without claiming definite failure');
  await evaluate("document.querySelector('.reset-password-form button').click()");
  assert.equal(passwordPosts,beforeUncertain+1,'uncertain mutation is never replayed');
  // A can have protected provider state when entering the reset route. The
  // route itself cannot authorize a recovery form from A's ordinary cookie.
  failProvider=false;ordinaryMode=true;ordinaryOwner=owner;ordinaryVersion=30;
  await setCookie(ordinaryCookie().split('=')[0],ordinaryCookie().split('=')[1]);
  await cdp('Page.navigate',{url:`${origin}/reset-password/`},tab);
  await waitUntil(()=>evaluate(`window.__recoveryPlanner?.state().userId===${JSON.stringify(owner)}
    &&window.__recoveryPlanner.state().yearId===${JSON.stringify(ids.year)}
    &&window.__recoveryPlanner.state().classes.includes('A private class')`),
  'A planner data loaded in the real mounted providers on recovery route');
  const aProvider=await evaluate('window.__recoveryPlanner.instance');
  await evaluate("window.__recoveryPlanner.loadDate('2026-10-19')");
  await waitUntil(()=>evaluate("window.__recoveryPlanner.state().datedTitle==='A private lesson'"),
    'A dated lesson loaded in the real provider');
  await evaluate("window.__recoveryPlanner.draft('A private draft')");
  await waitUntil(()=>evaluate("window.__recoveryPlanner.state().classes.includes('A private draft')"),
    'A class draft exists before account replacement');
  const writesBeforeA=plannerWrites.length;
  holdPlannerSave=true;
  assert.equal(await evaluate("window.__recoveryPlanner.edit('A accepted edit')"),true);
  await waitUntil(()=>Promise.resolve(heldPlannerSaves.length===1),'A guarded save held at RPC');
  assert.equal(await evaluate("window.__recoveryPlanner.edit('A queued edit')"),true);
  assert.equal(plannerWrites.length,writesBeforeA+1,
    'queued A edit has not dispatched behind the accepted A request');
  ordinaryOwner=otherOwner;ordinaryVersion=31;
  await setCookie(ordinaryCookie().split('=')[0],ordinaryCookie().split('=')[1]);
  await evaluate("new BroadcastChannel('plannix-server-session').postMessage({changed:true})");
  await waitUntil(()=>evaluate(`document.querySelector('.nav-user-name')?.textContent==='Other Teacher'
    &&window.__recoveryPlanner?.state().userId===${JSON.stringify(otherOwner)}
    &&window.__recoveryPlanner.state().classes.includes('B class')`),
  'real App adopted B and reset A provider drafts on recovery route');
  assert.equal(await evaluate("window.__recoveryPlanner.instance"),aProvider,
    'reset route remains mounted while B replaces A');
  assert.equal(await evaluate("!window.__recoveryPlanner.state().classes.includes('A private draft')"),true);
  assert.equal(plannerWrites.length,writesBeforeA+1,
    'account replacement discarded the queued A edit without dispatch');
  await waitUntil(()=>evaluate(`window.__timetableOperations.some(event=>
    event.kind==='save-terminal'&&event.title==='A queued edit'
    &&event.outcome==='discarded')`),'A queued edit discarded by provider reset');
  assert.equal(plannerWrites.at(-1).sessionName,'__Host-plannix-s-30',
    'the already accepted A save retained its original expected session');
  await evaluate(`(() => {
    window.__recoveryRouteLeaks=[];
    window.__recoveryRouteObserver=new MutationObserver(() => {
      if(location.pathname==='/timetable' && /A private (draft|class|lesson)|A queued edit|A accepted edit/
        .test(document.body.innerText))window.__recoveryRouteLeaks.push('stale content');
    });
    window.__recoveryRouteObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  })()`);
  await evaluate("document.querySelector('a[href=\"/timetable\"]')?.click()");
  await waitUntil(()=>evaluate(`location.pathname==='/timetable'
    &&window.__recoveryPlanner?.instance!==${aProvider}
    &&window.__recoveryPlanner.state().userId===${JSON.stringify(otherOwner)}
    &&window.__recoveryPlanner.state().classes.includes('B class')`),
  'leaving recovery rekeyed providers before B timetable became visible');
  await evaluate("window.__recoveryPlanner.loadDate('2026-10-19')");
  await waitUntil(()=>evaluate("window.__recoveryPlanner.state().datedTitle==='B lesson'"),
    'B timetable is authoritative after route exit');
  assert.deepEqual(await evaluate("window.__recoveryRouteObserver.disconnect();window.__recoveryRouteLeaks"),[],
    'no A planner text became visible on the protected route before B rekey');
  const bState=await evaluate("window.__recoveryPlanner.state()");
  assert.equal(plannerWrites.filter(item=>item.owner===otherOwner).length,0,
    'no queued A work dispatched under B');
  holdPlannerSave=false;heldPlannerSaves.shift().release();
  await waitUntil(()=>evaluate(`window.__timetableOperations.some(event=>
    event.kind==='save-terminal'&&event.title==='A accepted edit'
    &&event.outcome==='stale')`),'late accepted A save reached the real stale terminal handler');
  assert.equal(await evaluate("window.__recoveryPlanner.state().datedTitle"),bState.datedTitle,
    'late A completion cannot replace B timetable');
  assert.equal(await evaluate("window.__recoveryPlanner.state().classes.includes('A private draft')"),false,
    'late A completion cannot restore A drafts');
  assert.equal(plannerWrites.filter(item=>item.owner===otherOwner).length,0,
    'late A completion cannot trigger a B mutation');
  // A confirmed reset formerly rendered the invalid-link warning for the entire
  // submitting state. Observe every rendered message while its real response is held.
  ordinaryMode=false;current={number:23,value:'s'.repeat(43)};
  holdApp=false;holdForm=false;held=[];
  await loadRecovery();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-form button') && !document.querySelector('.reset-password-form button').disabled)"),
    'confirmed-path recovery form ready');
  await evaluate(`(() => {
    window.__recoveryMessageTrace=[];
    const record=()=>{
      const entry={path:location.pathname,
        saving:Boolean(document.querySelector('.reset-password-lead[role="status"]')?.textContent
          .includes('Saving your new password…')),
        invalid:document.body.textContent.includes('This reset link is missing or invalid'),
        uncertain:document.body.textContent.includes('could not confirm whether your password changed'),
        error:Boolean(document.querySelector('.reset-password-message--error'))};
      if(JSON.stringify(entry)!==JSON.stringify(window.__recoveryMessageTrace.at(-1)))
        window.__recoveryMessageTrace.push(entry);
    };
    window.__recoveryMessageObserver=new MutationObserver(record);
    window.__recoveryMessageObserver.observe(document.body,
      {subtree:true,childList:true,characterData:true});
    record();
  })()`);
  const successViewId=await evaluate("window.__authTestOperations.filter(e=>e.kind==='recovery-view-mount').at(-1)?.id");
  assert.match(successViewId,/^[0-9a-f-]{36}$/i);
  const beforeSuccess={posts:passwordPosts,updates:providerUpdates,
    subscriptions:await evaluate("window.__authTestOperations.filter(e=>e.kind==='subscription-terminal').length")};
  holdPasswordResponse=true;
  await submit();
  await waitUntil(()=>Promise.resolve(Boolean(heldPasswordResponse)),
    'confirmed-path response held after provider update and revocation');
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-lead[role=\"status\"]')?.textContent.includes('Saving your new password…') && document.querySelector('.reset-password-form button:disabled'))"),
    'neutral saving message rendered while response is pending');
  await evaluate("document.querySelector('.reset-password-form button').click()");
  assert.equal(passwordPosts,beforeSuccess.posts+1,'disabled Save cannot repeat a pending password POST');
  assert.equal(providerUpdates,beforeSuccess.updates+1,'one provider update before response release');
  const heldMessages=await evaluate("window.__recoveryMessageTrace");
  assert.equal(heldMessages.some(entry=>entry.saving),true);
  assert.equal(heldMessages.some(entry=>entry.invalid||entry.uncertain||entry.error),false,
    'pending confirmed reset never presents a definitive or uncertain warning');
  const releaseConfirmed=heldPasswordResponse;
  heldPasswordResponse=null;holdPasswordResponse=false;releaseConfirmed();
  await waitUntil(()=>evaluate(`window.__authTestOperations.some(e=>
    e.kind==='recovery-submit-terminal'&&e.viewId===${JSON.stringify(successViewId)}
    &&e.outcome==='confirmed')`),'confirmed reset handler terminal decision');
  await waitUntil(()=>evaluate(`window.__authTestOperations.filter(e=>
    e.kind==='subscription-terminal').slice(${beforeSuccess.subscriptions})
    .some(e=>e.outcome==='signed-out')`),'post-reset App subscriber signed-out decision');
  await waitUntil(()=>evaluate("location.pathname==='/'"),'intentional Home/login navigation');
  await waitUntil(()=>evaluate(`window.__authTestOperations.some(e=>
    e.kind==='recovery-view-unmount'&&e.id===${JSON.stringify(successViewId)})`),
    'confirmed reset view unmounted after Home navigation');
  const completeMessages=await evaluate("window.__recoveryMessageObserver.disconnect();window.__recoveryMessageTrace");
  assert.equal(completeMessages.some(entry=>entry.invalid||entry.uncertain||entry.error),false,
    'confirmed 204 cannot show a transient invalid or uncertain message');
  assert.equal(passwordPosts,beforeSuccess.posts+1,'one password POST through Home navigation');
  assert.equal(providerUpdates,beforeSuccess.updates+1,'one provider update through Home navigation');
  current={number:25,value:'u'.repeat(43)};
  await loadRecovery();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-form button') && !document.querySelector('.reset-password-form button').disabled)"),
    'concurrent-status recovery form ready');
  await evaluate(`(() => {
    window.__heldRecoveryWarnings=[];
    const record=()=>window.__heldRecoveryWarnings.push({
      invalid:document.body.textContent.includes('This reset link is missing or invalid'),
      uncertain:document.body.textContent.includes('could not confirm whether your password changed'),
      saving:document.body.textContent.includes('Saving your new password…')});
    window.__heldRecoveryObserver=new MutationObserver(record);
    window.__heldRecoveryObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
    record();
  })()`);
  const concurrentViewId=await evaluate("window.__authTestOperations.filter(e=>e.kind==='recovery-view-mount').at(-1)?.id");
  const beforeConcurrent=passwordPosts;
  holdPasswordResponse=true;
  await submit();
  await waitUntil(()=>Promise.resolve(Boolean(heldPasswordResponse)),
    'concurrent-status 204 held after provider update and revocation');
  const beforeConcurrentStatus=await evaluate("window.__authTestOperations.filter(e=>e.kind==='subscription-terminal').length");
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await waitUntil(()=>evaluate(`window.__authTestOperations.filter(e=>
    e.kind==='subscription-terminal').slice(${beforeConcurrentStatus})
    .some(e=>e.outcome==='signed-out')`),
    'concurrent signed-out status applied before 204 release');
  assert.equal(await evaluate("Boolean(document.querySelector('.reset-password-lead[role=\"status\"]')?.textContent.includes('Saving your new password…') && document.querySelector('.reset-password-form button:disabled'))"),true,
    'status invalidates recovery authority without replacing pending saving text');
  await evaluate("document.querySelector('.reset-password-form button').click()");
  assert.equal(passwordPosts,beforeConcurrent+1,'invalidated pending form cannot submit again');
  const releaseConcurrent=heldPasswordResponse;
  heldPasswordResponse=null;holdPasswordResponse=false;releaseConcurrent();
  await waitUntil(()=>evaluate(`window.__authTestOperations.some(e=>
    e.kind==='recovery-submit-terminal'&&e.viewId===${JSON.stringify(concurrentViewId)}
    &&e.outcome==='confirmed-session-changed')`),
    'confirmed 204 handled after concurrent invalidation');
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-card--success'))"),
    'confirmed success remains visible without redirecting changed context');
  const concurrentWarnings=await evaluate("window.__heldRecoveryObserver.disconnect();window.__heldRecoveryWarnings");
  assert.equal(concurrentWarnings.some(entry=>entry.invalid||entry.uncertain),false,
    'concurrent status cannot flash invalid or uncertain text before confirmed success');
  assert.equal(concurrentWarnings.some(entry=>entry.saving),true);
  assert.equal(passwordPosts,beforeConcurrent+1);
  current={number:24,value:'t'.repeat(43)};
  failProvider=true;
  await loadRecovery();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-form button') && !document.querySelector('.reset-password-form button').disabled)"),
    'provider-failure recovery form ready');
  const beforeFailedPost=passwordPosts;
  holdPasswordResponse=true;
  await submit();
  await waitUntil(()=>Promise.resolve(Boolean(heldPasswordResponse)),
    'provider-failure response held');
  current={number:0,value:''};
  const beforeFailedStatus=await evaluate("window.__authTestOperations.filter(e=>e.kind==='subscription-terminal').length");
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await waitUntil(()=>evaluate(`window.__authTestOperations.filter(e=>
    e.kind==='subscription-terminal').slice(${beforeFailedStatus})
    .some(e=>e.outcome==='signed-out')`),
  'concurrent signed-out status applied before failed response');
  assert.equal(await evaluate("Boolean(document.querySelector('.reset-password-lead[role=\"status\"]')?.textContent.includes('Saving your new password…') && document.querySelector('.reset-password-form button:disabled'))"),true,
    'pending provider failure remains neutral until its response settles');
  const releaseFailed=heldPasswordResponse;
  heldPasswordResponse=null;holdPasswordResponse=false;releaseFailed();
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-lead--warn')?.textContent.includes('could not confirm whether your password changed') && document.querySelector('.reset-password-form button:disabled'))"),
    'failed provider response settles as uncertain after status invalidation');
  await evaluate("document.querySelector('.reset-password-form button').click()");
  assert.equal(passwordPosts,beforeFailedPost+1,'uncertain mutation is not replayed');
  failProvider=false;
  console.log('Rendered recovery proof passed: route variants, A-to-B planner rekey and queued-work discard, status-only Retry, unmount, CSRF, ordinary isolation and late 204.');
} catch(error){failure=error;} finally {
  const cleanupErrors=[];
  const cleanup=async task=>{try{await task();}catch(error){cleanupErrors.push(error);}};
  await cleanup(async()=>{for(const item of held)item.release();});
  await cleanup(async()=>heldPasswordResponse?.());
  await cleanup(async()=>{for(const item of heldPlannerSaves)item.release();});
  await cleanup(async()=>socket?.close());
  let stopped=!chrome||chrome.exitCode!==null||chrome.signalCode!==null;
  await cleanup(async()=>{if(chrome&&!stopped){
    const awaitExit=ms=>new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),ms);
      chrome.once('exit',()=>{clearTimeout(timer);resolve(true);});});
    let exited=awaitExit(3000);chrome.kill('SIGTERM');stopped=await exited;
    if(!stopped){exited=awaitExit(3000);chrome.kill('SIGKILL');stopped=await exited;}
    if(!stopped)throw Error('Chrome did not exit before cleanup.');
  }});
  await cleanup(async()=>{if(server){server.closeAllConnections();
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}});
  if(stopped)await cleanup(()=>rm(work,{recursive:true,force:true,maxRetries:12,retryDelay:150}));
  if(cleanupErrors.length){if(failure)console.error('Cleanup errors after primary assertion:',cleanupErrors);
    else failure=new AggregateError(cleanupErrors,'Recovery browser cleanup failed.');}
}
if(failure)throw failure;
