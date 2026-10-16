import test from 'node:test';
import assert from 'node:assert/strict';
import { createDistributedAuthLimiter } from './distributedAuthLimiter.js';

const key=Buffer.alloc(32,7);
const request=(peer='127.0.0.1',forwarded) => ({
  socket:{remoteAddress:peer}, headers:forwarded===undefined?{}:{'x-forwarded-for':forwarded},
});

test('shared claims use opaque, separate network, binding and network-email keys',async()=>{
  const calls=[];
  const limiter=createDistributedAuthLimiter({key,rpc:async(name,args)=>{
    calls.push({name,args});return {data:{allowed:true,retry_after:30}};
  }});
  await limiter.check(request(),'login',{bindingName:'__Host-plannix-b-1',email:'Teacher@Example.test'});
  assert.equal(calls[0].name,'plannix_auth_rate_attempt');
  assert.equal(calls[0].args.attempts.length,3);
  assert.ok(calls[0].args.attempts.every(item=>/^[a-f0-9]{64}$/.test(item.key)));
  assert.doesNotMatch(JSON.stringify(calls),/Teacher|Example|__Host|127\.0\.0\.1/);
  const first=calls[0].args.attempts;
  await limiter.check(request('127.0.0.2'),'login',
    {bindingName:'__Host-plannix-b-1',email:'teacher@example.test'});
  assert.notEqual(calls[1].args.attempts[2].key,first[2].key,
    'another network cannot globally lock the email bucket');
  assert.equal(calls[1].args.attempts[1].key,first[1].key,
    'verified binding follows the device across networks');
});

test('proxy headers cannot evade or poison network identity',async()=>{
  assert.throws(()=>createDistributedAuthLimiter({key,rpc:async()=>({}),
    trustedProxyCidrs:['0.0.0.0/0']}),/Trusted proxy/);
  const calls=[];
  const limiter=createDistributedAuthLimiter({key,trustedProxyCidrs:['loopback'],
    rpc:async(_name,args)=>{calls.push(args);return {data:{allowed:true,retry_after:30}};}});
  await limiter.check(request('127.0.0.1','198.51.100.1'),'login');
  assert.equal(calls.length,1);
  for (const value of ['198.51.100.1, 203.0.113.5','not-an-ip',''])
    await assert.rejects(limiter.check(request('127.0.0.1',value),'login'),
      error=>error.status===503);
  await assert.rejects(limiter.check(request('198.51.100.8','203.0.113.5'),'login'),
    error=>error.status===503);
  assert.equal(calls.length,1);
});

test('store failure and malformed responses fail closed; 429 is bounded',async()=>{
  const fail=createDistributedAuthLimiter({key,rpc:async()=>{throw Error('sensitive transport');}});
  await assert.rejects(fail.check(request(),'login'),error=>error.status===503
    && !error.message.includes('sensitive'));
  const malformed=createDistributedAuthLimiter({key,rpc:async()=>({data:{allowed:false,retry_after:600}})});
  await assert.rejects(malformed.check(request(),'login'),error=>error.status===503);
  const denied=createDistributedAuthLimiter({key,rpc:async()=>({data:{allowed:false,retry_after:2}})});
  await assert.rejects(denied.check(request(),'signup'),error=>error.status===429
    && error.retryAfter===2);
  const stalled=createDistributedAuthLimiter({key,deadlineMs:10,rpc:()=>new Promise(()=>{})});
  await assert.rejects(stalled.check(request(),'recovery'),error=>error.status===503);
});

test('sensitive routes have separate bounded categories',async()=>{
  const calls=[];
  const limiter=createDistributedAuthLimiter({key,rpc:async(_name,args)=>{
    calls.push(args.attempts);
    return {data:{allowed:true,retry_after:30}};
  }});
  const categories=['bootstrap','status','me','login','signup','recovery',
    'callback','emailChange','profileName','passwordChange','recoveryUpdate',
    'refresh','logout','deletion'];
  for(const category of categories) await limiter.check(request(),category,
    {bindingName:'__Host-plannix-b-1',email:'synthetic@example.test'});
  assert.equal(new Set(calls.map(items=>items[0].key)).size,categories.length);
  assert.ok(calls.every(items=>items.length>=2 && items.length<=3
    && items.every(item=>Number.isInteger(item.maximum)
      && item.maximum>=1 && item.maximum<=300)));
});
