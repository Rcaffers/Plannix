import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createServerSessionTestApp } from './serverSessionTestApp.js';

const ownerA = 'dd000000-0000-4000-8000-000000000011';
const ownerB = 'dd000000-0000-4000-8000-000000000012';
const marker = `__Host-plannix-b-1=${'a'.repeat(43)}`;
const setMarker = `${marker}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=Lax`;
const flowId = 'a'.repeat(32);
const session = (number, kind='s') => `__Host-plannix-${kind}-${number}=${'b'.repeat(43)}`;
const user = id => ({ id, name:'Synthetic Teacher', email:'teacher@example.test' });
const tokens = id => ({ access_token:`synthetic-access-${id}`,refresh_token:`synthetic-refresh-${id}` });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve=done; }); return {promise,resolve}; };

function fakeRepository() {
  let current = null; let version=1; let next=1; let latest=null; let refreshClaim=null;
  const callbacks = new Map();
  const transitions = new Map();
  const calls = [];
  return {
    calls,
    async issueBinding() { return {state:'issued',setCookie:setMarker}; },
    async resolve(header) {
      if (!header) return {state:'missing'};
      if (!header.includes(marker)) return {state:'invalid'};
      const supplied = header.split(';').map(item=>item.trim()).find(item=>item.startsWith('__Host-plannix-s-')
        || item.startsWith('__Host-plannix-r-'));
      return {state:'selected',header: supplied && supplied===current?.cookie ? `${marker}; ${supplied}`:marker,
        markerName:'__Host-plannix-b-1',sessionName:supplied && supplied===current?.cookie?current.cookie.split('=')[0]:null,
        cleanup:supplied && supplied!==current?.cookie?[supplied.split('=')[0]]:[]};
    },
    async begin(_header,kind) {
      if (latest && transitions.get(latest)?.state==='pending') transitions.get(latest).state='superseded';
      latest=randomUUID(); transitions.set(latest,{state:'pending',kind});
      calls.push(['begin',kind,latest]); return {state:'started',intentId:latest};
    },
    async settle(intent,outcome,details) {
      calls.push(['settle',intent,outcome]);
      const transition=transitions.get(intent);
      if (intent!==latest || transition?.state!=='pending') return {state:transition?.state||'invalid'};
      transition.state=outcome;
      if (outcome!=='created') { latest=null; return {state:outcome}; }
      next+=1; version=1;
      current={cookie:session(next,transition.kind==='recovery'?'r':'s'),
        ownerId:details.confirmedOwnerId,accessToken:details.accessToken,
        refreshToken:details.refreshToken};
      latest=null;
      return {state:'created',setCookie:`${current.cookie}; Path=/; Secure; HttpOnly; SameSite=Lax`};
    },
    async readTokens(header,kind) {
      if (!current || !header.includes(current.cookie)) return {state:'absent'};
      if ((kind==='recovery')!==current.cookie.includes('-r-')) return {state:'wrong-kind'};
      return {state:'current',ownerId:current.ownerId,accessToken:current.accessToken,
        refreshToken:current.refreshToken,tokenVersion:version};
    },
    async inspect(header,kind) {
      const found=await this.readTokens(header,kind);
      return found.state==='current'?{state:'current',tokenVersion:version,ownerId:found.ownerId}:found;
    },
    async reserveCallback(_header,{state,kind,intentId}) {
      if (intentId!==latest || transitions.get(intentId)?.state!=='pending') return {state:'invalid'};
      callbacks.set(state,{kind,intentId,initialCookie:current?.cookie||null,
        used:false,ready:false,cancelled:false}); return {state:'reserved'};
    },
    async attachCallback(_header,{state,flowId:flow,kind,verifier}) {
      const found=callbacks.get(state);
      if (!found || found.kind!==kind || found.cancelled || found.flow
        || found.intentId!==latest || transitions.get(found.intentId)?.state!=='pending') return {state:'invalid'};
      Object.assign(found,{flow,verifier}); return {state:'attached'};
    },
    async readyCallback(_header,{state,kind}) {
      const found=callbacks.get(state);
      if (!found || found.kind!==kind || found.cancelled || !found.flow
        || found.intentId!==latest || transitions.get(found.intentId)?.state!=='pending'
        || found.initialCookie!==(current?.cookie||null)) return {state:'invalid'};
      found.ready=true; return {state:'ready'};
    },
    async cancelCallback(_header,{state,kind}) {
      const found=callbacks.get(state);
      if (found?.kind===kind && !found.used) found.cancelled=true;
      return {state:'cancelled'};
    },
    async claimCallback(header,{state,flowId:flow,kind}) {
      const found=callbacks.get(state);
      if (!found || found.used || found.cancelled || !found.ready
        || found.flow!==flow || found.kind!==kind || found.intentId!==latest
        || transitions.get(found.intentId)?.state!=='pending'
        || found.initialCookie!==(current?.cookie||null)
        || found.initialCookie && !header.includes(found.initialCookie)) return {state:'invalid'};
      const started=await this.begin(header,kind==='confirmation'?'ordinary':'recovery');
      found.used=true; return {state:'claimed',intentId:started.intentId,verifier:found.verifier};
    },
    async claimRefresh(_header,expectedVersion) {
      if (refreshClaim) return {state:'busy'};
      if (expectedVersion!==version) return {state:'conflict'};
      refreshClaim=randomUUID();
      return {state:'claimed',claimId:refreshClaim,sessionId:randomUUID(),ownerId:current.ownerId,
        tokenVersion:version,refreshToken:current.refreshToken};
    },
    async finishRefresh(claim,newTokens) {
      if (claim.claimId!==refreshClaim || claim.tokenVersion!==version) return {state:'conflict'};
      version+=1; refreshClaim=null;
      current.accessToken=newTokens.accessToken; current.refreshToken=newTokens.refreshToken;
      return {state:'refreshed',tokenVersion:version};
    },
    async releaseRefresh(claim) { if (refreshClaim===claim.claimId) refreshClaim=null; return {state:'released'}; },
    async logout(header) {
      const supplied=header.split(';').map(item=>item.trim()).find(item=>item.startsWith('__Host-plannix-s-')
        || item.startsWith('__Host-plannix-r-'));
      if (supplied!==current?.cookie) return {state:'absent',cleanup:supplied?.split('=')[0]};
      current=null; return {state:'revoked',cleanup:supplied.split('=')[0]};
    },
    current:()=>current,
    callback:state=>callbacks.get(state),
    transition:intent=>transitions.get(intent),
  };
}

