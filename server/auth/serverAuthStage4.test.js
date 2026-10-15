import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createServerSessionTestApp } from './serverSessionTestApp.js';

const OWNER_A = 'dd000000-0000-4000-8000-000000000001';
const OWNER_B = 'dd000000-0000-4000-8000-000000000002';
const marker = `__Host-plannix-b-1=${'a'.repeat(43)}`;

function syntheticBoundary() {
  let current = null;
  let generation = 1;
  let latestIntent = null;
  let deleted = false;
  const repository = {
    async issueBinding() { return { state:'issued', setCookie:`${marker}; Path=/; Secure; HttpOnly` }; },
    async resolve(header) {
      if (!header) return { state:'missing' };
      if (!header.includes(marker)) return { state:'invalid' };
      const cookie = current && header.includes(current.cookie) ? current.cookie : null;
      return { state:'selected', header:cookie ? `${marker}; ${cookie}` : marker,
        markerName:'__Host-plannix-b-1', sessionName:cookie?.split('=')[0] || null, cleanup:[] };
    },
    async begin() { latestIntent=randomUUID(); return {state:'started',intentId:latestIntent}; },
    async settle(intent,outcome,details) {
      if (intent!==latestIntent) return { state:'superseded' };
      if (outcome!=='created') return { state:outcome };
      generation += 1;
      current = { ownerId:details.confirmedOwnerId,accessToken:details.accessToken,
        refreshToken:details.refreshToken,tokenVersion:1,
        cookie:`__Host-plannix-s-${generation}=${String(generation).repeat(43).slice(0,43)}` };
      return { state:'created', setCookie:`${current.cookie}; Path=/; Secure; HttpOnly` };
    },
    async readTokens(header,kind) {
      if (kind!=='ordinary' || !current || !header.includes(current.cookie)) return {state:'absent'};
      return { state:'current',ownerId:current.ownerId,accessToken:current.accessToken,
        refreshToken:current.refreshToken,tokenVersion:current.tokenVersion };
    },
    async inspect(header,kind) {
      const result=await repository.readTokens(header,kind);
      return result.state==='current'?{state:'current',ownerId:result.ownerId,
        tokenVersion:result.tokenVersion}:result;
    },
    async claimRefresh(header,expectedVersion) {
      const tokens=await repository.readTokens(header,'ordinary');
      return tokens.state==='current' && tokens.tokenVersion===expectedVersion
        ? {state:'claimed',ownerId:tokens.ownerId,tokenVersion:tokens.tokenVersion,
          accessToken:tokens.accessToken,refreshToken:tokens.refreshToken,claimId:randomUUID()}
        : {state:'invalid'};
    },
    async finishRefresh(claim, tokens) {
      if (!current || current.ownerId!==claim.ownerId
        || current.tokenVersion!==claim.tokenVersion) return {state:'rejected'};
      current={...current,...tokens,tokenVersion:current.tokenVersion+1};
      return {state:'refreshed',tokenVersion:current.tokenVersion};
    },
    async releaseRefresh() { return {state:'released'}; },
    async logout(header) {
      if (!current || !header.includes(current.cookie)) return {state:'absent'};
      const cleanup=current.cookie.split('=')[0]; current=null;
      return {state:'revoked',cleanup};
    },
  };
  const identity = {
    async login({email}) {
      const id=email.startsWith('b')?OWNER_B:OWNER_A;
      return {user:{id},session:{access_token:`synthetic-access-${id}`,
        refresh_token:`synthetic-refresh-${id}`}};
    },
    async validateAccess({expectedUserId}) { return {userId:expectedUserId,
      email:expectedUserId===OWNER_A?'a@example.test':'b@example.test'}; },
    async refresh({expectedUserId}) { return {access_token:`refreshed-access-${expectedUserId}`,
      refresh_token:`refreshed-refresh-${expectedUserId}`}; },
    async loadCurrentUser({expectedUserId}) { return {id:expectedUserId,
      name:'Synthetic Teacher',email:'teacher@example.test',
      organisationId:'dd000000-0000-4000-8000-000000000003'}; },
    async updateProfileName({expectedUserId,firstName,lastName}) {
      return {id:expectedUserId,name:`${firstName} ${lastName}`,
        firstName,lastName,initials:`${firstName[0]}${lastName[0]}`};
    },
    async updateOrdinaryPassword({expectedUserId}) { return {
      access_token:`synthetic-new-access-${expectedUserId}`,
      refresh_token:`synthetic-new-refresh-${expectedUserId}`}; },
    async deleteAccount() { deleted=true; return {deleted:true}; },
  };
  return { repository, identity, get deleted() { return deleted; },
    get currentTokens() { return current; } };
}

