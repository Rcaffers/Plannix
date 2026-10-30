// Test-only coordination for disposable-database lock checks. Promises cannot
// be cancelled; deadlines bound our wait and child-process cleanup instead.
const TIMEOUT = Symbol('deadline exceeded');

function waitUntil(promise, deadline) {
  const remaining=Math.max(0,deadline-Date.now());
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(value=>({value}),error=>({error})),
    new Promise(resolve=>{timer=setTimeout(()=>resolve(TIMEOUT),remaining);}),
  ]).finally(()=>clearTimeout(timer));
}

export async function runObservedContention({holder, startPending, observe,
  validate, onCleanupError = error=>process.stderr.write(`Contention cleanup: ${error.message}\n`),
  operationMs = 15000, cleanupMs = 9000}) {
  if (!Number.isInteger(operationMs) || operationMs<1
    || !Number.isInteger(cleanupMs) || cleanupMs<1) throw new Error('Invalid contention deadlines.');
  // Arm the operation deadline before the first await, including readiness.
  const operationDeadline=Date.now()+operationMs;
  const operationTimeout=new Error('Contention operation exceeded its deadline.');
  const operation=async promise=>{
    const outcome=await waitUntil(promise,operationDeadline);
    if (outcome===TIMEOUT) throw operationTimeout;
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  };
  // Attach a rejection handler before readiness can delay completion.
  const holderDone=Promise.resolve(holder.done).then(()=>({ok:true}),error=>({error}));
  let pendingDone;
  let primary;
  let result;
  const cleanupErrors=[];
  let released=false;
  try {
    await operation(holder.ready);
    pendingDone=Promise.allSettled(startPending());
    await operation(observe());
    await operation(holder.release('commit'));
    released=true;
    const outcomes=await operation(pendingDone);
    const failed=outcomes.find(outcome=>outcome.status==='rejected');
    if (failed) throw failed.reason;
    result=await operation(validate(outcomes.map(outcome=>outcome.value)));
    const done=await operation(holderDone);
    if (done.error) throw done.error;
  } catch (error) { primary=error; }
  finally {
    // This is a separate total budget, not a new full timeout for each step.
    const cleanupDeadline=Date.now()+cleanupMs;
    const cleanup=async (promise, label, until=cleanupDeadline)=>{
      const outcome=await waitUntil(promise,until);
      if (outcome===TIMEOUT) {
        cleanupErrors.push(new Error(`${label} exceeded cleanup deadline.`));
        return TIMEOUT;
      }
      if ('error' in outcome) cleanupErrors.push(outcome.error);
      return outcome;
    };
    if (!released) {
      // Do not let a non-settling rollback prevent force termination.
      await cleanup(Promise.resolve().then(()=>holder.release('rollback')),
        'Holder rollback',Math.min(cleanupDeadline,Date.now()+Math.ceil(cleanupMs/3)));
    }
    let done=await waitUntil(holderDone,Math.min(cleanupDeadline,
      Date.now()+Math.ceil(cleanupMs/3)));
    if (done===TIMEOUT) {
      await cleanup(Promise.resolve().then(()=>holder.kill()),'Holder termination',
        Math.min(cleanupDeadline,Date.now()+Math.ceil(cleanupMs/3)));
      done=await waitUntil(holderDone,cleanupDeadline);
    }
    if (done===TIMEOUT) cleanupErrors.push(new Error('Holder did not terminate.'));
    else if (done.value.error && done.value.error!==primary) cleanupErrors.push(done.value.error);
    if (pendingDone) {
      const pending=await waitUntil(pendingDone,cleanupDeadline);
      if (pending===TIMEOUT) cleanupErrors.push(new Error('Pending database work did not settle.'));
      else for (const outcome of pending.value) if (outcome.status==='rejected'
        && outcome.reason!==primary) cleanupErrors.push(outcome.reason);
    }
  }
  for (const error of cleanupErrors) {
    try { Promise.resolve(onCleanupError(error)).catch(()=>{}); }
    catch { /* reporting must not replace the primary failure */ }
  }
  if (primary) throw primary;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors,'Contention cleanup failed.');
  return result;
}