function fakeIdentity() {
  const calls=[];
  const service={calls,
    async login({email}) { calls.push(['login',email]); const id=email.startsWith('b')?ownerB:ownerA;
      return {user:user(id),session:tokens(id)}; },
    async signup({redirectTo,onVerifier}) { calls.push(['signup',redirectTo]); await onVerifier(flowId,'synthetic-verifier');
      return {confirmationPending:true}; },
    async sendRecovery({redirectTo,onVerifier}) { calls.push(['recover',redirectTo]);
      await onVerifier(flowId,'synthetic-verifier/recovery'); },
    async exchange({verifier}) { calls.push(['exchange',verifier]);
      return verifier.endsWith('/recovery')
        ? {kind:'recovery',userId:ownerA,session:tokens(ownerA)}
        : {kind:'ordinary',user:user(ownerA),session:tokens(ownerA)}; },
    async validateAccess({expectedUserId}) { calls.push(['validate',expectedUserId]);
      return {userId:expectedUserId,email:'teacher@example.test'}; },
    async updateRecoveryPassword({expectedUserId}) { calls.push(['update-password',expectedUserId]);
      return {updated:true}; },
    async refresh({expectedUserId}) { calls.push(['refresh',expectedUserId]);return tokens(expectedUserId); },
    async deleteAccount({userId}) { calls.push(['delete',userId]);return {deleted:true}; },
  };
  return service;
}

