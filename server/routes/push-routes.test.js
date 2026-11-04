import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { registerPushRoutes } from './push-routes.js';
import { createRequireServerSession } from '../auth/requireServerSession.js';
import { createSessionRequestSecurity } from '../auth/sessionRequestSecurity.js';

const userId = 'ca000000-0000-4000-8000-000000000001';
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-device-token';
const subscription = { endpoint, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } };
const version = 'ca000000-0000-4000-8000-000000000099';
const headers = { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' };
async function harness({ confirmed = true, serviceResult = { accepted: true } } = {}) {
  const calls = [];
  const app = express();
  const auth = createRequireSupabaseAuth({ getClient: () => ({ auth: { getUser: async () => ({ data: { user: confirmed ? { id: userId, email_confirmed_at: '2026-01-01' } : null }, error: null }) } }) });
  const service = {
    configured: () => true, publicKey: () => 'public-key-only',
    status: async (...args) => { calls.push(['status', ...args]); return { registered:true }; },
    register: async (...args) => { calls.push(['register', ...args]); },
    claim: async (...args) => { calls.push(['claim', ...args]); return { state: 'current', version }; },
    remove: async (...args) => { calls.push(['remove', ...args]); return true; },
    sendTest: async (...args) => { calls.push(['test', ...args]); return serviceResult; },
  };
  registerPushRoutes({ app, requireAuth: auth, service }); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise(resolve => server.close(resolve)) };
}
const post = (h, path, body, customHeaders = headers) => fetch(`${h.url}/api/notifications/${path}`, {
  method: 'POST', headers: customHeaders, body: JSON.stringify(body),
});

test('all notification operations require confirmed auth and never expose a private key', async () => {
  const h = await harness({ confirmed: false });
  try {
    for (const [path, body] of [['status', { endpoint }], ['register', { subscription }], ['claim', { subscription }], ['remove', { endpoint, version }], ['test', { endpoint }]]) {
      const response = await post(h, path, body);
      assert.equal(response.status, 401);
    }
    const config = await fetch(`${h.url}/api/notifications/config`, { headers });
    assert.equal(config.status, 401);
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});
test('routes bind actions to confirmed user, keep endpoints out of URLs, and send tests through the server', async () => {
  const h = await harness();
  try {
    const config = await fetch(`${h.url}/api/notifications/config`, { headers });
    assert.deepEqual(await config.json(), { configured: true, publicKey: 'public-key-only' });
    for (const [path, body, result] of [
      ['status', { endpoint }, { registered: true }], ['register', { subscription }, { registered: true }],
      ['claim', { subscription }, { state: 'current', version }],
      ['test', { endpoint }, { accepted: true }], ['remove', { endpoint, version }, { removed: true }],
    ]) {
      const response = await post(h, path, body);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    }
    assert.deepEqual(h.calls.map(call => call[0]), ['status', 'register', 'claim', 'test', 'remove']);
    assert.deepEqual(h.calls.at(-1), ['remove', userId, endpoint, version, { sessionId: undefined }]);
    assert.ok(h.calls.every(call => call[1] === userId));
    assert.ok(h.calls.every(call => !JSON.stringify(call).includes('private-key')));
  } finally { await h.close(); }
});
test('invalid endpoints and oversized bodies fail before push service; rate limits and expiry are safe', async () => {
  const h = await harness({ serviceResult: { rateLimited: true } });
  try {
    const invalid = await post(h, 'test', { endpoint: 'https://evil.test/private' });
    assert.equal(invalid.status, 400);
    assert.equal(h.calls.length, 0);
    assert.equal((await post(h, 'remove', { endpoint })).status, 400);
    assert.equal((await post(h, 'remove', { endpoint, version: 'bad' })).status, 400);
    assert.equal(h.calls.length, 0);
    const tooLarge = await post(h, 'register', { subscription: { ...subscription, filler: 'x'.repeat(9000) } });
    assert.equal(tooLarge.status, 413);
    assert.equal(h.calls.length, 0);
    const limited = await post(h, 'test', { endpoint });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.doesNotMatch(JSON.stringify(await limited.json()), /synthetic-device-token/);
  } finally { await h.close(); }
  const expired = await harness({ serviceResult: { expired: true } });
  try { assert.equal((await post(expired, 'test', { endpoint })).status, 410); }
  finally { await expired.close(); }
  const replaced = await harness({ serviceResult: { superseded: true } });
  try { assert.equal((await post(replaced, 'test', { endpoint })).status, 409); }
  finally { await replaced.close(); }
});

test('server-mode routes carry only the guard-selected session and require an explicit observed version', async () => {
  const calls = [];
  const sessionId = 'ca000000-0000-4000-8000-000000000077';
  const app = express();
  const guard = (req, _res, next) => {
    req.auth = { userId };
    req.serverSession = { userId, sessionId };
    next();
  };
  registerPushRoutes({ app, requireAuth:guard, service:{
    configured:() => true,
    publicKey:() => 'public-only',
    status:async (...args) => { calls.push(['status',...args]);return {state:'current',registered:true,
      boundToCurrentSession:false,detailEligible:false}; },
    observe:async (...args) => { calls.push(['observe',...args]); return {state:'absent',version:null}; },
    register:async (...args) => { calls.push(['register',...args]); return {version}; },
  } });
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const url=`http://127.0.0.1:${server.address().port}`;
  const request=(path,body)=>fetch(`${url}/api/notifications/${path}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  try {
    assert.deepEqual(await (await fetch(`${url}/api/notifications/config`)).json(),
      {configured:true,publicKey:'public-only',detailDisplayAvailable:false});
    assert.equal((await request('detail-policy/set',{endpoint,installationVersion:version,
      policyVersion:version,enabled:true})).status,404);
    assert.equal((await request('register',{subscription})).status,400);
    assert.equal(calls.length,0);
    assert.deepEqual(await (await request('observe',{subscription})).json(),{state:'absent',version:null});
    assert.equal((await request('register',{subscription,expectedVersion:null})).status,200);
    assert.deepEqual(await (await request('status',{endpoint})).json(),{state:'current',registered:true,
      boundToCurrentSession:false,detailEligible:false});
    assert.deepEqual(calls.map(call=>call[0]),['observe','register','status']);
    assert.equal(calls[0][3].sessionId,sessionId);
    assert.deepEqual(calls[1][3],{sessionId,expectedVersion:null});
    assert.deepEqual(calls[2][3],{sessionId});
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('aborting the browser request does not pretend admitted server registration was cancelled', async () => {
  let admitted, release;
  const entered = new Promise(resolve => { admitted=resolve; });
  const work = new Promise(resolve => { release=resolve; });
  let completed=0;
  const app=express();
  registerPushRoutes({app,requireAuth:(req,_res,next)=>{
    req.auth={userId};req.serverSession={userId,sessionId:version};next();
  },service:{configured:()=>true,register:async()=>{admitted();await work;completed++;}}});
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  try {
    const controller=new AbortController();
    const request=fetch(`http://127.0.0.1:${server.address().port}/api/notifications/register`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({subscription,expectedVersion:null}),signal:controller.signal,
    });
    await entered;
    controller.abort();
    await assert.rejects(request,error=>error.name==='AbortError');
    release();
    // Server work has its own lifecycle. HTTP cancellation was not a rollback.
    await new Promise(resolve=>server.close(resolve));
    assert.equal(completed,1);
  } finally {release();if(server.listening) await new Promise(resolve=>server.close(resolve));}
});

