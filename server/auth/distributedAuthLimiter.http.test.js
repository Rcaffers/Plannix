import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServerSessionTestApp } from './serverSessionTestApp.js';
import { createDistributedAuthLimiter } from './distributedAuthLimiter.js';

test('two independent Express instances share claims; rejected login has no auth side effect',async()=>{
  const counters=new Map();
  let storeFails=false;
  const rpc=async(_name,{attempts})=>{
    if (storeFails) throw Error('synthetic store secret');
    let allowed=true;
    for (const item of attempts) {
      const value=(counters.get(item.key)||0)+1;
      counters.set(item.key,value);
      if (value>item.maximum) allowed=false;
    }
    return {data:{allowed,retry_after:17}};
  };
  const limiters=Array.from({length:2},()=>createDistributedAuthLimiter({
    rpc,key:Buffer.alloc(32,9),
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
    assert.equal(began,0);
    assert.equal(providerCalls,0);
  } finally {
    await Promise.all(servers.map(({server})=>new Promise(resolve=>server.close(resolve))));
  }
});