async function fixture({identity=fakeIdentity(),repository=fakeRepository(),providerDeadlineMs=1000}={}) {
  const portServer=createServer().listen(0,'localhost');
  await new Promise(resolve=>portServer.once('listening',resolve));
  const port=portServer.address().port;
  await new Promise(resolve=>portServer.close(resolve));
  const origin=`http://localhost:${port}`;
  const app=createServerSessionTestApp({identity,repository,origin,
    csrfKey:Buffer.alloc(32,1),providerDeadlineMs});
  const server=app.listen(port,'localhost');
  await new Promise(resolve=>server.once('listening',resolve));
  async function request(path,{method='GET',body,cookie,csrf,originHeader=origin,headers={},absolute=false}={}) {
    const response=await fetch(`${origin}${absolute?'':'/__stage3/auth'}${path}`,{method,redirect:'manual',
      headers:{...(originHeader?{Origin:originHeader}:{}),...(cookie?{Cookie:cookie}:{}),
        ...(csrf?{'X-Plannix-CSRF':csrf}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},
      body:body?JSON.stringify(body):undefined});
    const raw=await response.text();
    return {status:response.status,body:raw && response.headers.get('content-type')?.includes('json')
      ? JSON.parse(raw):null,
      cookies:response.headers.getSetCookie(),location:response.headers.get('location'),
      cache:response.headers.get('cache-control')};
  }
  return {request,repository,identity,origin,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('bootstrap and signed-in login require exact origin and session-bound CSRF',async()=>{
  const ctx=await fixture();
  try {
    const boot=await ctx.request('/bootstrap');
    assert.equal(boot.status,200);
    assert.match(boot.cookies[0],/Secure; HttpOnly; SameSite=Lax/);
    assert.equal((await ctx.request('/login',{method:'POST',cookie:marker,
      body:{email:'a@example.test',password:'synthetic'}})).status,403);
    const login=await ctx.request('/login',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
      body:{email:'a@example.test',password:'synthetic'}});
    assert.equal(login.status,200);
    assert.equal(login.body.user.id,ownerA);
    assert.equal(login.cache,'no-store');
    const currentCookie=login.cookies[0].split(';')[0];
    const status=await ctx.request('/status',{cookie:`${marker}; ${currentCookie}`});
    assert.equal(status.body.authenticated,true);
    assert.equal((await ctx.request('/__stage3/protected',{cookie:`${marker}; ${currentCookie}`,
      absolute:true})).body.userId,ownerA);
    assert.notEqual(status.body.csrfToken,boot.body.csrfToken);
    assert.equal((await ctx.request('/logout',{method:'POST',cookie:`${marker}; ${currentCookie}`,
      csrf:boot.body.csrfToken,body:{}})).status,403);
    assert.equal((await ctx.request('/logout',{method:'POST',cookie:`${marker}; ${currentCookie}`,
      csrf:status.body.csrfToken,body:{}})).status,204);
    assert.equal(ctx.repository.current(),null);
  } finally { await ctx.close(); }
});

test('ordinary application writes require exact Origin and session-bound CSRF',async()=>{
  const ctx=await fixture();
  try {
    const boot=await ctx.request('/bootstrap');
    const login=await ctx.request('/login',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
      body:{email:'a@example.test',password:'synthetic'}});
    const signed=`${marker}; ${login.cookies[0].split(';')[0]}`;
    const status=await ctx.request('/status',{cookie:signed});
    const write={absolute:true,method:'POST',cookie:signed};
    assert.equal((await ctx.request('/__stage3/protected',write)).status,403);
    assert.equal((await ctx.request('/__stage3/protected',{...write,csrf:'forged'})).status,403);
    assert.equal((await ctx.request('/__stage3/protected',{
      ...write,csrf:boot.body.csrfToken})).status,403);
    assert.equal((await ctx.request('/__stage3/protected',{
      ...write,csrf:status.body.csrfToken,originHeader:null})).status,403);
    assert.equal((await ctx.request('/__stage3/protected',{
      ...write,csrf:status.body.csrfToken,originHeader:'https://evil.test'})).status,403);
    assert.equal((await ctx.request('/__stage3/protected',{
      ...write,csrf:status.body.csrfToken,headers:{'X-Forwarded-Host':'evil.test'}})).status,200);
    assert.equal((await ctx.request('/__stage3/protected',{
      ...write,csrf:status.body.csrfToken})).body.userId,ownerA);
    assert.equal((await ctx.request('/__stage3/protected',{
      absolute:true,method:'GET',cookie:signed,originHeader:null})).status,200);
  } finally { await ctx.close(); }
});

test('failed or timed-out callback initiation cannot be claimed or revived by late provider work',async()=>{
  for (const outcome of ['failure','timeout']) {
    let pendingVerifier;
    const lateResult=deferred();
    const identity=fakeIdentity();
    identity.signup=({redirectTo,onVerifier})=>{
      identity.calls.push(['signup',redirectTo]);
      pendingVerifier=onVerifier;
      if (outcome==='failure') return Promise.reject(new Error('Synthetic provider detail'));
      return lateResult.promise;
    };
    const ctx=await fixture({identity,providerDeadlineMs:30});
    try {
      const boot=await ctx.request('/bootstrap');
      const result=await ctx.request('/signup',{method:'POST',cookie:marker,
        csrf:boot.body.csrfToken,body:{firstName:'Test',lastName:'Teacher',
          email:'a@example.test',password:'synthetic-password'}});
      assert.equal(result.status,503);
      assert.doesNotMatch(JSON.stringify(result.body),/Synthetic provider detail/);
      const state=new URL(identity.calls.find(item=>item[0]==='signup')[1]).searchParams.get('state');
      assert.equal(ctx.repository.callback(state).cancelled,true);
      await assert.rejects(pendingVerifier(flowId,'synthetic-verifier'));
      if (outcome==='timeout') {
        lateResult.resolve({confirmationPending:true});
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(ctx.repository.callback(state).cancelled,true);
      }
      const path=`/callback?state=${state}&kind=confirmation&sb_flow_id=${flowId}&code=abc`;
      assert.equal((await ctx.request(path,{cookie:marker,originHeader:null})).status,400);
      assert.equal(ctx.repository.current(),null);
    } finally { await ctx.close(); }
  }
});

test('uncertain recovery email issuance returns generic response and leaves callback unclaimable',async()=>{
  const identity=fakeIdentity();
  let pendingVerifier;
  identity.sendRecovery=({redirectTo,onVerifier})=>{
    identity.calls.push(['recover',redirectTo]);
    pendingVerifier=onVerifier;
    return new Promise(()=>{});
  };
  const ctx=await fixture({identity,providerDeadlineMs:25});
  try {
    const boot=await ctx.request('/bootstrap');
    const response=await ctx.request('/recover',{method:'POST',cookie:marker,
      csrf:boot.body.csrfToken,body:{email:'a@example.test'}});
    assert.equal(response.status,200);
    assert.match(response.body.message,/If an account exists/);
    const state=new URL(identity.calls.find(item=>item[0]==='recover')[1]).searchParams.get('state');
    assert.equal(ctx.repository.callback(state).cancelled,true);
    await assert.rejects(pendingVerifier(flowId,'synthetic-verifier'));
    assert.equal((await ctx.request(`/callback?state=${state}&kind=recovery&sb_flow_id=${flowId}&code=abc`,
      {cookie:marker,originHeader:null})).status,400);
  } finally { await ctx.close(); }
});

test('delayed signup and recovery initiation cannot ready an old callback after newer login',async()=>{
  for (const kind of ['confirmation','recovery']) {
    const identity=fakeIdentity();
    const entered=deferred(); const provider=deferred();
    if (kind==='confirmation') identity.signup=async({redirectTo,onVerifier})=>{
      identity.calls.push(['signup',redirectTo]);
      await onVerifier(flowId,'synthetic-verifier');
      entered.resolve(); return provider.promise;
    };
    else identity.sendRecovery=async({redirectTo,onVerifier})=>{
      identity.calls.push(['recover',redirectTo]);
      await onVerifier(flowId,'synthetic-verifier/recovery');
      entered.resolve(); return provider.promise;
    };
    const ctx=await fixture({identity});
    try {
      const boot=await ctx.request('/bootstrap');
      const pending=kind==='confirmation'
        ? ctx.request('/signup',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
          body:{firstName:'Test',lastName:'Teacher',email:'a@example.test',password:'synthetic-password'}})
        : ctx.request('/recover',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
          body:{email:'a@example.test'}});
      await entered.promise;
      const login=await ctx.request('/login',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
        body:{email:'b@example.test',password:'synthetic'}});
      assert.equal(login.status,200);
      provider.resolve(kind==='confirmation'?{confirmationPending:true}:{acknowledged:true});
      const completed=await pending;
      assert.equal(completed.status,kind==='confirmation'?503:200);
      assert.equal(completed.cookies.length,0);
      const state=new URL(identity.calls.find(item=>item[0]===(kind==='confirmation'?'signup':'recover'))[1])
        .searchParams.get('state');
      assert.equal(ctx.repository.callback(state).ready,false);
      const path=`/callback?state=${state}&kind=${kind}&sb_flow_id=${flowId}&code=abc`;
      const newer=`${marker}; ${login.cookies[0].split(';')[0]}`;
      assert.equal((await ctx.request(path,{cookie:newer,originHeader:null})).status,400);
      assert.equal((await ctx.request('/status',{cookie:newer})).body.userId,ownerB);
    } finally { await ctx.close(); }
  }
});

