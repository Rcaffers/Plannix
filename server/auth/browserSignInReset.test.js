import test from 'node:test';
import assert from 'node:assert/strict';
import { createDistributedAuthLimiter } from './distributedAuthLimiter.js';
import { createBrowserResetProofs, orphanContext } from './browserSignInReset.js';
const key = Buffer.alloc(32,7), origin = 'https://app.test';
const header = `__Host-plannix-s-12=${'a'.repeat(43)}`;
test('proof is short-lived, context/purpose-bound and contains no credential or name',()=>{
  let now=100000;
  const proofs=createBrowserResetProofs({key,origin,now:()=>now});
  const context=orphanContext(header), proof=proofs.issue(context);
  assert.ok(proofs.verify(proof,context));
  const decoded=Buffer.from(proof.split('.')[0],'base64url').toString();
  assert.ok(!decoded.includes('__Host') && !decoded.includes('a'.repeat(43)));
  assert.equal(proofs.verify(proof,orphanContext(header.replace('-12=','-13='))),null);
  assert.equal(proofs.verify(proof,orphanContext(header.replace('a'.repeat(43),'b'.repeat(43)))),null);
  assert.equal(createBrowserResetProofs({key,origin:'https://other.test',now:()=>now}).verify(proof,context),null);
  assert.equal(proofs.verify(proof+'x',context),null);
  now+=60000; assert.equal(proofs.verify(proof,context),null);
});
test('only one ordinary orphan-shaped auth cookie is eligible',()=>{
  assert.ok(orphanContext(header));
  for(const h of ['',header+'; '+header,header.replace('-s-','-r-'),
    header+'; __Host-plannix-b-3='+'b'.repeat(43),header+'; __Host-plannix-s-13='+'c'.repeat(43),
    header.replace('12','0'),header.replace('a'.repeat(43),'bad')]) assert.equal(orphanContext(h),null);
});

test('reset has a distinct six-per-minute network bucket without a binding',async()=>{
  let args;
  const limiter=createDistributedAuthLimiter({key,epoch:1,mode:'direct',rpc:async(_name,input)=>{
    args=input; return {data:{allowed:true,retry_after:60}};
  }});
  await limiter.check({headers:{},socket:{remoteAddress:'127.0.0.1'}},'browserReset');
  assert.equal(args.attempts.length,1);
  assert.equal(args.attempts[0].maximum,6);
  assert.doesNotMatch(JSON.stringify(args),/127\.0\.0\.1|__Host/);
});


test('executable preflight fails closed on unsupported database or gateway settings',async()=>{
  const {evaluateBrowserResetPreflight}=await import('../../scripts/check-browser-reset-preflight.js');
  const database={postgresSupported:true,fsyncEnabled:true,fullPageWritesEnabled:true,synchronousCommitEnabled:true,primary:true};
  assert.ok(Object.values(evaluateBrowserResetPreflight(database,'db-tx-end = "commit"')).every(Boolean));
  for(const key of Object.keys(database)) assert.equal(evaluateBrowserResetPreflight({...database,[key]:false},'db-tx-end = "commit"')[key],false);
  for(const configuration of ['', 'db-tx-end = "rollback"','db-tx-end = "commit-allow-override"',
    'db-tx-end = "rollback-allow-override"','db-tx-end = "commit"\ndb-tx-end = "commit"'])
    assert.equal(evaluateBrowserResetPreflight(database,configuration).gatewayAlwaysCommits,false);
  assert.ok(Object.values(evaluateBrowserResetPreflight(null,null)).every(x=>x===false));
});
