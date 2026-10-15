import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory=await mkdtemp(path.join(tmpdir(),'plannix-account-deletion-browser-'));
let chrome;let socket;
try {
  await build({configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},
    esbuild:{jsx:'automatic'},plugins:[{name:'deletion-mocks',enforce:'pre',resolveId(source,importer) {
      if(importer?.endsWith('/DeleteAccountSection.jsx')
        && ['../context/TimetableLayoutContext','../context/AcademicYearContext'].includes(source))
        return path.resolve('src/components/DeleteAccountSection.browser-mocks.js');
      if(importer?.endsWith('/accountDeletion.js') && source==='./api.js')
        return path.resolve('src/components/DeleteAccountSection.browser-mocks.js');
    }}],build:{outDir:directory,emptyOutDir:false,lib:{
      entry:'src/components/DeleteAccountSection.browser-test.jsx',formats:['iife'],
      name:'AccountDeletionTest',fileName:()=> 'test.js',cssFileName:'test',
    }}});
  await writeFile(path.join(directory,'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="test.css"></head>'
    +'<body><div id="root"></div><script src="test.js"></script></body></html>');
  chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless','--allow-file-access-from-files','--disable-background-networking',
      '--disable-component-update','--no-first-run','--disable-gpu',
      '--remote-debugging-port=0',`--user-data-dir=${path.join(directory,'profile')}`,
      `file://${path.join(directory,'index.html')}`],{stdio:['ignore','ignore','pipe']});
  const wsUrl=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Chrome startup timed out')),20000);
    chrome.once('error',reject);
    chrome.stderr.on('data',chunk=>{const found=String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if(found){clearTimeout(timer);resolve(found[1]);}});
  });
  socket=new WebSocket(wsUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let serial=0;const pending=new Map();
  socket.onmessage=event=>{const message=JSON.parse(event.data);const call=pending.get(message.id);
    if(!call)return;clearTimeout(call.timer);pending.delete(message.id);
    message.error?call.reject(Error(message.error.message)):call.resolve(message.result);};
  const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timed out`));},15000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,
      ...(sessionId?{sessionId}:{})}));});
  const {targetInfos}=await cdp('Target.getTargets');
  const target=targetInfos.find(item=>item.type==='page'&&item.url.startsWith('file:'));
  assert.ok(target);
  const {sessionId}=await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const result=await cdp('Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{
    let count=0;const timer=setInterval(()=>{if(document.body.dataset.testResult){
      clearInterval(timer);resolve([document.body.dataset.testResult,document.body.dataset.testError||'']);
    }else if(++count>300){clearInterval(timer);reject(Error('Deletion fixture timed out'));}},50)})`,
    awaitPromise:true,returnByValue:true},sessionId);
  if(result.exceptionDetails)throw Error(result.exceptionDetails.text);
  assert.equal(result.result.value[0],'passed',result.result.value[1]);
  process.stdout.write('Rendered account-deletion unmount, Retry, rerender and account-scope checks passed.\n');
} finally {
  socket?.close();
  if(chrome&&chrome.exitCode===null){chrome.kill();await new Promise(resolve=>{
    chrome.once('exit',resolve);setTimeout(resolve,3000);});}
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