test('new login during a claimed callback exchange supersedes the exchange without stale cookies',async()=>{
  const identity=fakeIdentity();
  const entered=deferred(); const exchange=deferred();
  identity.exchange=async()=>{entered.resolve();return exchange.promise;};
  const ctx=await fixture({identity});
  try {
    const boot=await ctx.request('/bootstrap');
    const signup=await ctx.request('/signup',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
      body:{firstName:'Test',lastName:'Teacher',email:'a@example.test',password:'synthetic-password'}});
    assert.equal(signup.status,200);
    const state=new URL(identity.calls.find(item=>item[0]==='signup')[1]).searchParams.get('state');
    const pending=ctx.request(`/callback?state=${state}&kind=confirmation&sb_flow_id=${flowId}&code=abc`,
      {cookie:marker,originHeader:null});
    await entered.promise;
    const login=await ctx.request('/login',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
      body:{email:'b@example.test',password:'synthetic'}});
    assert.equal(login.status,200);
    exchange.resolve({kind:'ordinary',user:user(ownerA),session:tokens(ownerA)});
    const old=await pending;
    assert.equal(old.status,409);
    assert.equal(old.cookies.length,0);
    assert.equal((await ctx.request('/status',
      {cookie:`${marker}; ${login.cookies[0].split(';')[0]}`})).body.userId,ownerB);
  } finally { await ctx.close(); }
});

