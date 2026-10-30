import test from 'node:test';
import assert from 'node:assert/strict';
import { createDistributedAuthLimiter } from './distributedAuthLimiter.js';

const key=Buffer.alloc(32,7);
const request=(peer='127.0.0.1',headers={}) => ({
  socket:{remoteAddress:peer}, headers,
});
const create=(options={})=>createDistributedAuthLimiter({epoch:1,mode:'direct',...options});
const rawRequest=(peer,headers)=>({socket:{remoteAddress:peer},
  rawHeaders:headers.flatMap(([name,value])=>[name,value]),headers:{}});

test('shared claims use opaque, separate network, binding and network-email keys',async()=>{
  const calls=[];
  const limiter=create({key,rpc:async(name,args)=>{
    calls.push({name,args});return {data:{allowed:true,retry_after:30}};
  }});
  await limiter.check(request(),'login',{bindingName:'__Host-plannix-b-1',email:'Teacher@Example.test'});
  assert.equal(calls[0].name,'plannix_auth_rate_attempt');
  assert.equal(calls[0].args.expected_epoch,1);
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

test('missing and invalid identity modes fail at construction',()=>{
  for (const mode of [undefined,'','auto','proxy','DIGITALOCEAN-MANAGED'])
    assert.throws(()=>createDistributedAuthLimiter({key,epoch:1,rpc:async()=>({}),mode}),
      /not configured/);
});

test('managed mode requires one valid raw platform address before any claim',async()=>{
  const calls=[];
  const limiter=create({key,mode:'digitalocean-managed',
    rpc:async(_name,args)=>{calls.push(args);return {data:{allowed:true,retry_after:30}};}});
  const valid=rawRequest('not-a-peer',[
    ['Do-Connecting-IP','198.51.100.10'],['X-Forwarded-For','forged']]);
  await limiter.check(valid,'login');
  const invalid=[[],[['do-connecting-ip','']],
    [['DO-CONNECTING-IP','198.51.100.10'],['do-connecting-ip','198.51.100.11']],
    ...['198.51.100.10, 203.0.113.1','198.51.100.10 ','[2001:db8::1]',
      'fe80::1%eth0','not-an-ip','192.0.2.01','0.0.0.0','::',
      '::ffff:0.0.0.0','255.255.255.255',
      '::ffff:192.0.2.1, 192.0.2.2']
      .map(value=>[['do-connecting-ip',value]]),
  ];
  for (const headers of invalid)
    await assert.rejects(limiter.check(rawRequest('127.0.0.1',headers),'login'),
      error=>error.status===503);
  await assert.rejects(limiter.check({headers:{'do-connecting-ip':'198.51.100.10'},
    socket:{remoteAddress:'127.0.0.1'}},'login'),error=>error.status===503);
  await assert.rejects(limiter.check({rawHeaders:['do-connecting-ip'],
    socket:{remoteAddress:'127.0.0.1'}},'login'),error=>error.status===503);
  assert.equal(calls.length,1);
});

test('managed mode normalizes equivalent IPv4, IPv6 and mapped forms',async()=>{
  const calls=[];
  const limiter=create({key,mode:'digitalocean-managed',rpc:async(_name,args)=>{
    calls.push(args);return {data:{allowed:true,retry_after:30}};}});
  const check=value=>limiter.check(rawRequest('203.0.113.200',[
    ['do-connecting-ip',value]]),'login');
  for (const value of ['192.0.2.1','::ffff:192.0.2.1','::ffff:c000:201']) await check(value);
  assert.equal(calls[0].attempts[0].key,calls[1].attempts[0].key);
  assert.equal(calls[0].attempts[0].key,calls[2].attempts[0].key);
  await check('2001:0db8:0:0:0:0:0:1');
  await check('2001:db8::1');
  assert.equal(calls[3].attempts[0].key,calls[4].attempts[0].key);
  assert.notEqual(calls[0].attempts[0].key,calls[3].attempts[0].key);
});

test('managed mode ignores forged forwarding and socket identity',async()=>{
  const first=[]; const second=[];
  const make=(calls)=>create({key,mode:'digitalocean-managed',
    rpc:async(_name,args)=>{calls.push(args);return {data:{allowed:true,retry_after:20}};}});
  const a=make(first); const b=make(second);
  await a.check(rawRequest('127.0.0.1',[
    ['do-connecting-ip','198.51.100.10'],['x-forwarded-for','127.0.0.2']]),'login');
  await b.check(rawRequest('203.0.113.9',[
    ['DO-CONNECTING-IP','198.51.100.10'],['X-Forwarded-For','203.0.113.8'],
    ['Forwarded','for=192.0.2.100'],['X-Real-IP','192.0.2.101']]),'login');
  assert.equal(first[0].attempts[0].key,second[0].attempts[0].key);
  assert.equal(first[0].expected_key_tag,second[0].expected_key_tag);
  await b.check(rawRequest('127.0.0.1',[
    ['do-connecting-ip','198.51.100.11'],['x-forwarded-for','127.0.0.2']]),'login');
  assert.notEqual(first[0].attempts[0].key,second[1].attempts[0].key);
});

test('direct mode normalizes socket addresses and rejects proxy identity headers',async()=>{
  const calls=[];
  const limiter=create({key,rpc:async(_name,args)=>{
    calls.push(args);return {data:{allowed:true,retry_after:20}};}});
  await limiter.check(request('192.0.2.1'),'login');
  await limiter.check(request('::ffff:192.0.2.1'),'login');
  assert.equal(calls[0].attempts[0].key,calls[1].attempts[0].key);
  await limiter.check(request('2001:0db8::1'),'login');
  await limiter.check(request('2001:db8::1'),'login');
  assert.equal(calls[2].attempts[0].key,calls[3].attempts[0].key);
  for (const name of ['do-connecting-ip','x-forwarded-for','forwarded',
    'x-real-ip','cf-connecting-ip','true-client-ip','x-client-ip'])
    await assert.rejects(limiter.check(request('192.0.2.1',{[name]:'198.51.100.1'}),
      'login'),error=>error.status===503);
  await assert.rejects(limiter.check(request('not-an-ip'),'login'),error=>error.status===503);
  assert.equal(calls.length,4);
});

test('store failure and malformed responses fail closed; 429 is bounded',async()=>{
  const fail=create({key,rpc:async()=>{throw Error('sensitive transport');}});
  await assert.rejects(fail.check(request(),'login'),error=>error.status===503
    && !error.message.includes('sensitive'));
  const malformed=create({key,rpc:async()=>({data:{allowed:false,retry_after:600}})});
  await assert.rejects(malformed.check(request(),'login'),error=>error.status===503);
  const denied=create({key,rpc:async()=>({data:{allowed:false,retry_after:2}})});
  await assert.rejects(denied.check(request(),'signup'),error=>error.status===429
    && error.retryAfter===2);
  const stalled=create({key,deadlineMs:10,rpc:()=>new Promise(()=>{})});
  await assert.rejects(stalled.check(request(),'recovery'),error=>error.status===503);
});

test('sensitive routes have separate bounded categories',async()=>{
  const calls=[];
  const limiter=create({key,rpc:async(_name,args)=>{
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
