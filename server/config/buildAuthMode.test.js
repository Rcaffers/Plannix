import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { assertBuiltAuthMode, requireMatchingBuild } from './buildAuthMode.js';

test('all build/runtime mode combinations and missing or malformed metadata fail closed',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'plannix-auth-mode-'));
  try {
    for(const runtime of ['bearer','server']) {
      assert.throws(()=>assertBuiltAuthMode(dir,runtime),/unavailable/);
    }
    for(const build of ['bearer','server']) {
      await writeFile(path.join(dir,'auth-mode.json'),JSON.stringify({version:1,authMode:build}));
      for(const runtime of ['bearer','server']) {
        if(build===runtime)assert.equal(assertBuiltAuthMode(dir,runtime),runtime);
        else assert.throws(()=>assertBuiltAuthMode(dir,runtime),/do not match/);
      }
    }
    for(const invalid of ['{}','{"version":1,"authMode":"unknown"}',
      '{"version":1,"authMode":"bearer","extra":true}',
      'x'.repeat(129)]) {
      await writeFile(path.join(dir,'auth-mode.json'),invalid);
      assert.throws(()=>assertBuiltAuthMode(dir,'bearer'),/invalid|unavailable/);
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('a mismatched build cannot serve its HTML or browser assets',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'plannix-auth-mode-http-'));
  const app=express();
  app.use(requireMatchingBuild(dir,'server'));
  app.use(express.static(dir));
  const server=createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    await writeFile(path.join(dir,'index.html'),'<html>synthetic app</html>');
    await writeFile(path.join(dir,'bundle.js'),'synthetic browser auth');
    const origin=`http://127.0.0.1:${server.address().port}`;
    for(const filename of ['index.html','bundle.js']) {
      const missing=await fetch(`${origin}/${filename}`);
      assert.equal(missing.status,503);
    }
    await writeFile(path.join(dir,'auth-mode.json'),'{"version":1,"authMode":"bearer"}');
    assert.equal((await fetch(`${origin}/index.html`)).status,503);
    await writeFile(path.join(dir,'auth-mode.json'),'{"version":1,"authMode":"server"}');
    assert.equal((await fetch(`${origin}/index.html`)).status,200);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await rm(dir,{recursive:true,force:true});
  }
});