test('confirmation callback is one-use and recovery cookie cannot authorize ordinary status',async()=>{
  const ctx=await fixture();
  try {
    const boot=await ctx.request('/bootstrap');
    const signup=await ctx.request('/signup',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
      body:{firstName:'Test',lastName:'Teacher',email:'a@example.test',password:'synthetic-password'}});
    assert.equal(signup.body.confirmationPending,true);
    const destination=new URL(ctx.identity.calls.find(item=>item[0]==='signup')[1]);
    const path=`/callback?state=${destination.searchParams.get('state')}&kind=confirmation&sb_flow_id=${flowId}&code=abc`;
    const confirmed=await ctx.request(path,{cookie:marker,originHeader:null});
    assert.equal(confirmed.status,303);
    assert.equal(confirmed.location,'/settings');
    assert.equal((await ctx.request(path,{cookie:marker,originHeader:null})).status,400);
    const confirmedCookie=confirmed.cookies[0].split(';')[0];
    assert.equal((await ctx.request('/status',{cookie:`${marker}; ${confirmedCookie}`})).body.authenticated,true);

    const status=await ctx.request('/status',{cookie:`${marker}; ${confirmedCookie}`});
    const recovery=await ctx.request('/recover',{method:'POST',cookie:`${marker}; ${confirmedCookie}`,
      csrf:status.body.csrfToken,body:{email:'a@example.test'}});
    assert.equal(recovery.status,200);
    const resetUrl=new URL(ctx.identity.calls.find(item=>item[0]==='recover')[1]);
    const resetPath=`/callback?state=${resetUrl.searchParams.get('state')}&kind=recovery&sb_flow_id=${flowId}&code=xyz`;
    const recovered=await ctx.request(resetPath,{cookie:`${marker}; ${confirmedCookie}`,originHeader:null});
    assert.equal(recovered.status,303);
    assert.equal(recovered.location,'/reset-password');
    const recoveryCookie=recovered.cookies[0].split(';')[0];
    const recoveryStatus=await ctx.request('/status',{cookie:`${marker}; ${recoveryCookie}`});
    assert.equal(recoveryStatus.body.authenticated,false);
    assert.equal(recoveryStatus.body.recovery,true);
    assert.equal((await ctx.request('/__stage3/protected',{cookie:`${marker}; ${recoveryCookie}`,
      absolute:true})).status,401);
    const updated=await ctx.request('/recovery/password',{method:'POST',cookie:`${marker}; ${recoveryCookie}`,
      csrf:recoveryStatus.body.csrfToken,body:{password:'new-synthetic-password'}});
    assert.equal(updated.status,204);
  } finally { await ctx.close(); }
});

