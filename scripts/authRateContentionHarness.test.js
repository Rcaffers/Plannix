import test from 'node:test';
import assert from 'node:assert/strict';
import { runObservedContention } from './authRateContentionHarness.js';

function deferred() {
  let resolve; let reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

async function withControlledTimers(run) {
  const originalNow=Date.now;
  const originalSetTimeout=globalThis.setTimeout;
  const originalClearTimeout=globalThis.clearTimeout;
  const timers=new Map();
  let now=1000;
  let nextId=0;
  let fired=0;
  Date.now=()=>now;
  globalThis.setTimeout=(callback,delay)=>{
    const id=++nextId;
    timers.set(id,{callback,at:now+delay});
    return id;
  };
  globalThis.clearTimeout=id=>{timers.delete(id);};
  try {
    await run({
      active:()=>timers.size,
      scheduled:()=>nextId,
      fired:()=>fired,
      advance(ms) {
        now+=ms;
        for (const [id,timer] of [...timers]) {
          if (timer.at<=now) {
            timers.delete(id);
            fired++;
            timer.callback();
          }
        }
      },
    });
  } finally {
    Date.now=originalNow;
    globalThis.setTimeout=originalSetTimeout;
    globalThis.clearTimeout=originalClearTimeout;
  }
}

test('observation failure rolls back, settles work, and preserves the original assertion',async()=>{
  const terminal=deferred();
  const pending=deferred();
  const primary=new assert.AssertionError({message:'intended lock wait not observed'});
  const secondary=new Error('synthetic holder cleanup failed');
  const pendingError=new Error('synthetic pending claim failed');
  const reports=[]; const releases=[];
  await assert.rejects(runObservedContention({
    holder:{ready:Promise.resolve(),done:terminal.promise,
      release(command){
        releases.push(command);
        pending.reject(pendingError);
        terminal.reject(secondary);
      },kill(){throw Error('kill must not be needed');}},
    startPending:()=>[pending.promise],
    observe:()=>{throw primary;},
    validate:()=>{throw Error('must not validate');},
    onCleanupError:error=>reports.push(error),cleanupMs:20,
  }),error=>error===primary);
  assert.deepEqual(releases,['rollback']);
  assert.deepEqual(reports,[secondary,pendingError]);
});

test('a stuck holder is force-stopped within the cleanup bound without masking failure',async()=>{
  const terminal=deferred();
  const primary=new Error('observed assertion failure');
  const reports=[]; let killed=0;
  await assert.rejects(runObservedContention({
    holder:{ready:Promise.resolve(),done:terminal.promise,release(){},
      kill(){killed++;terminal.reject(new Error('terminated holder'));}},
    startPending:()=>[Promise.resolve('claim settled')],
    observe:()=>{throw primary;},
    validate:()=>{},onCleanupError:error=>reports.push(error),cleanupMs:10,
  }),error=>error===primary);
  assert.equal(killed,1);
  assert.equal(reports.length,1);
  assert.match(reports[0].message,/terminated holder/);
});

test('successful observation commits and waits for holder and pending claims',async()=>{
  const terminal=deferred(); const pending=deferred();
  const releases=[];
  const result=await runObservedContention({
    holder:{ready:Promise.resolve(),done:terminal.promise,
      release(command){releases.push(command);pending.resolve('allowed');terminal.resolve();},
      kill(){throw Error('unexpected kill');}},
    startPending:()=>[pending.promise],observe:()=>{},
    validate:values=>{assert.deepEqual(values,['allowed']);return 'verified';},
    cleanupMs:20,
  });
  assert.equal(result,'verified');
  assert.deepEqual(releases,['commit']);
});

test('the overall deadline includes non-settling holder readiness',async()=>{
  const ready=deferred(); const terminal=deferred();
  const releases=[];
  await assert.rejects(runObservedContention({
    holder:{ready:ready.promise,done:terminal.promise,
      release(command){releases.push(command);terminal.resolve();},kill(){throw Error('unexpected kill');}},
    startPending:()=>{throw Error('must not start claims');},
    observe:()=>{},validate:()=>{},operationMs:15,cleanupMs:60,
  }),/Contention operation exceeded its deadline/);
  assert.deepEqual(releases,['rollback']);
  ready.reject(new Error('late readiness rejection'));
  await new Promise(resolve=>setImmediate(resolve));
});

test('the overall deadline includes non-settling observation',async()=>{
  const observation=deferred(); const terminal=deferred();
  const releases=[];
  await assert.rejects(runObservedContention({
    holder:{ready:Promise.resolve(),done:terminal.promise,
      release(command){releases.push(command);terminal.resolve();},kill(){throw Error('unexpected kill');}},
    startPending:()=>[Promise.resolve('claim')],observe:()=>observation.promise,
    validate:()=>{},operationMs:15,cleanupMs:60,
  }),/Contention operation exceeded its deadline/);
  assert.deepEqual(releases,['rollback']);
  observation.reject(new Error('late observation rejection'));
  await new Promise(resolve=>setImmediate(resolve));
});

test('pending claim or pause work cannot prevent cleanup and late rejection is observed',async()=>{
  const pending=deferred(); const terminal=deferred();
  const releases=[]; const reports=[];
  await assert.rejects(runObservedContention({
    holder:{ready:Promise.resolve(),done:terminal.promise,
      release(command){releases.push(command);terminal.resolve();},kill(){throw Error('unexpected kill');}},
    startPending:()=>[pending.promise],observe:()=>{},validate:()=>{},
    onCleanupError:error=>reports.push(error.message),operationMs:15,cleanupMs:25,
  }),/Contention operation exceeded its deadline/);
  assert.deepEqual(releases,['commit']);
  assert.ok(reports.some(message=>message.includes('Pending database work did not settle')));
  pending.reject(new Error('late claim rejection'));
  await new Promise(resolve=>setImmediate(resolve));
});

test('holder completion is covered by the operation deadline and escalates to kill',async()=>{
  const terminal=deferred(); let killed=0; const releases=[];
  await assert.rejects(runObservedContention({
    holder:{ready:Promise.resolve(),done:terminal.promise,
      release(command){releases.push(command);},
      kill(){killed++;terminal.reject(new Error('terminated child'));}},
    startPending:()=>[Promise.resolve('claim')],observe:()=>{},validate:()=>{},
    operationMs:15,cleanupMs:60,onCleanupError:()=>{},
  }),/Contention operation exceeded its deadline/);
  assert.deepEqual(releases,['commit']);
  assert.equal(killed,1);
});

test('non-settling commit release enters bounded cleanup and preserves its timeout',async()=>{
  const terminal=deferred(); const commit=deferred();
  const reports=[]; const releases=[]; let killed=0;
  await assert.rejects(runObservedContention({
    holder:{ready:Promise.resolve(),done:terminal.promise,
      release(command) {
        releases.push(command);
        if (command==='commit') return commit.promise;
        terminal.reject(new Error('synthetic rollback failure'));
      },kill(){killed++;}},
    startPending:()=>[Promise.resolve('claim')],observe:()=>{},
    validate:()=>{throw Error('validation must not run');},
    onCleanupError:error=>reports.push(error.message),operationMs:15,cleanupMs:45,
  }),/Contention operation exceeded its deadline/);
  assert.deepEqual(releases,['commit','rollback']);
  assert.equal(killed,0);
  assert.deepEqual(reports,['synthetic rollback failure']);
  commit.reject(new Error('late commit failure'));
  await new Promise(resolve=>setImmediate(resolve));
});

test('non-settling validation enters bounded cleanup without replacing its timeout',async()=>{
  const terminal=deferred(); const validation=deferred();
  const releases=[]; const reports=[];
  await assert.rejects(runObservedContention({
    holder:{ready:Promise.resolve(),done:terminal.promise,
      release(command){releases.push(command);terminal.reject(new Error('synthetic holder failure'));},
      kill(){throw Error('holder already settled');}},
    startPending:()=>[Promise.resolve('claim')],observe:()=>{},
    validate:()=>validation.promise,
    onCleanupError:error=>reports.push(error.message),operationMs:15,cleanupMs:45,
  }),/Contention operation exceeded its deadline/);
  assert.deepEqual(releases,['commit']);
  assert.deepEqual(reports,['synthetic holder failure']);
  validation.reject(new Error('late validation failure'));
  await new Promise(resolve=>setImmediate(resolve));
});

test('early success cancels all operation and cleanup timers',async()=>{
  await withControlledTimers(async timers=>{
    const terminal=deferred();
    const result=await runObservedContention({
      holder:{ready:Promise.resolve(),done:terminal.promise,
        release(){terminal.resolve();},kill(){throw Error('unexpected kill');}},
      startPending:()=>[Promise.resolve('claim')],observe:()=>{},
      validate:()=> 'verified',operationMs:100,cleanupMs:90,
    });
    assert.equal(result,'verified');
    assert.ok(timers.scheduled()>0);
    assert.equal(timers.active(),0);
    timers.advance(1000);
    await Promise.resolve();
    assert.equal(timers.fired(),0);
    assert.equal(timers.active(),0);
  });
});

test('early failure cancels timers without a late timeout replacing the primary error',async()=>{
  await withControlledTimers(async timers=>{
    const terminal=deferred();
    const primary=new Error('primary observation failure');
    const reports=[];
    await assert.rejects(runObservedContention({
      holder:{ready:Promise.resolve(),done:terminal.promise,
        release(){terminal.resolve();},kill(){throw Error('unexpected kill');}},
      startPending:()=>[Promise.resolve('claim')],observe:()=>{throw primary;},
      validate:()=>{throw Error('must not validate');},
      onCleanupError:error=>reports.push(error),operationMs:100,cleanupMs:90,
    }),error=>error===primary);
    assert.ok(timers.scheduled()>0);
    assert.equal(timers.active(),0);
    timers.advance(1000);
    await Promise.resolve();
    assert.equal(timers.fired(),0);
    assert.deepEqual(reports,[]);
  });
});

test('non-settling rollback and termination share one finite cleanup budget',async()=>{
  const ready=deferred(); const terminal=deferred();
  const rollback=deferred(); const termination=deferred();
  const reports=[]; let killCalls=0;
  await assert.rejects(runObservedContention({
    holder:{ready:ready.promise,done:terminal.promise,
      release(){return rollback.promise;},kill(){killCalls++;return termination.promise;}},
    startPending:()=>[],observe:()=>{},validate:()=>{},
    onCleanupError:error=>reports.push(error.message),operationMs:10,cleanupMs:45,
  }),/Contention operation exceeded its deadline/);
  assert.equal(killCalls,1);
  assert.ok(reports.some(message=>message.includes('Holder rollback exceeded')));
  assert.ok(reports.some(message=>message.includes('Holder termination exceeded')));
  assert.ok(reports.some(message=>message.includes('Holder did not terminate')));
  ready.reject(new Error('late ready'));
  rollback.reject(new Error('late rollback'));
  termination.reject(new Error('late kill'));
  terminal.reject(new Error('late close'));
  await new Promise(resolve=>setImmediate(resolve));
});
