// Stage 3 test-only browser proof. Uses synthetic services and localhost only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServerSessionTestApp } from '../server/auth/serverSessionTestApp.js';

const profile=await mkdtemp(path.join(tmpdir(),'plannix-stage3-cookie-'));
const marker=`__Host-plannix-b-1=${'a'.repeat(43)}`;
let current=null; let next=1; let latest=null;
const repo={
  async issueBinding() { return {state:'issued',setCookie:`${marker}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=Lax`}; },
  async resolve(header) {
    if (!header) return {state:'missing'};
    if (!header.includes(marker)) return {state:'invalid'};
    const sessions=header.split(';').map(value=>value.trim()).filter(value=>value.startsWith('__Host-plannix-s-'));
    const match=sessions.find(value=>value===current?.cookie);
    return {state:'selected',header:match?`${marker}; ${match}`:marker,
      markerName:'__Host-plannix-b-1',sessionName:match?.split('=')[0] || null,
      cleanup:sessions.filter(value=>value!==match).map(value=>value.split('=')[0])};
  },
  async begin() { latest=randomUUID();return {state:'started',intentId:latest}; },
  async settle(intent,outcome,details) {
    if (intent!==latest) return {state:'superseded'};
    if (outcome!=='created') return {state:outcome};
    next+=1;
    current={cookie:`__Host-plannix-s-${next}=${'b'.repeat(43)}`,
      ownerId:details.confirmedOwnerId,accessToken:details.accessToken};
    return {state:'created',setCookie:`${current.cookie}; Path=/; Secure; HttpOnly; SameSite=Lax`};
  },
  async readTokens(header,kind) {
    if (kind!=='ordinary' || !current || !header.includes(current.cookie)) return {state:'absent'};
    return {state:'current',ownerId:current.ownerId,accessToken:current.accessToken,tokenVersion:1};
  },
  async resolveForApplication(header) {
    const selected=await this.resolve(header);
    if(selected.state!=='selected'||!selected.sessionName)return selected;
    const tokens=await this.readTokens(selected.header,'ordinary');
    return tokens.state==='current'?{...selected,...tokens}:tokens;
  },
  async inspect(header,kind) {
    const found=await repo.readTokens(header,kind);
    return found.state==='current'?{state:'current',ownerId:found.ownerId,tokenVersion:1}:found;
  },
  async logout(header) {
    if (!current || !header.includes(current.cookie)) return {state:'absent'};
    const cleanup=current.cookie.split('=')[0];current=null;return {state:'revoked',cleanup};
  },
};
const identity={
  async login({email}) {
    const id=email.startsWith('b')?'dd000000-0000-4000-8000-000000000002'
      :'dd000000-0000-4000-8000-000000000001';
    return {user:{id,name:'Synthetic Teacher'},session:{access_token:`synthetic-${id}`,
      refresh_token:`synthetic-refresh-${id}`}};
  },
  async validateAccess({expectedUserId}) { return {userId:expectedUserId}; },
};
let server;let chrome;let socket;
try {
  const portHolder=createServer().listen(0,'localhost');
  await new Promise(resolve=>portHolder.once('listening',resolve));
  const port=portHolder.address().port;
  await new Promise(resolve=>portHolder.close(resolve));
  const origin=`http://localhost:${port}`;
  server=createServer(createServerSessionTestApp({repository:repo,identity,origin,csrfKey:Buffer.alloc(32,3)}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'localhost',resolve);});
  chrome=spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless','--disable-background-networking','--disable-component-update','--no-first-run',
      '--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,`${origin}/settings`],
    {stdio:['ignore','ignore','pipe']});
  const wsUrl=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Chrome startup timeout')),15000);
    chrome.once('error',reject);
    chrome.stderr.on('data',chunk=>{
      const found=String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if(found){clearTimeout(timer);resolve(found[1]);}
    });
  });
  socket=new WebSocket(wsUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let serial=0;const pending=new Map();
  socket.onmessage=event=>{
    const message=JSON.parse(event.data);const call=pending.get(message.id);
    if(!call)return;clearTimeout(call.timer);pending.delete(message.id);
    message.error?call.reject(Error(message.error.message)):call.resolve(message.result);
  };
  const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timeout`));},12000);
    pending.set(id,{resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  const {targetInfos}=await cdp('Target.getTargets');
  const target=targetInfos.find(item=>item.type==='page' && item.url.startsWith(origin));
  assert.ok(target);
  const {sessionId:tab}=await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const evaluate=async expression=>{
    const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},tab);
    if(result.exceptionDetails)throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const navigationDeadline=Date.now()+5000;
  while(!(await evaluate('location.href')).startsWith(origin)) {
    if(Date.now()>navigationDeadline)throw Error('Synthetic page navigation timeout');
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  const fetchPath=(pathname,init={})=>evaluate(`fetch(${JSON.stringify(origin+'/__stage3/auth'+pathname)},
    ${JSON.stringify(init)}).then(async r=>({status:r.status,body:await r.json(),
    exposedCookie:r.headers.get('set-cookie')}))`);
  const boot=await fetchPath('/bootstrap');
  assert.equal(boot.status,200);
  assert.equal(boot.exposedCookie,null);
  assert.equal(await evaluate('document.cookie'),'');
  const loginBody=JSON.stringify({email:'a@example.test',password:'synthetic-password'});
  assert.equal((await fetchPath('/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:loginBody})).status,403);
  const login=await fetchPath('/login',{method:'POST',headers:{'Content-Type':'application/json',
    'X-Plannix-CSRF':boot.body.csrfToken},body:loginBody});
  assert.equal(login.status,200);
  assert.equal(login.body.user.id,'dd000000-0000-4000-8000-000000000001');
  assert.equal(await evaluate('document.cookie'),'');
  const firstStatus=await fetchPath('/status');
  assert.equal(firstStatus.body.authenticated,true);
  assert.notEqual(firstStatus.body.csrfToken,boot.body.csrfToken);
  const second=await fetchPath('/login',{method:'POST',headers:{'Content-Type':'application/json',
    'X-Plannix-CSRF':firstStatus.body.csrfToken},
    body:JSON.stringify({email:'b@example.test',password:'synthetic-password'})});
  assert.equal(second.status,200);
  assert.equal((await fetchPath('/status')).body.userId,'dd000000-0000-4000-8000-000000000002');
  const {cookies}=await cdp('Network.getCookies',{urls:[origin]},tab);
  assert.equal(cookies.filter(item=>item.name.startsWith('__Host-plannix-s-')).length,1,
    'verified old cookie receives exact-name cleanup');
  assert.equal(await evaluate('document.cookie'),'');
  console.log('Stage 3 Chrome proof passed: HttpOnly cookies, CSRF and exact stale-version cleanup.');
} finally {
  socket?.close();
  if(chrome && chrome.exitCode===null){chrome.kill('SIGKILL');
    await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),
      new Promise(resolve=>setTimeout(resolve,3000))]);}
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await rm(profile,{recursive:true,force:true});
}
