import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../components/MorningSummaryPanel.jsx', import.meta.url), 'utf8');
const callback = source.slice(source.indexOf('  async function enableDeviceDetails()'), source.indexOf('  const detailPreferences ='));
assert.match(callback, /^  async function enableDeviceDetails/);
const names = ['canRecoverDeviceDetails','savingRef','reloadingRef','conflict','detailDevice',
  'captureServerOperationContext','assertServerOperationContext','userId','preferenceGeneration',
  'setDetailUnknown','setDetailMessage','setSaving','preferenceApi','savedPreferences','setPreferences'];
const createAction = new Function('env', `const {${names.join(',')}} = env; return (${callback.trim()});`);
const deferred = () => { let resolve; const promise = new Promise(done => {resolve=done;}); return {promise,resolve}; };
function harness() {
  const h = {session:1, writes:0, reads:0, calls:[], events:[], entered:deferred()};
  const saved = {enabled:true, academicYearId:'year', lessonDetailConsent:true, eventTitleConsent:true};
  const env = {
    canRecoverDeviceDetails:true, savingRef:{current:false}, reloadingRef:{current:false}, conflict:false,
    userId:'account-a', preferenceGeneration:{current:1}, savedPreferences:value=>value,
    captureServerOperationContext:()=>({session:h.session}),
    assertServerOperationContext:context=>{if(context.session!==h.session)throw Error('Stale session');},
    preferenceApi:{load:async()=>saved, save:()=>{throw Error('Recovery must not save preferences');}},
    detailDevice:{loading:false,busy:false,perform:(_context,task)=>task(1),
      read:async()=>{h.reads++;return {subscribed:true,bound:true,serverEnabled:h.writes>0,enabled:h.writes>0, installationVersion:'installation-1',policyVersion:'policy-1'};},
      setPolicy:async (enabled,_context,_ticket,expected)=>{assert.equal(enabled,true);assert.deepEqual(expected,{installationVersion:'installation-1',policyVersion:'policy-1'});h.writes++;}},
  };
  for (const setter of ['setDetailUnknown','setDetailMessage','setSaving','setPreferences'])
    env[setter] = value=>h.events.push({setter,value});
  h.env=env; h.saved=saved; h.run=()=>createAction(env)();
  h.messages=()=>h.events.filter(e=>e.setter==='setDetailMessage').map(e=>e.value).join('\n');
  return h;
}
test('late preference read after account replacement cannot update the newer account or enable a policy', async () => {
  const h=harness(), held=deferred();
  h.env.preferenceApi.load=()=>{h.entered.resolve();return held.promise;};
  const running=h.run(); await h.entered.promise;
  h.session++; h.env.preferenceGeneration.current++;
  const before=h.events.length;
  held.resolve(h.saved); await running;
  assert.equal(h.events.length,before);
  assert.equal(h.writes,0);
});
test('admitted policy operation may settle after session replacement, but its late result is ignored without replay', async () => {
  const h=harness(), held=deferred();
  h.env.detailDevice.setPolicy=async()=>{h.writes++;h.entered.resolve();await held.promise;};
  const running=h.run(); await h.entered.promise;
  h.session++; h.env.preferenceGeneration.current++;
  const before=h.events.length;
  held.resolve(); await running;
  assert.equal(h.events.length,before);
  assert.equal(h.writes,1);
  assert.equal(h.reads,1,'no follow-up operation adopts the replacement session');
});
test('same-account session replacement cannot report success from an old operation', async () => {
  const h=harness(), held=deferred();
  h.env.detailDevice.setPolicy=async()=>{h.writes++;h.entered.resolve();await held.promise;};
  const running=h.run(); await h.entered.promise;
  h.session++; held.resolve(); await running;
  assert.equal(h.writes,1);
  assert.equal(h.reads,1);
  assert.doesNotMatch(h.messages(),/enabled and ready/);
  assert.match(h.messages(),/could not be confirmed/);
});
test('unknown policy read and withdrawn consent cannot lead to a policy write', async () => {
  for (const mode of ['unknown','withdrawn']) {
    const h=harness();
    if(mode==='unknown')h.env.detailDevice.read=async()=>({subscribed:true,bound:true,serverEnabled:null,enabled:false});
    else h.saved.lessonDetailConsent=h.saved.eventTitleConsent=false;
    await h.run(); assert.equal(h.writes,0);
    assert.doesNotMatch(h.messages(),/enabled and ready/);
  }
});
test('stale version rejection is read back, never automatically replayed', async () => {
  const h=harness();
  h.env.detailDevice.setPolicy=async()=>{h.writes++;throw Error('Version changed');};
  h.env.detailDevice.read=async()=>({subscribed:true,bound:true,serverEnabled:false,enabled:false});
  await h.run(); assert.equal(h.writes,1);
  assert.match(h.messages(),/No request was retried/);
});
test('uncertain write reports success only when server policy and worker readiness are confirmed', async () => {
  for (const ready of [true,false]) {
    const h=harness();
    h.env.detailDevice.setPolicy=async()=>{h.writes++;throw Error('Response lost');};
    h.env.detailDevice.read=async()=>({subscribed:true,bound:true,serverEnabled:h.writes>0,enabled:h.writes>0 && ready});
    await h.run(); assert.equal(h.writes,1);
    if(ready)assert.match(h.messages(),/readback confirms details are enabled and ready/);
    else { assert.doesNotMatch(h.messages(),/enabled and ready/);assert.match(h.messages(),/policy is enabled, but worker readiness/); }
  }
});
test('failed post-write readback remains unknown and never replays the write', async () => {
  const h=harness();
  h.env.detailDevice.read=async()=>{
    if(++h.reads>1)throw Error('Readback unavailable');
    return {subscribed:true,bound:true,serverEnabled:false,enabled:false,
      installationVersion:'installation-1',policyVersion:'policy-1'};
  };
  await h.run();
  assert.equal(h.writes,1);
  assert.equal(h.reads,2);
  assert.ok(h.events.some(e=>e.setter==='setDetailUnknown' && e.value===true));
  assert.doesNotMatch(h.messages(),/enabled and ready/);
});
test('a binding lost before the write is not re-registered or enabled', async () => {
  const h=harness();
  h.env.detailDevice.read=async()=>({subscribed:true,bound:false,serverEnabled:false,enabled:false});
  await h.run();
  assert.equal(h.writes,0);
  assert.match(h.messages(),/binding changed/);
});
