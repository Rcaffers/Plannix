import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createServerSessionTestApp } from './serverSessionTestApp.js';
import { createDistributedAuthLimiter } from './distributedAuthLimiter.js';

test('two independent Express instances share claims; rejected login has no auth side effect',async()=>{
  const counters=new Map();
  let storeFails=false;
  let paused=false;
  let activeEpoch=1;
  const rpc=async(_name,{attempts,expected_epoch})=>{
    if (storeFails) throw Error('synthetic store secret');
    if (paused || expected_epoch!==activeEpoch) return {data:{state:'unavailable'}};
    let allowed=true;
    for (const item of attempts) {
      const value=(counters.get(item.key)||0)+1;
      counters.set(item.key,value);
      if (value>item.maximum) allowed=false;
    }
    return {data:{allowed,retry_after:17}};
  };
  const limiters=Array.from({length:2},()=>createDistributedAuthLimiter({
    rpc,key:Buffer.alloc(32,9),epoch:1,
  }));
  assert.notStrictEqual(limiters[0],limiters[1]);
  let began=0;let providerCalls=0;
  const repository={
    async resolve(){return {state:'selected',header:'__Host-plannix-b-1=synthetic',
      markerName:'__Host-plannix-b-1',sessionName:null,cleanup:[]};},
    async begin(){began++;return {state:'started',intentId:'synthetic'};},
    async readTokens(){return {state:'missing'};},
  };
  const identity={async login(){providerCalls++;throw Error('should not run');},
    async validateAccess(){throw Error('should not run');}};
  const servers=[];
  try {
    for(let i=0;i<2;i++) {
      const probe=createServer().listen(0,'127.0.0.1');
      await new Promise(resolve=>probe.once('listening',resolve));
      const port=probe.address().port;
      await new Promise(resolve=>probe.close(resolve));
      const origin=`http://127.0.0.1:${port}`;
      const app=createServerSessionTestApp({origin,repository,identity,
        csrfKey:Buffer.alloc(32,1),limiter:limiters[i]});
      const server=app.listen(port,'127.0.0.1');
      await new Promise(resolve=>server.once('listening',resolve));
      servers.push({server,origin});
    }
    async function login(instance,extraHeaders={}) {
      const {origin}=servers[instance];
      return fetch(`${origin}/__stage3/auth/login`,{method:'POST',
        headers:{Origin:origin,'Content-Type':'application/json',...extraHeaders},
        body:JSON.stringify({email:'synthetic@example.test',password:'synthetic'})});
    }
    for(let i=0;i<8;i++) assert.equal((await login(i%2)).status,403);
    const denied=await login(1);
    assert.equal(denied.status,429);
    assert.equal(denied.headers.get('retry-after'),'17');
    assert.deepEqual(await denied.json(),
      {message:'Too many authentication attempts. Please wait before trying again.'});
    const spoofed=await login(0,{'X-Forwarded-For':'203.0.113.10'});
    assert.equal(spoofed.status,503,'untrusted forwarding cannot evade the shared bucket');
    storeFails=true;
    const failed=await login(0);
    assert.equal(failed.status,503);
    assert.doesNotMatch(await failed.text(),/synthetic store secret/);
    storeFails=false;
    paused=true;
    assert.equal((await login(0)).status,503);
    paused=false;
    activeEpoch=2;
    assert.equal((await login(1)).status,503);
    assert.equal(began,0);
    assert.equal(providerCalls,0);
  } finally {
    await Promise.all(servers.map(({server})=>new Promise(resolve=>server.close(resolve))));
  }
});

test('real HTTP duplicate and conflicting ingress headers fail before a claim',async()=>{
  let claims=0;
  const limiter=createDistributedAuthLimiter({key:Buffer.alloc(32,9),epoch:1,
    trustedPeerCidrs:['127.0.0.0/24'],trustedIngressCidrs:['127.0.0.0/24'],
    rpc:async()=>{claims++;return {data:{allowed:true,retry_after:20}};}});
  const server=createServer((req,res)=>{
    limiter.check(req,'login').then(()=>{res.statusCode=204;res.end();},error=>{
      res.statusCode=error.status;res.end();
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const send=headers=>new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port:server.address().port,
      method:'POST',path:'/',headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.once('error',reject);req.end();
  });
  try {
    assert.equal(await send({'Do-Connecting-IP':'198.51.100.10',
      'X-Forwarded-For':'127.0.0.2'}),204);
    assert.equal(await send({'Do-Connecting-IP':['198.51.100.10','198.51.100.11'],
      'X-Forwarded-For':'127.0.0.2'}),503);
    assert.equal(await send({'Do-Connecting-IP':'198.51.100.10',
      'X-Forwarded-For':'198.51.100.10'}),503);
    assert.equal(claims,1);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