test('application guard refreshes an expired provider token with CAS and rejects stale refresh',async()=>{
  const mock=syntheticBoundary();
  let refreshes=0;
  mock.identity.validateAccess=async({accessToken,expectedUserId})=>{
    if (accessToken.startsWith('synthetic-access-')) throw Error('Synthetic expired access');
    return {userId:expectedUserId};
  };
  mock.identity.refresh=async({expectedUserId})=>{refreshes+=1;
    return {access_token:`refreshed-access-${expectedUserId}`,
      refresh_token:`refreshed-refresh-${expectedUserId}`};};
  const probe=createServer().listen(0,'127.0.0.1');
  await new Promise(resolve=>probe.once('listening',resolve));
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const live=createServer(createServerSessionTestApp({repository:mock.repository,
    identity:mock.identity,origin,csrfKey:Buffer.alloc(32,7)}));
  await new Promise((resolve,reject)=>{live.once('error',reject);live.listen(port,'127.0.0.1',resolve);});
  const request=async(path,{method='GET',cookie='',csrf='',body,
    expectedSession=cookie.match(/__Host-plannix-s-[1-9]\d*/)?.[0]}={})=>{
    const response=await fetch(`${origin}${path}`,{method,headers:{Origin:origin,
      ...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-Plannix-CSRF':csrf}:{}),
      ...(expectedSession?{'X-Plannix-Expected-Session':expectedSession}:{}),
      ...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json().catch(()=>null),
      cookie:response.headers.get('set-cookie')?.split(';')[0]||null};
  };
  try {
    const boot=await request('/__stage3/auth/bootstrap');
    const login=await request('/__stage3/auth/login',{method:'POST',cookie:boot.cookie,
      csrf:boot.body.csrfToken,body:{email:'a@example.test',password:'synthetic'}});
    const cookie=`${boot.cookie}; ${login.cookie}`;
    const first=await request('/__stage3/protected',{cookie});
    assert.equal(first.status,200);
    assert.equal(first.body.userId,OWNER_A);
    assert.equal(refreshes,1);
    assert.equal(mock.currentTokens.tokenVersion,2);
    assert.equal((await request('/__stage3/protected',{cookie})).status,200);
    assert.equal(refreshes,1,'a successful refresh is not repeated');
    mock.identity.validateAccess=async()=>{throw Error('Synthetic expired access');};
    mock.repository.finishRefresh=async()=>({state:'stale'});
    const stale=await request('/__stage3/protected',{cookie});
    assert.equal(stale.status,503);
    assert.equal(stale.body.userId,undefined);
    assert.equal(mock.currentTokens.tokenVersion,2,'failed CAS leaves the stored token version intact');
  } finally { await new Promise(resolve=>live.close(resolve)); }
});

test('integrated cookie boundary protects profile writes and captured-version logout', async () => {
  const mock=syntheticBoundary();
  let nameWrites=0;
  const updateName=mock.identity.updateProfileName;
  mock.identity.updateProfileName=async input=>{nameWrites+=1;return updateName(input);};
  // The router requires the actual Host. Bind a verified loopback port first.
  const probe=createServer().listen(0,'127.0.0.1');
  await new Promise(resolve=>probe.once('listening',resolve));
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const live=createServer(createServerSessionTestApp({repository:mock.repository,
    identity:mock.identity,origin,csrfKey:Buffer.alloc(32,7),requireLogoutVersion:true}));
  await new Promise((resolve,reject)=>{live.once('error',reject);live.listen(port,'127.0.0.1',resolve);});
  async function request(path,{method='GET',cookie='',csrf='',body,originHeader=origin,
    expectedSession=cookie.match(/__Host-plannix-s-[1-9]\d*/)?.[0]}={}) {
    const response=await fetch(`${origin}/__stage3/auth${path}`, {method,
      headers:{ ...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-Plannix-CSRF':csrf}:{}),
        ...(expectedSession?{'X-Plannix-Expected-Session':expectedSession}:{}),
        ...(originHeader?{Origin:originHeader}:{}),...(body?{'Content-Type':'application/json'}:{}) },
      ...(body?{body:JSON.stringify(body)}:{}) });
    return {status:response.status,body:await response.json().catch(()=>null),
      cookie:response.headers.get('set-cookie')?.split(';')[0] || null};
  }
  try {
    const boot=await request('/bootstrap');
    assert.equal(boot.status,200);
    const loginA=await request('/login',{method:'POST',cookie:boot.cookie,
      csrf:boot.body.csrfToken,body:{email:'a@example.test',password:'synthetic'}});
    assert.equal(loginA.status,200);
    const cookieA=`${boot.cookie}; ${loginA.cookie}`;
    const statusA=await request('/status',{cookie:cookieA});
    assert.equal(statusA.body.userId,OWNER_A);
    assert.equal((await request('/profile/name',{method:'PUT',cookie:cookieA,
      body:{firstName:'New',lastName:'Name'}})).status,403);
    const named=await request('/profile/name',{method:'PUT',cookie:cookieA,
      csrf:statusA.body.csrfToken,body:{firstName:'New',lastName:'Name'}});
    assert.equal(named.body.user.id,OWNER_A);
    const password=await request('/profile/password',{method:'POST',cookie:cookieA,
      csrf:statusA.body.csrfToken,body:{currentPassword:'synthetic-old',newPassword:'synthetic-new'}});
    assert.equal(password.status,204);
    const loginB=await request('/login',{method:'POST',cookie:cookieA,
      csrf:statusA.body.csrfToken,body:{email:'b@example.test',password:'synthetic'}});
    assert.equal(loginB.status,200);
    const cookieB=`${boot.cookie}; ${loginB.cookie}`;
    const statusB=await request('/status',{cookie:cookieB});
    assert.equal(statusB.body.userId,OWNER_B);
    const missingContext=await request('/profile/name',{method:'PUT',cookie:cookieB,
      csrf:statusB.body.csrfToken,expectedSession:null,
      body:{firstName:'No',lastName:'Context'}});
    assert.equal(missingContext.status,409);
    assert.equal(nameWrites,1);
    const crossed=await request('/profile/name',{method:'PUT',cookie:cookieB,
      csrf:statusB.body.csrfToken,expectedSession:statusA.body.sessionName,
      body:{firstName:'Old',lastName:'Draft'}});
    assert.equal(crossed.status,409,'new CSRF cannot authorize an old displayed session');
    assert.equal(nameWrites,1,'mismatch never reaches identity-provider mutation');
    const guardedCrossed=await fetch(`${origin}/__stage3/protected`,{method:'POST',
      headers:{Origin:origin,Cookie:cookieB,'X-Plannix-CSRF':statusB.body.csrfToken,
        'X-Plannix-Expected-Session':statusA.body.sessionName}});
    assert.equal(guardedCrossed.status,409,'central application guard rejects the same mismatch');
    const stale=await request('/logout',{method:'POST',cookie:cookieB,
      csrf:statusB.body.csrfToken,body:{expectedSessionName:statusA.body.sessionName}});
    assert.equal(stale.status,409);
    assert.equal((await request('/status',{cookie:cookieB})).body.userId,OWNER_B);
    const deletion=await request('/account',{method:'DELETE',cookie:cookieB,
      csrf:statusB.body.csrfToken,body:{password:'synthetic',
        expectedSessionName:statusA.body.sessionName}});
    assert.equal(deletion.status,409);
    assert.equal(mock.deleted,false);
    const replacement=await request('/login',{method:'POST',cookie:cookieB,
      csrf:statusB.body.csrfToken,body:{email:'b@example.test',password:'synthetic'}});
    assert.equal(replacement.status,200);
    const replacementCookie=`${boot.cookie}; ${replacement.cookie}`;
    const replacementStatus=await request('/status',{cookie:replacementCookie});
    assert.equal(replacementStatus.body.userId,OWNER_B);
    assert.notEqual(replacementStatus.body.sessionName,statusB.body.sessionName);
    const oldVersion=await request('/profile/name',{method:'PUT',cookie:replacementCookie,
      csrf:replacementStatus.body.csrfToken,expectedSession:statusB.body.sessionName,
      body:{firstName:'Stale',lastName:'Version'}});
    assert.equal(oldVersion.status,409);
    assert.equal(nameWrites,1,'same-account replacement also rejects the old UI version');
    assert.equal((await request('/logout',{method:'POST',cookie:replacementCookie,
      csrf:replacementStatus.body.csrfToken,
      body:{expectedSessionName:replacementStatus.body.sessionName}})).status,204);
  } finally { await new Promise(resolve=>live.close(resolve)); }
});

test('timed-out profile provider work cannot issue a late cookie or overwrite the session',async()=>{
  const mock=syntheticBoundary();
  let complete;
  mock.identity.updateOrdinaryPassword=()=>new Promise(resolve=>{complete=resolve;});
  const probe=createServer().listen(0,'127.0.0.1');
  await new Promise(resolve=>probe.once('listening',resolve));
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const live=createServer(createServerSessionTestApp({repository:mock.repository,
    identity:mock.identity,origin,csrfKey:Buffer.alloc(32,7),
    providerDeadlineMs:30,requireLogoutVersion:true}));
  await new Promise((resolve,reject)=>{live.once('error',reject);live.listen(port,'127.0.0.1',resolve);});
  const request=async(path,{method='GET',cookie='',csrf='',body,
    expectedSession=cookie.match(/__Host-plannix-s-[1-9]\d*/)?.[0]}={})=>{
    const response=await fetch(`${origin}/__stage3/auth${path}`,{method,headers:{Origin:origin,
      ...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-Plannix-CSRF':csrf}:{}),
      ...(expectedSession?{'X-Plannix-Expected-Session':expectedSession}:{}),
      ...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json().catch(()=>null),
      cookie:response.headers.get('set-cookie')?.split(';')[0]||null};
  };
  try {
    const boot=await request('/bootstrap');
    const login=await request('/login',{method:'POST',cookie:boot.cookie,
      csrf:boot.body.csrfToken,body:{email:'a@example.test',password:'synthetic'}});
    const cookie=`${boot.cookie}; ${login.cookie}`;
    const status=await request('/status',{cookie});
    const pending=await request('/profile/password',{method:'POST',cookie,
      csrf:status.body.csrfToken,
      body:{currentPassword:'synthetic-old',newPassword:'synthetic-new'}});
    assert.equal(pending.status,503);
    assert.match(pending.body.message,/could not be confirmed/);
    assert.equal(pending.cookie,null);
    complete({access_token:'late-token',refresh_token:'late-refresh'});
    await Promise.resolve();
    assert.equal((await request('/status',{cookie})).body.userId,OWNER_A);
  } finally { await new Promise(resolve=>live.close(resolve)); }
});