test('external provider revocation fails before push registration or removal', async () => {
  const cookie=`__Host-plannix-b-1=${'a'.repeat(43)}; __Host-plannix-s-2=${'b'.repeat(43)}`;
  const app=express();
  let pushCalls=0;
  const server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const csrfKey=Buffer.alloc(32,7);
  const verified=createRequireServerSession({origin,csrfKey,
    repository:{resolveForApplication:async header=>({state:'current',header,
      sessionName:'__Host-plannix-s-2',sessionId:version,ownerId:userId,
      tokenVersion:1,accessToken:'synthetic-access'})},
    identity:{validateAccess:async()=>{throw Error('Synthetic provider revocation');}},
  });
  registerPushRoutes({app,requireAuth:(req,res,next)=>verified(req,res,error=>{
    if(error) return next(error);
    req.auth={userId:req.serverSession.userId,accessToken:req.serverSession.accessToken};
    next();
  }),service:{configured:()=>true,register:async()=>{pushCalls++;},remove:async()=>{pushCalls++;}}});
  app.use(errorHandler);
  try {
    const request=body=>fetch(`${origin}/api/notifications/register`,{
      method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json',
        'x-plannix-expected-session':'__Host-plannix-s-2',
        'x-plannix-csrf':createSessionRequestSecurity({origin,csrfKey}).csrfFor(cookie)},
      body:JSON.stringify(body),
    });
    assert.equal((await request({subscription,expectedVersion:null})).status,503);
    assert.equal(pushCalls,0);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('detail policy routes require production ordinary-session CSRF and exact captured version', async () => {
  const cookie=`__Host-plannix-b-1=${'a'.repeat(43)}; __Host-plannix-s-2=${'b'.repeat(43)}`;
  const app=express();let writes=0;
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const csrfKey=Buffer.alloc(32,7);
  const verified=createRequireServerSession({origin,csrfKey,
    repository:{resolveForApplication:async header=>({state:'current',header,
      sessionName:'__Host-plannix-s-2',sessionId:version,ownerId:userId,
      tokenVersion:1,accessToken:'synthetic-access'})},
    identity:{validateAccess:async()=>{}},
  });
  registerPushRoutes({app,config:{morningSummaryDetailDisplayEnabled:true,
    morningSummaryPilotUserId:userId},requireAuth:(req,res,next)=>verified(req,res,error=>{
    if(error) return next(error);
    req.auth={userId:req.serverSession.userId};next();
  }),service:{configured:()=>true,publicKey:()=> 'synthetic-public',
    detailPolicy:async()=>({enabled:false,policyVersion:version}),
    setDetailPolicy:async(...args)=>{writes++;assert.equal(args[0],userId);
      assert.equal(args[5].sessionId,version);return {enabled:true,policyVersion:version};},
  }});
  app.use(errorHandler);
  const endpointBody={endpoint,installationVersion:version,policyVersion:version,enabled:true};
  const request=(extra={})=>fetch(`${origin}/api/notifications/detail-policy/set`,{
    method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json',
      'X-Plannix-Expected-Session':'__Host-plannix-s-2',...extra},
    body:JSON.stringify(endpointBody),
  });
  try {
    assert.equal((await request()).status,403);
    assert.equal(writes,0);
    assert.equal((await request({'X-Plannix-CSRF':createSessionRequestSecurity({origin,csrfKey}).csrfFor(cookie),
      'X-Plannix-Expected-Session':'__Host-plannix-s-3'})).status,409);
    assert.equal(writes,0);
    const response=await request({'X-Plannix-CSRF':createSessionRequestSecurity({origin,csrfKey}).csrfFor(cookie)});
    assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal(writes,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