test('refresh, stale logout, deletion and provider timeout stay bounded',async()=>{
  const ctx=await fixture();
  try {
    const boot=await ctx.request('/bootstrap');
    const login=await ctx.request('/login',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
      body:{email:'a@example.test',password:'synthetic'}});
    const oldCookie=login.cookies[0].split(';')[0];
    const status=await ctx.request('/status',{cookie:`${marker}; ${oldCookie}`});
    assert.equal((await ctx.request('/refresh',{method:'POST',cookie:`${marker}; ${oldCookie}`,
      csrf:status.body.csrfToken,body:{}})).body.tokenVersion,2);
    const second=await ctx.request('/login',{method:'POST',cookie:`${marker}; ${oldCookie}`,
      csrf:status.body.csrfToken,body:{email:'b@example.test',password:'synthetic'}});
    assert.equal(second.body.user.id,ownerB);
    const newerCookie=second.cookies[0].split(';')[0];
    assert.equal((await ctx.request('/logout',{method:'POST',cookie:`${marker}; ${oldCookie}`,
      csrf:boot.body.csrfToken,body:{}})).status,204);
    assert.equal((await ctx.request('/status',{cookie:`${marker}; ${newerCookie}`})).body.userId,ownerB);
    const newerStatus=await ctx.request('/status',{cookie:`${marker}; ${newerCookie}`});
    // A real auth.users deletion cascades the session row before the router
    // attempts logout, so there may be no row left to return a cleanup name.
    ctx.repository.logout=async()=>({state:'absent'});
    const removed=await ctx.request('/account',{method:'DELETE',cookie:`${marker}; ${newerCookie}`,
      csrf:newerStatus.body.csrfToken,body:{password:'synthetic'}});
    assert.equal(removed.status,204);
    assert.ok(removed.cookies.some(value=>value.startsWith(`${newerCookie.split('=')[0]}=; Max-Age=0;`)));
    assert.deepEqual(ctx.identity.calls.find(item=>item[0]==='delete'),['delete',ownerB]);
  } finally { await ctx.close(); }

  const pending=deferred();
  const slow=fakeIdentity(); slow.login=()=>pending.promise;
  const timed=await fixture({identity:slow,providerDeadlineMs:50});
  try {
    const boot=await timed.request('/bootstrap');
    const result=await timed.request('/login',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
      body:{email:'a@example.test',password:'synthetic'}});
    assert.equal(result.status,503);
    pending.resolve({user:user(ownerA),session:tokens(ownerA)});
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(timed.repository.current(),null);
  } finally { await timed.close(); }
});

