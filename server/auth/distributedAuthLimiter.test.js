import test from 'node:test';
import assert from 'node:assert/strict';
import proxyaddr from 'proxy-addr';
import { createDistributedAuthLimiter } from './distributedAuthLimiter.js';

const key=Buffer.alloc(32,7);
const request=(peer='127.0.0.1',headers={}) => ({
  socket:{remoteAddress:peer}, headers,
});
const create=(options={})=>createDistributedAuthLimiter({epoch:1,...options});

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

test('proxy headers cannot evade or poison network identity',async()=>{
  assert.throws(()=>create({key,rpc:async()=>({}),
    trustedPeerCidrs:['0.0.0.0/0']}),/Trusted proxy/);
  assert.throws(()=>create({key,rpc:async()=>({}),
    trustedPeerCidrs:['loopback']}),/Trusted proxy/);
  const calls=[];
  const limiter=create({key,trustedPeerCidrs:['127.0.0.0/24'],
    trustedIngressCidrs:['127.0.0.0/24'],
    rpc:async(_name,args)=>{calls.push(args);return {data:{allowed:true,retry_after:30}};}});
  await limiter.check(request('127.0.0.1',{'do-connecting-ip':'198.51.100.1',
    'x-forwarded-for':'127.0.0.2'}),'login');
  assert.equal(calls.length,1);
  for (const value of ['198.51.100.1, 203.0.113.5','not-an-ip',''])
    await assert.rejects(limiter.check(request('127.0.0.1',{'do-connecting-ip':value,
      'x-forwarded-for':'127.0.0.2'}),'login'),
      error=>error.status===503);
  for (const headers of [{'do-connecting-ip':'198.51.100.1'},
    {'x-forwarded-for':'127.0.0.2'},
    {'do-connecting-ip':'198.51.100.1','x-forwarded-for':'127.0.0.2',
      'forwarded':'for=203.0.113.9'},
    {'do-connecting-ip':'198.51.100.1','x-forwarded-for':'127.0.0.2',
      'x-real-ip':'203.0.113.9'},
    {'do-connecting-ip':'198.51.100.1','x-forwarded-for':'203.0.113.5'},
    {'do-connecting-ip':'127.0.0.2','x-forwarded-for':'127.0.0.2'}])
    await assert.rejects(limiter.check(request('127.0.0.1',headers),'login'),
      error=>error.status===503);
  await assert.rejects(limiter.check(request('198.51.100.8',
    {'do-connecting-ip':'198.51.100.1','x-forwarded-for':'127.0.0.2'}),'login'),
    error=>error.status===503);
  await assert.rejects(limiter.check({socket:{remoteAddress:'127.0.0.1'},
    headers:{'do-connecting-ip':'198.51.100.1','x-forwarded-for':'127.0.0.2'},
    rawHeaders:['Do-Connecting-IP','198.51.100.1','do-connecting-ip','198.51.100.2',
      'X-Forwarded-For','127.0.0.2']},'login'),error=>error.status===503);
  assert.equal(calls.length,1);
});

test('both proxy allowlists reject broad, aggregate-broad and noncanonical CIDRs before claims',()=>{
  let claims=0;
  const rpc=async()=>{claims++;return {data:{allowed:true,retry_after:1}};};
  const invalid=[
    '0.0.0.0/1','128.0.0.0/1','::/1','8000::/1',
    '0.0.0.0/0','::/0','192.0.2.4/24','2001:db8::1/64',
    '192.0.2.0/33','2001:db8::/129','192.0.2.0/024',
    '192.0.2.0/24,','fe80::%eth0/64',
    '::ffff:192.0.2.0/120','::ffff:c000:200/120',
    '::ffff:0:0/96','::ffff:0:0/128','::ffff:ffff:ffff/128',
    '::/64','::fffe:0:0/95',
  ];
  for (const cidr of invalid) for (const field of ['trustedPeerCidrs','trustedIngressCidrs'])
    assert.throws(()=>create({key,rpc,[field]:[cidr]}),/Trusted proxy/,
      `${field}: ${cidr}`);
  for (const entries of [
    ['10.0.0.0/24','10.0.1.0/24'], // adjacent: together a forbidden /23
    ['2001:db8:1::/64','2001:db8:1:1::/64'],
    ['192.0.2.0/24','192.0.2.0/25'], // overlap is ambiguous
    Array.from({length:33},(_,i)=>`198.51.${i}.0/24`),
  ]) for (const field of ['trustedPeerCidrs','trustedIngressCidrs'])
    assert.throws(()=>create({key,rpc,[field]:entries}),/Trusted proxy/);
  assert.equal(claims,0);
  assert.equal(proxyaddr.compile(['::ffff:0:0/96'])('198.51.100.10'),true,
    'the installed matcher treats the hex mapped range as all IPv4 peers');
  assert.equal(proxyaddr.compile(['::/64'])('198.51.100.10'),true,
    'an intersecting IPv6 supernet would also match an IPv4 peer');
  assert.doesNotThrow(()=>create({key,rpc,
    trustedPeerCidrs:['192.0.2.0/25','192.0.2.128/25'],
    trustedIngressCidrs:['2001:db8:1::/65','2001:db8:1:0:8000::/65']}));
  assert.doesNotThrow(()=>create({key,rpc,
    trustedPeerCidrs:['::fffe:ffff:ffff/128'],
    trustedIngressCidrs:['::1:0:0:0/128']}),
  'ranges immediately beside mapped space remain valid');
});

test('independent replicas key the documented visitor header, not the ingress address',async()=>{
  const first=[]; const second=[];
  const make=(calls)=>create({key,trustedPeerCidrs:['127.0.0.0/24'],
    trustedIngressCidrs:['127.0.0.0/24'],
    rpc:async(_name,args)=>{calls.push(args);return {data:{allowed:true,retry_after:20}};}});
  const a=make(first); const b=make(second);
  await a.check(request('127.0.0.1',{'do-connecting-ip':'198.51.100.10',
    'x-forwarded-for':'127.0.0.2'}),'login');
  await b.check(request('127.0.0.3',{'do-connecting-ip':'198.51.100.10',
    'x-forwarded-for':'127.0.0.4'}),'login');
  assert.equal(first[0].attempts[0].key,second[0].attempts[0].key);
  assert.equal(first[0].expected_key_tag,second[0].expected_key_tag);
  await b.check(request('127.0.0.3',{'do-connecting-ip':'198.51.100.11',
    'x-forwarded-for':'127.0.0.4'}),'login');
  assert.notEqual(first[0].attempts[0].key,second[1].attempts[0].key);
});

test('an ingress address is not implicitly an authorized direct peer',async()=>{
  const limiter=create({key,trustedPeerCidrs:['127.0.0.0/24'],
    trustedIngressCidrs:['192.0.2.0/24'],
    rpc:async()=>({data:{allowed:true,retry_after:20}})});
  await limiter.check(request('127.0.0.1',{'do-connecting-ip':'198.51.100.1',
    'x-forwarded-for':'192.0.2.5'}),'login');
  await assert.rejects(limiter.check(request('192.0.2.5',
    {'do-connecting-ip':'198.51.100.1','x-forwarded-for':'192.0.2.5'}),'login'),
    error=>error.status===503);
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
