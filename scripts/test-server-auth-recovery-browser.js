// Synthetic rendered recovery test: real App, controller, transport, router and guard.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { createServerSessionRouter } from '../server/auth/serverSessionRouter.js';
import { createRequireServerSession } from '../server/auth/requireServerSession.js';

const markerName='__Host-plannix-b-1';
const markerValue='a'.repeat(43);
const marker=`${markerName}=${markerValue}`;
const owner='dd000000-0000-4000-8000-000000000001';
const work=await mkdtemp(path.join(tmpdir(),'plannix-recovery-browser-'));
let server;let chrome;let socket;let failure;
let held=[];let holdApp=false;let holdForm=false;
let holdPasswordResponse=false;let heldPasswordResponse=null;
let failNextFormStatus=0;let formStatusGets=0;let recoveryEmails=0;let callbackGets=0;
let current={number:3,value:'b'.repeat(43)};
let passwordPosts=0;let providerUpdates=0;let failProvider=false;
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
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','build',
      '--mode','stage4-app-browser-test','--outDir',path.join(work,'dist'),'--emptyOutDir'],{
      cwd:process.cwd(),env:{...process.env,VITE_PLANNIX_AUTH_MODE:'server',
        VITE_API_BASE_URL:origin},stdio:['ignore','ignore','pipe']});
    child.stderr.resume();child.once('error',reject);
    child.once('exit',code=>code===0?resolve():reject(Error('Recovery browser build failed.')));
  });
  const htmlPath=path.join(work,'dist','index.html');
  const html=await readFile(htmlPath,'utf8');
  await writeFile(htmlPath,html.replace('<script type="module"',
    `<script>window.__authTestOperations=[];
      window.__plannixAuthTestObserver=event=>window.__authTestOperations.push(event);
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
      const selected=header.includes(cookie())?cookie():null;
      return {state:'selected',header:[marker,selected].filter(Boolean).join('; '),
        markerName,sessionName:selected?.split('=')[0]||null,cleanup:[]};
    },
    async readTokens(header,kind){
      if(!header?.includes(cookie()))return {state:'absent'};
      if(kind!=='recovery')return {state:'wrong-kind'};
      return {state:'current',ownerId:owner,accessToken:'synthetic-access',
        refreshToken:'synthetic-refresh',tokenVersion:1};
    },
    async inspect(header,kind){const found=await this.readTokens(header,kind);
      return found.state==='current'?{state:'current',ownerId:owner}:found;},
    async resolveForApplication(header){const selected=await this.resolve(header);
      return selected.state==='selected'&&selected.sessionName?{state:'wrong-kind'}:selected;},
    async logout(header){if(!header?.includes(cookie()))return {state:'absent'};
      const name=cookie().split('=')[0];current={number:0,value:''};
      return {state:'revoked',cleanup:name};},
  };
  const identity={
    async login(){throw Error('Unexpected provider login');},
    async validateAccess(){throw Error('Recovery must not validate as ordinary access');},
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
  app.get('/__stage3/protected',createRequireServerSession(boundary),
    (req,res)=>res.json({userId:req.serverSession.userId}));
  app.use(express.static(path.join(work,'dist')));
  app.get(/.*/,(req,res)=>res.sendFile(path.join(work,'dist','index.html')));
  server=createServer(app);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'localhost',resolve);});
  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless','--disable-background-networking','--disable-component-update',
      '--no-first-run','--disable-gpu','--remote-debugging-port=0',
      `--user-data-dir=${path.join(work,'chrome')}`,'about:blank'],
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
  const loadRecovery=async()=>{
    await setCookie(cookie().split('=')[0],current.value);
    await cdp('Page.navigate',{url:`${origin}/reset-password`},tab);
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
    await submit();
    await waitUntil(()=>Promise.resolve(passwordPosts===before+1),
      'one password request reached guard');
    await waitUntil(()=>Promise.resolve(providerUpdates===(order==='form-first'?1:2)),
      'one password provider update');
    await waitUntil(()=>evaluate("location.pathname==='/'"),
      'confirmed password response completed form success handling');
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
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-lead--warn') && document.querySelector('.reset-password-form button:disabled') && document.querySelector('.reset-password-actions button.reset-password-primary'))"),
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
  await waitUntil(()=>evaluate("Boolean(document.querySelector('.reset-password-lead--warn') && document.querySelector('.reset-password-form button:disabled'))"),
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
  await cdp('Page.navigate',{url:`${origin}/reset-password`},tab);
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
  console.log('Rendered recovery proof passed: response orders, status-only Retry, confirmed invalid status, unmount, expiry/replacement, no second POST, provider uncertainty, CSRF, ordinary isolation and late 204.');
} catch(error){failure=error;} finally {
  const cleanupErrors=[];
  const cleanup=async task=>{try{await task();}catch(error){cleanupErrors.push(error);}};
  await cleanup(async()=>{for(const item of held)item.release();});
  await cleanup(async()=>heldPasswordResponse?.());
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