test('reversed logins select latest started transition and spoofed host/origin fail',async()=>{
  const first=deferred(); const second=deferred();
  const identity=fakeIdentity(); let index=0;
  identity.login=()=>{index+=1;return index===1?first.promise:second.promise;};
  const ctx=await fixture({identity});
  try {
    const boot=await ctx.request('/bootstrap');
    const input={method:'POST',cookie:marker,csrf:boot.body.csrfToken,
      body:{email:'a@example.test',password:'synthetic'}};
    const a=ctx.request('/login',input);
    await new Promise(resolve=>setTimeout(resolve,10));
    const b=ctx.request('/login',input);
    await new Promise(resolve=>setTimeout(resolve,10));
    second.resolve({user:user(ownerB),session:tokens(ownerB)});
    const bResponse=await b;
    assert.equal(bResponse.status,200);
    first.resolve({user:user(ownerA),session:tokens(ownerA)});
    assert.equal((await a).status,409);
    assert.equal(ctx.repository.current().ownerId,ownerB);
    assert.equal((await ctx.request('/bootstrap',{headers:{'X-Forwarded-Host':'evil.test'},
      originHeader:'https://evil.test'})).status,403);
    const spoofedStatus=await new Promise((resolve,reject)=>{
      const target=new URL(ctx.origin);
      const request=httpRequest({hostname:'localhost',port:target.port,
        path:'/__stage3/auth/bootstrap',headers:{Host:'evil.test'}},response=>{
        response.resume();response.once('end',()=>resolve(response.statusCode));
      });
      request.once('error',reject);request.end();
    });
    assert.equal(spoofedStatus,400);
  } finally { await ctx.close(); }
});

test('failed signed-in replacement preserves the previous ordinary session',async()=>{
  const identity=fakeIdentity();
  const original=identity.login;
  identity.login=async input=>{
    if(input.email.startsWith('b')) throw Object.assign(new Error('Synthetic rejection'),
      {kind:'credentials'});
    return original(input);
  };
  const ctx=await fixture({identity});
  try {
    const boot=await ctx.request('/bootstrap');
    const first=await ctx.request('/login',{method:'POST',cookie:marker,csrf:boot.body.csrfToken,
      body:{email:'a@example.test',password:'synthetic'}});
    const currentCookie=first.cookies[0].split(';')[0];
    const status=await ctx.request('/status',{cookie:`${marker}; ${currentCookie}`});
    const failed=await ctx.request('/login',{method:'POST',cookie:`${marker}; ${currentCookie}`,
      csrf:status.body.csrfToken,body:{email:'b@example.test',password:'synthetic'}});
    assert.equal(failed.status,401);
    assert.equal((await ctx.request('/status',{cookie:`${marker}; ${currentCookie}`})).body.userId,ownerA);
    assert.equal(ctx.repository.current().ownerId,ownerA);
  } finally { await ctx.close(); }
});
