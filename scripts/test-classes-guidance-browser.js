import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-classes-guidance-'));
let chrome; let socket;
try {
  await build({ configFile:false, logLevel:'error', define:{'process.env.NODE_ENV':'"production"'}, esbuild:{jsx:'automatic'},
    plugins:[{name:'classes-guidance-fixture',enforce:'pre',resolveId(source,importer) {
      if (importer?.endsWith('/ClassContext.jsx')
        && (source === './AcademicYearContext' || source === '../utils/api'))
        return path.resolve('src/pages/ClassesGuidance.browser-mocks.js');
      if ((importer?.endsWith('/SetupGuide.jsx') || importer?.endsWith('/Classes.jsx'))
        && ['../context/AcademicYearContext','../context/TimetableLayoutContext',
          '../context/TimetableSessionContext'].includes(source))
        return path.resolve('src/pages/ClassesGuidance.browser-mocks.js');
      return null;
    }}],
    build:{outDir:directory,emptyOutDir:false,lib:{entry:'src/pages/ClassesGuidance.browser-test.jsx',
      formats:['iife'],name:'ClassesGuidanceTest',fileName:()=>'test.js',cssFileName:'test'}} });
  await writeFile(path.join(directory,'index.html'),'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="test.css"></head><body><div id="root"></div><script>window.__testErrors=[];window.confirm=()=>true;addEventListener("error",e=>window.__testErrors.push(e.message));</script><script src="test.js"></script></body></html>');
  chrome=spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless','--allow-file-access-from-files','--disable-background-networking','--no-first-run',
      '--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${directory}/profile`,`file://${directory}/index.html`],
    {stdio:['ignore','ignore','pipe']});
  let startupError;chrome.once('error',error=>{startupError=error;});chrome.stderr.resume();
  let wsURL;const startupDeadline=Date.now()+15000;
  while(!wsURL){
    if(startupError)throw startupError;
    if(chrome.exitCode!==null || chrome.signalCode!==null)throw Error('Chrome exited before DevTools was ready.');
    try {const [port,browserPath]=String(await readFile(path.join(directory,'profile','DevToolsActivePort'),'utf8')).trim().split('\n');
      if(/^\d{1,5}$/.test(port) && /^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath))
        wsURL=`ws://127.0.0.1:${port}${browserPath}`;
    } catch { /* Isolated Chrome profile is starting. */ }
    if(!wsURL){if(Date.now()>startupDeadline)throw Error('Chrome startup timeout');
      await new Promise(resolve=>setTimeout(resolve,40));}
  }
  socket=new WebSocket(wsURL);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let serial=0;const pending=new Map();
  socket.onmessage=event=>{const message=JSON.parse(event.data);const item=pending.get(message.id);
    if(item){clearTimeout(item.timer);pending.delete(message.id);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);}};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++serial;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timed out`));},10000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetInfos}=await send('Target.getTargets');const target=targetInfos.find(item=>item.type==='page'&&item.url.startsWith('file:'));
  assert.ok(target);const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);return result.result.value;};
  const waitFor=async expression=>{const end=Date.now()+6000;while(!await evaluate(expression)){
    if(Date.now()>end)throw Error(`Rendered Classes timed out: ${expression}; body=${await evaluate('document.body.textContent.slice(0,250)')}; errors=${JSON.stringify(await evaluate('window.__testErrors'))}`);
    await new Promise(resolve=>setTimeout(resolve,30));}};
  await waitFor("document.querySelector('#class-name-0')?.value==='Existing class'");
  await waitFor("Boolean(document.querySelector('.setup-guide'))");
  assert.equal(await evaluate("document.querySelector('.classes-save')?.disabled"),false,
    'loaded unchanged classes can be saved to complete restored guidance');
  await evaluate("document.querySelector('.classes-save').click()");
  await waitFor("window.__classSaveCalls===1 && document.querySelector('.classes-save')?.disabled");
  assert.equal(await evaluate("Boolean(document.querySelector('.setup-guide'))"),true,'pending save keeps guidance');
  await evaluate("document.querySelector('.classes-save').click()");
  assert.equal(await evaluate('window.__classSaveCalls'),1,'saving blocks duplicate submissions');
  await evaluate('window.__finishClassRequest(false)');
  await waitFor("document.querySelector('.classes-hint--error')?.textContent.includes('Synthetic save failure')");
  assert.equal(await evaluate("Boolean(document.querySelector('.setup-guide'))"),true,'failed save keeps guidance');
  assert.equal(await evaluate("document.querySelector('#class-name-0')?.value"),'Existing class');
  await evaluate("document.querySelector('.classes-save').click()");
  await waitFor('window.__classSaveCalls===2');
  await evaluate('window.__finishClassRequest(true)');
  await waitFor("!document.querySelector('.setup-guide-wrap')");
  await evaluate("window.__navigate('/setup')");
  await waitFor("Boolean(document.querySelector('main a[href=\"/classes\"]'))");
  await evaluate("document.querySelector('main a[href=\"/classes\"]').click()");
  await waitFor("document.querySelector('#class-name-0')?.value==='Existing class' && !document.querySelector('.setup-guide-wrap')");
  await send('Page.reload',{},sessionId);
  await waitFor("document.querySelector('#class-name-0')?.value==='Existing class' && !document.querySelector('.setup-guide-wrap')");
  await evaluate('window.__restoreClassGuidance()');
  await waitFor("Boolean(document.querySelector('.setup-guide'))");
  assert.equal(await evaluate("document.querySelector('.classes-save')?.disabled"),false);
  await evaluate("document.querySelector('.classes-save').click()");
  await waitFor('window.__classSaveCalls===1');
  await evaluate('window.__finishClassRequest(true)');
  await waitFor("!document.querySelector('.setup-guide-wrap')");
  console.log('Rendered Classes unchanged save, duplicate blocking, failure, navigation, reload and restoration passed.');
} finally {
  try{socket?.close();}catch{ /* Browser is closing. */ }
  if(chrome && chrome.exitCode===null && chrome.signalCode===null){chrome.kill();
    await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2500))]);
    if(chrome.exitCode===null && chrome.signalCode===null)chrome.kill('SIGKILL');}
  await rm(directory,{recursive:true,force:true});
}
