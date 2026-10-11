import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const childSource = `
  import express from 'express';
  import { createServerSessionRouter } from './server/auth/serverSessionRouter.js';
  const marker='SYNTHETIC_CREDENTIAL_NEVER_ECHO';
  const server=express();
  const listener=server.listen(0,'127.0.0.1');
  await new Promise(resolve=>listener.once('listening',resolve));
  const origin='http://127.0.0.1:'+listener.address().port;
  server.use('/auth',createServerSessionRouter({origin,csrfKey:Buffer.alloc(32,1),
    repository:{resolve:async()=>({state:'missing'})},identity:{login:async()=>{}}}));
  const cases=[
    ['application/json','{"password":"'+marker+'"'],
    ['application/json',JSON.stringify({password:marker.repeat(800)})],
    ['text/plain',marker],
  ];
  const results=[];
  for (const [type,body] of cases) {
    const response=await fetch(origin+'/auth/login',{method:'POST',
      headers:{Origin:origin,'Content-Type':type},body});
    results.push({status:response.status,body:await response.text()});
  }
  listener.close();
  process.stdout.write(JSON.stringify(results));
`;

function runChild(environment) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',childSource],{
      cwd:process.cwd(),env:{...process.env,NODE_ENV:environment},stdio:['ignore','pipe','pipe']});
    let output=''; let errors='';
    const deadline=setTimeout(()=>child.kill('SIGKILL'),5000);
    child.stdout.on('data',chunk=>{output+=chunk;});
    child.stderr.on('data',chunk=>{errors+=chunk;});
    child.once('error',reject);
    child.once('close',code=>{
      clearTimeout(deadline);
      if (code!==0) return reject(new Error('Parser child failed.'));
      resolve({output,errors});
    });
  });
}

for (const environment of ['development','production']) {
  test(`body parser returns bounded generic JSON without credential leakage in ${environment}`,async()=>{
    const {output,errors}=await runChild(environment);
    assert.doesNotMatch(output+errors,/SYNTHETIC_CREDENTIAL_NEVER_ECHO/);
    assert.equal(errors,'');
    const results=JSON.parse(output);
    assert.deepEqual(results.map(result=>result.status),[400,413,415]);
    for (const result of results) {
      assert.ok(result.body.length<150);
      assert.deepEqual(JSON.parse(result.body),
        {message:'Authentication request body is invalid.'});
    }
  });
}
