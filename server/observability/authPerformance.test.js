import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { requestId } from '../middleware/requestId.js';
import { createAuthPerformance, measureAuth, measureAuthMethods,
  measureAuthSync } from './authPerformance.js';

async function harness(t, enabled, write) {
  const app = express();
  app.use(requestId);
  app.use(createAuthPerformance({ enabled, write }).middleware);
  app.get('/__stage3/auth/status', async (_req, res) => {
    await measureAuth('auth.limiter', async () => ({ accepted:true }));
    await measureAuth('auth.repository.resolve', async () => ({ state:'selected' }));
    measureAuthSync('auth.tokenDecrypt', () => 'synthetic-token');
    await measureAuth('attacker-controlled-label', async () => 'secret');
    res.json({ ok:true });
  });
  app.get('/api/academic-years', async (_req, res) => {
    const methods=measureAuthMethods({ async readTokens() { return {state:'current'}; } },
      'auth.repository');
    await methods.readTokens();
    res.json({ academicYears:[] });
  });
  const server=createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('disabled performance instrumentation emits no records', async t => {
  const lines=[];
  const origin=await harness(t,false,line=>lines.push(line));
  const result=await fetch(`${origin}/__stage3/auth/status`);
  assert.equal(result.status,200);
  assert.deepEqual(lines,[]);
});

test('enabled output is request-correlated and contains only fixed safe fields', async t => {
  const lines=[];
  const origin=await harness(t,true,line=>lines.push(line));
  const synthetic='password=do-not-log&email=teacher@example.test&cookie=do-not-log';
  const response=await fetch(`${origin}/__stage3/auth/status?${synthetic}`,{
    headers:{'X-Request-ID':synthetic,'Cookie':'synthetic-secret=do-not-log'} });
  assert.equal(response.status,200);
  const id=response.headers.get('x-request-id');
  assert.match(id,/^[0-9a-f-]{36}$/);
  await fetch(`${origin}/api/academic-years?${synthetic}`);
  const records=lines.map(line=>JSON.parse(line));
  assert.deepEqual(records.filter(record=>record.requestId===id).map(record=>record.operation).sort(),
    ['auth.limiter','auth.repository.resolve','auth.tokenDecrypt','request.status'].sort());
  assert.ok(records.some(record=>record.operation==='request.academicYears'));
  for(const record of records){
    assert.deepEqual(Object.keys(record).sort(),['durationMs','operation','outcome','requestId']);
    assert.equal(typeof record.durationMs,'number');
    assert.ok(record.durationMs>=0);
    assert.ok(['ok','error'].includes(record.outcome));
  }
  assert.doesNotMatch(lines.join('\n'),/do-not-log|teacher@example|password|cookie=|attacker-controlled/);
});

test('instrumented failures preserve thrown errors and emit a fixed outcome', async t => {
  const lines=[];
  const origin=await harness(t,true,line=>lines.push(line));
  assert.equal((await fetch(`${origin}/__stage3/auth/status`)).status,200);
  const app=express();
  app.use(requestId,createAuthPerformance({enabled:true,write:line=>lines.push(line)}).middleware);
  app.get('/__stage3/auth/me',async (_req,res)=>{
    await assert.rejects(measureAuth('auth.identity.validateAccess',async()=>{
      throw Error('synthetic credential text');
    }),/synthetic credential text/);
    res.status(503).end();
  });
  const server=createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/__stage3/auth/me`);
  assert.equal(response.status,503);
  const records=lines.map(line=>JSON.parse(line));
  assert.ok(records.some(item=>item.operation==='auth.identity.validateAccess'&&item.outcome==='error'));
  assert.ok(records.some(item=>item.operation==='request.me'&&item.outcome==='error'));
  assert.doesNotMatch(lines.join('\n'),/synthetic credential text/);
});

test('an unavailable timing sink cannot change authentication responses', async t => {
  const origin=await harness(t,true,()=>{ throw Error('synthetic sink failure'); });
  const response=await fetch(`${origin}/__stage3/auth/status`);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true});
});

const CLOCK_FAILURE = Symbol('clock failure');
function clockSteps(steps) {
  let index=0;
  return () => {
    const value=steps[index++];
    if (value===CLOCK_FAILURE) throw Error('synthetic clock failure');
    return value;
  };
}

async function clockCase(steps, work, { sync = false } = {}) {
  const lines=[];
  const middleware=createAuthPerformance({enabled:true,clock:clockSteps(steps),
    write:line=>lines.push(JSON.parse(line))}).middleware;
  const response=new EventEmitter();response.statusCode=200;
  const result=await new Promise(resolve=>middleware({
    id:'11111111-1111-4111-8111-111111111111',method:'GET',path:'/__stage3/auth/status',
  },response,()=>{
    let pending;
    try { pending=sync ? measureAuthSync('auth.tokenDecrypt',work)
      : measureAuth('auth.repository.resolve',work); }
    catch(error) { response.statusCode=503;response.emit('finish');resolve({error});return; }
    Promise.resolve(pending).then(value=>{response.emit('finish');resolve({value});},
      error=>{response.statusCode=503;response.emit('finish');resolve({error});});
  }));
  return {result,lines};
}

test('clock failure at request entry or nested start/end never changes a successful operation', async () => {
  const value=Object.freeze({state:'selected'});
  for(const [phase,steps,absent] of [
    ['request entry',[CLOCK_FAILURE,10,20,30],'request.status'],
    ['nested start',[0,CLOCK_FAILURE,30],'auth.repository.resolve'],
    ['nested end',[0,10,CLOCK_FAILURE,30],'auth.repository.resolve'],
    ['request end',[0,10,20,CLOCK_FAILURE],'request.status'],
    ['non-finite nested end',[0,10,Number.NaN,30],'auth.repository.resolve'],
  ]) {
    let calls=0;
    const {result,lines}=await clockCase(steps,()=>{calls++;return value;});
    assert.equal(calls,1,phase);
    assert.equal(result.value,value,phase);
    assert.ok(!lines.some(item=>item.operation===absent),phase);
    assert.ok(lines.every(item=>Number.isFinite(item.durationMs)),phase);
  }
});

test('clock failure preserves the exact underlying sync and async errors without retry', async () => {
  for(const [phase,steps,asyncFailure] of [
    ['request entry',[CLOCK_FAILURE,10,20,30],false],
    ['nested start',[0,CLOCK_FAILURE,30],false],
    ['nested end',[0,10,CLOCK_FAILURE,30],true],
    ['request end',[0,10,20,CLOCK_FAILURE],true],
  ]) {
    const original=Error(`original ${phase}`);
    let calls=0;
    const {result,lines}=await clockCase(steps,()=>{
      calls++;
      if(asyncFailure)return Promise.reject(original);
      throw original;
    });
    assert.equal(calls,1,phase);
    assert.equal(result.error,original,phase);
    assert.doesNotMatch(JSON.stringify(lines),/original /);
  }
});

test('token-decryption timing failures preserve synchronous results and errors', async () => {
  for(const steps of [[0,CLOCK_FAILURE,30],[0,10,CLOCK_FAILURE,30]]) {
    const value='synthetic token';let calls=0;
    const success=await clockCase(steps,()=>{calls++;return value;},{sync:true});
    assert.equal(calls,1);
    assert.equal(success.result.value,value);
    assert.ok(!success.lines.some(item=>item.operation==='auth.tokenDecrypt'));
    const original=Error('synthetic decrypt failure');calls=0;
    const failure=await clockCase(steps,()=>{calls++;throw original;},{sync:true});
    assert.equal(calls,1);
    assert.equal(failure.result.error,original);
    assert.ok(!failure.lines.some(item=>item.operation==='auth.tokenDecrypt'));
  }
});

test('overlapping requests keep distinct IDs and timing contexts', async () => {
  const lines=[];
  const middleware=createAuthPerformance({enabled:true,write:line=>lines.push(JSON.parse(line))}).middleware;
  const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
  let releaseFirst,releaseSecond;
  const first=new Promise(resolve=>{releaseFirst=resolve;});
  const second=new Promise(resolve=>{releaseSecond=resolve;});
  const run=(id,gate)=>{
    const response=new EventEmitter();response.statusCode=200;
    return new Promise(resolve=>middleware({id,method:'GET',path:'/__stage3/auth/status'},
      response,()=>{
        measureAuth('auth.repository.resolve',()=>gate).then(()=>{
          response.emit('finish');resolve();
        });
      }));
  };
  const a=run(ids[0],first),b=run(ids[1],second);
  releaseSecond();await b;releaseFirst();await a;
  for(const id of ids)assert.deepEqual(lines.filter(item=>item.requestId===id)
    .map(item=>item.operation).sort(),['auth.repository.resolve','request.status']);
});
