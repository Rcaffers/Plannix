// Actual Express route + PostgREST + PostgreSQL. Synthetic, unlinked DB only.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {build} from 'vite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createRequireServerSession} from '../server/auth/requireServerSession.js';
import {spawnSync,spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import express from 'express';
import {createClient} from '@supabase/supabase-js';
import {verifyLocalDocker} from './test-academic-year-migration.js';
import {createPrivateSessionRepository} from '../server/auth/privateSessionRepository.js';
import {createServerSessionRouter} from '../server/auth/serverSessionRouter.js';
import {createBrowserResetProofs,orphanContext} from '../server/auth/browserSignInReset.js';
const [project,workdir,cli]=process.argv.slice(2);
assert.match(project||'',/^plannix-reset-guard-[a-z0-9_-]+$/);
assert.equal(path.basename(workdir),project);
assert.equal(existsSync(path.join(workdir,'supabase/.temp/project-ref')),false);
const target=verifyLocalDocker({project,workdir});
const args=[...target.prefix,'exec','-i',target.containerId,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
function sql(text){const r=spawnSync('docker',args,{input:text,encoding:'utf8',env:target.env,timeout:10000});assert.equal(r.status,0,'disposable SQL failed');return r.stdout.trim();}
const status=spawnSync(cli,['status','-o','json'],{cwd:workdir,encoding:'utf8',env:target.env});
assert.equal(status.status,0,'local status failed');
const local=JSON.parse(status.stdout);
assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
// Local-only JWT signed using this disposable PostgREST instance's key.
const inspect=JSON.parse(spawnSync('docker',[...target.prefix,'inspect','supabase_rest_'+project],{env:target.env,encoding:'utf8'}).stdout)[0];
const secret=inspect.Config.Env.find(x=>x.startsWith('PGRST_JWT_SECRET=')).slice('PGRST_JWT_SECRET='.length);
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const jwk=JSON.parse(secret).keys.find(k=>k.kty==='oct');
assert.ok(jwk);
const unsigned=encode({alg:'HS256',typ:'JWT',...(jwk.kid?{kid:jwk.kid}:{})})+'.'+encode({role:'service_role',exp:Math.floor(Date.now()/1000)+3600});
const serviceKey=unsigned+'.'+createHmac('sha256',Buffer.from(jwk.k,'base64url')).update(unsigned).digest('base64url');
const client=createClient(local.API_URL,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

let failConfirmation=false;
const repository=createPrivateSessionRepository({rpc:(name,args)=>{if(failConfirmation && name==='plannix_auth_confirm_orphan_reset')throw Error('synthetic confirmation failure');return client.rpc(name,args);},cipher:{encrypt:()=>({}),decrypt:()=> 'synthetic-token'}});
const initialBindings=JSON.parse(sql("select coalesce(json_agg(id),'[]'::json) from private.plannix_auth_browser_bindings;"));
const owner='dd000000-0000-4000-8000-000000000098';
assert.equal(sql(`select count(*) from auth.users where id='${owner}';`),'0');
sql(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','browser-reset@example.test',now());`);
const work=await mkdtemp(path.join(tmpdir(),'plannix-reset-chrome-'));
const key=Buffer.alloc(32,12);let chrome,socket,server;let releaseLogin,releaseReset;
let loginHeld=false,resetHeld=false,holdLogin=false,holdReset=false,loginCalls=0,resetRequests=0;
const identity={
 async login({password}){loginCalls++;if(password!=='synthetic-password')throw {kind:'credentials'};
  if(holdLogin){holdLogin=false;await new Promise(r=>{releaseLogin=r;loginHeld=true;});}
  return {user:{id:owner,name:'Synthetic Teacher'},session:{access_token:'synthetic-access',refresh_token:'synthetic-refresh'}};
 },
 async validateAccess({expectedUserId}){assert.equal(expectedUserId,owner);return {id:owner};},
 async loadCurrentUser({expectedUserId}){assert.equal(expectedUserId,owner);return {
   id:owner,organisationId:'dd000000-0000-4000-8000-000000000099',name:'Synthetic Teacher',
   email:'browser-reset@example.test',firstName:'Synthetic',lastName:'Teacher',initials:'ST'};},
};
const app=express();
try {
 await build({configFile:false,envDir:work,logLevel:'error',define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_PLANNIX_AUTH_MODE':'"server"'},
   esbuild:{jsx:'automatic'},build:{outDir:path.join(work,'dist'),emptyOutDir:true,lib:{entry:'src/components/Header.browser-reset-test.jsx',formats:['iife'],name:'ResetFixture',fileName:()=> 'test.js',cssFileName:'test'}}});
 await writeFile(path.join(work,'dist','index.html'),'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/test.css"><div id="root"></div><script src="/test.js"></script>');
 server=app.listen(0,'localhost');await new Promise(r=>server.once('listening',r));
 const origin=`http://localhost:${server.address().port}`;
 const options={repository,identity,origin,csrfKey:key,limiter:{check:async()=>{}},providerDeadlineMs:15000};
 app.use((req,res,next)=>{
   if(req.path==='/__stage3/auth/browser-reset'){
     resetRequests++;
     const end=res.end.bind(res);
     res.end=(...args)=>{if(holdReset && res.statusCode===204){holdReset=false;resetHeld=true;releaseReset=()=>end(...args);return res;}return end(...args);};
   }
   next();
 });
 app.use('/__stage3/auth',createServerSessionRouter(options));
 app.get('/protected',createRequireServerSession(options),(req,res)=>res.json({authenticated:true}));
 app.use(express.static(path.join(work,'dist')));
 const profile=path.join(work,'chrome');
 chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
   ['--headless','--disable-gpu','--disable-background-networking','--disable-component-update','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,origin],{stdio:['ignore','ignore','pipe']});
 const ws=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chrome startup timeout')),15000);chrome.once('error',reject);chrome.stderr.on('data',b=>{const m=String(b).match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 socket=new WebSocket(ws);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let serial=0;const pending=new Map();
 socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error('CDP '+p.method+' failed ('+m.error.code+')')):p.resolve(m.result);};
 const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},15000);pending.set(id,{resolve,reject,timer,method});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const evaluate=async(session,expression)=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);if(r.exceptionDetails)throw Error('Browser fixture evaluation failed');return r.result.value;};
 const until=async(f,label)=>{const end=Date.now()+10000;while(Date.now()<end){if(await f())return;await new Promise(r=>setTimeout(r,25));}throw Error('Missing barrier: '+label);};
 const targetFor=new Map();
 const attach=async()=>{const {targetId}=await cdp('Target.createTarget',{url:origin});const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});targetFor.set(sessionId,targetId);await until(()=>evaluate(sessionId,'window.__browserResetFixtureReady===true'),'rendered fixture');return sessionId;};
 const tabA=await attach(),tabB=await attach(); // SAME Chrome cookie jar, no isolated contexts.
 const buttons=(label)=>`[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(label)})`;
 const click=async(tab,label)=>{await cdp('Target.activateTarget',{targetId:targetFor.get(tab)});await evaluate(tab,`${buttons(label)}.click()`);};
 const input=async(tab,id,value)=>evaluate(tab,`(()=>{const n=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const fill=async tab=>{await click(tab,'Login');await input(tab,'login-email','browser-reset@example.test');await input(tab,'login-password','synthetic-password');};
 const submit=tab=>evaluate(tab,"document.querySelector('.login-form').requestSubmit();true");
 const resetVisible=tab=>evaluate(tab,`!!${buttons('Reset sign-in on this browser')}`);
 const cookieNames=async()=> (await cdp('Storage.getCookies')).cookies.filter(c=>c.domain==='localhost').map(c=>c.name).sort();
 const seedOrphan=async()=>{const generation=sql("select nextval('private.plannix_auth_generation_seq');");const name='__Host-plannix-s-'+generation;
   const r=await cdp('Network.setCookie',{name,value:'z'.repeat(43),url:origin,path:'/',secure:true,httpOnly:true,sameSite:'Lax'},tabA);assert.ok(r.success);return {generation,name};};
 const reload=async tab=>{await cdp('Page.navigate',{url:origin},tab);await until(()=>evaluate(tab,'window.__browserResetFixtureReady===true'),'reload');};

 // First reproduce the concrete two-tab race. B's ordinary Login is admitted
 // before the orphan appears; its provider completion is deliberately held.
 await fill(tabB);holdLogin=true;await submit(tabB);await until(()=>loginHeld,'B admitted Login');
 // Construct the confirmed missing-binding fixture after B's request was
 // admitted. Keep the synthetic marker privately, then restore it before B's
 // newer response: this isolates late-deletion safety from marker availability.
 const bindingCookie=(await cdp('Storage.getCookies')).cookies.find(c=>c.domain==='localhost' && c.name.startsWith('__Host-plannix-b-'));
 assert.ok(bindingCookie);
 await cdp('Network.deleteCookies',{name:bindingCookie.name,url:origin},tabA);
 const old=await seedOrphan();const before=await cookieNames();
 await fill(tabA);await submit(tabA);await until(()=>resetVisible(tabA),'eligible-only reset button');
 holdReset=true;await click(tabA,'Reset sign-in on this browser');await until(()=>resetHeld,'A committed/confirmed reset response held');
 assert.equal(sql(`select count(*) from private.plannix_auth_retired_generations where generation=${old.generation};`),'1');
 assert.equal(await evaluate(tabA,`${buttons('Reset sign-in on this browser')}.disabled`),true);
 await click(tabA,'Reset sign-in on this browser');assert.equal(resetRequests,1,'pending reset cannot submit twice');
 assert.ok((await cookieNames()).includes(old.name),'held response has not deleted orphan');
 await cdp('Network.setCookie',{name:bindingCookie.name,value:bindingCookie.value,url:origin,path:'/',secure:true,httpOnly:true,sameSite:'Lax'},tabA);
 releaseLogin();releaseLogin=null;
 // The shipped controller cannot verify status while the unknown orphan is
 // still in the jar. Its server login nevertheless committed and set a new cookie.
 await until(()=>evaluate(tabB,"window.__browserResetLoginTerminal==='failed'"),'B controller reports verification blocked by orphan');
 assert.equal(await resetVisible(tabB),false,'post-login generic 401 does not offer reset');
 const newerName='__Host-plannix-s-'+sql(`select generation from private.plannix_auth_sessions where owner_id='${owner}' and not revoked and not expired order by generation desc limit 1;`);
 await until(async()=> (await cookieNames()).includes(newerName),'newer cookie stored by Chrome');
 const during=await cookieNames();assert.ok(during.includes(old.name));assert.notEqual(newerName,old.name);
 releaseReset();releaseReset=null;
 await until(async()=> !(await cookieNames()).includes(old.name),'Chrome processed old exact-name deletion');
 const after=await cookieNames();assert.deepEqual(after,during.filter(name=>name!==old.name));
 assert.ok(after.includes(newerName));assert.ok(after.includes(bindingCookie.name));assert.ok(before.includes(old.name));
 assert.equal(await evaluate(tabB,'window.__browserResetVerify()'),'authenticated','shipped controller verifies the newer session after orphan deletion');
 const protectedCheck=await evaluate(tabB,`(async()=>{const status=await fetch('/__stage3/auth/status').then(r=>r.json());const r=await fetch('/protected',{headers:{'X-Plannix-Expected-Session':status.sessionName}});return {ordinary:status.authenticated===true,HTTP:r.status};})()`);
 assert.deepEqual(protectedCheck,{ordinary:true,HTTP:200});
 assert.equal(await evaluate(tabA,'window.__browserResetVerify()'),'authenticated');
 await until(()=>evaluate(tabA,'!document.querySelector(".login-modal")'),'verified newer session closes obsolete reset UI');
 assert.equal(await evaluate(tabA,"document.body.textContent.includes('Browser sign-in reset. Click Login')"),false,'verified replacement suppresses obsolete reset feedback');
 console.log('Real two-tab Chrome: delayed deletion removes only orphan; newer server login survives; shipped controller verifies it after deletion and protected request returns 200.');

 // Test ordinary single-tab UI completion, explicit Login, failed reset feedback,
 // generic 401 exclusion and mobile layout, using only disposable state/cookies.
 await cdp('Network.clearBrowserCookies',{},tabA);await reload(tabA);await reload(tabB);
 await seedOrphan();await fill(tabA);await submit(tabA);await until(()=>resetVisible(tabA),'fresh eligible offer');
 await click(tabA,'Reset sign-in on this browser');
 await until(()=>evaluate(tabA,"document.body.textContent.includes('Browser sign-in reset. Click Login')"),'explicit login instruction');
 await until(()=>evaluate(tabA,"document.activeElement?.type==='submit' && document.activeElement?.textContent.trim()==='Login'"),'focus returns to normal Login after reset');
 assert.equal(loginCalls,1,'reset does not replay Login credentials');
 await submit(tabA);await until(()=>evaluate(tabA,'!document.querySelector(".login-modal")'),'normal explicit Login');
 assert.equal(loginCalls,2);
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},tabA);
 await cdp('Network.clearBrowserCookies',{},tabA);await reload(tabA);await seedOrphan();await fill(tabA);await submit(tabA);await until(()=>resetVisible(tabA),'mobile reset offer');
 assert.equal(await evaluate(tabA,'document.documentElement.scrollWidth<=innerWidth+1'),true);
 assert.equal(await evaluate(tabA,`${buttons('Reset sign-in on this browser')}.type`),'button');
 await evaluate(tabA,`${buttons('Reset sign-in on this browser')}.focus()`);assert.equal(await evaluate(tabA,"document.activeElement.textContent.trim()"),'Reset sign-in on this browser');
 failConfirmation=true;await click(tabA,'Reset sign-in on this browser');
 await until(()=>evaluate(tabA,"document.body.textContent.includes('could not be confirmed')"),'failed reset feedback');
 assert.equal(await resetVisible(tabA),false);assert.equal(loginCalls,2);
 failConfirmation=false;await submit(tabA);await until(()=>resetVisible(tabA),'explicit Login obtains fresh offer after committed-but-unconfirmed reset');
 await click(tabA,'Reset sign-in on this browser');await until(()=>evaluate(tabA,"document.body.textContent.includes('Browser sign-in reset. Click Login')"),'fresh reset recovered');
 assert.equal(loginCalls,2,'successful reset still does not replay credentials');
 await input(tabA,'login-password','synthetic-wrong-password');await submit(tabA);
 await until(()=>evaluate(tabA,'!!document.querySelector(".login-message.error")'),'wrong password feedback');
 assert.equal(await resetVisible(tabA),false,'incorrect password never offers browser reset');
 console.log('Rendered Login: explicit-only reset/login, failed-confirmation recovery, wrong-password exclusion, mobile layout and keyboard focus passed.');
} finally {
 releaseLogin?.();releaseReset?.();socket?.close();
 if(chrome && chrome.exitCode===null){chrome.kill('SIGKILL');await new Promise(r=>chrome.once('exit',r));}
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
 assert.ok(initialBindings.every(id=>/^[0-9a-f-]{36}$/.test(id)));
 sql(`delete from private.plannix_auth_browser_bindings where not(id=any(array[${initialBindings.map(id=>`'${id}'::uuid`).join(',')}]::uuid[]));delete from auth.users where id='${owner}';`);
 await rm(work,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
