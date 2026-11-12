import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-setup-browser-'));
let chrome; let socket; let originalFailure;
try {
  await build({ configFile:false, logLevel:'error', define:{'process.env.NODE_ENV':'"production"'}, esbuild:{jsx:'automatic'},
    plugins:[{name:'setup-saved-data-fixture',enforce:'pre',resolveId(source, importer) {
      if (importer?.endsWith('/SetupGuide.jsx') && source.startsWith('../context/'))
        return path.resolve('src/pages/SetupChecklist.browser-mocks.js');
      if (importer?.endsWith('/SetupChecklist.jsx') && (source === '../utils/aiConnectionApi'
        || source === '../utils/morningSummaryApi'))
        return path.resolve('src/pages/SetupChecklist.browser-mocks.js');
      if (importer?.endsWith('/SetupGuide.jsx') && (source === '../utils/aiConnectionApi'
        || source === '../utils/morningSummaryApi'))
        return path.resolve('src/pages/SetupChecklist.browser-mocks.js');
      return null;
    }}],
    build:{outDir:directory,emptyOutDir:false,lib:{entry:'src/pages/SetupChecklist.browser-test.jsx',formats:['iife'],name:'SetupTest',fileName:()=>'test.js',cssFileName:'test'}} });
  await writeFile(path.join(directory,'index.html'),'<html><head><link rel="stylesheet" href="test.css"></head><body><div id="root"></div><script>window.__testErrors=[];addEventListener("error",e=>window.__testErrors.push(e.message));</script><script src="test.js"></script></body></html>');
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
    } catch { /* The isolated profile is still starting. */ }
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
    if(Date.now()>end)throw Error(`Rendered setup state timed out: ${expression}; view=${await evaluate("document.body.textContent.slice(0,250)")}; errors=${JSON.stringify(await evaluate('window.__testErrors'))}`);
    await new Promise(resolve=>setTimeout(resolve,30));}};
  await waitFor("document.querySelector('.setup-progress')?.textContent.includes('2 of 4')");
  assert.equal(await evaluate("(() => {const link=document.querySelector('.setup-checklist-item a');link.focus();return document.activeElement===link;})()"),true,
    'a setup step can receive keyboard focus without a modal overlay');
  assert.equal(await evaluate("document.querySelector('.setup-checklist-item:nth-child(3) .setup-step-status')?.textContent"),'To do');
  await evaluate('window.__setupOptionalActive=true');
  await evaluate("[...document.querySelectorAll('.setup-checklist-item')][4].querySelector('a').click()");
  await waitFor("Boolean(document.querySelector('.setup-guide-reopen'))");
  await evaluate("[...document.querySelectorAll('main a')].find(a=>a.textContent==='Checklist').click()");
  await waitFor("Boolean(document.querySelector('.setup-checklist'))");
  await evaluate("[...document.querySelectorAll('.setup-checklist-item')][5].querySelector('a').click()");
  await waitFor("Boolean(document.querySelector('.setup-guide-reopen'))");
  await evaluate("[...document.querySelectorAll('main a')].find(a=>a.textContent==='Checklist').click()");
  await waitFor("Boolean(document.querySelector('.setup-checklist'))");
  await evaluate('window.__setupOptionalActive=false');
  await evaluate("document.querySelector('.setup-checklist-item:nth-child(3) a').click()");
  await waitFor("document.querySelector('.setup-guide-title')?.textContent==='Add your classes'");
  await evaluate("(() => {const field=document.querySelector('#fixture-class');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(field,'9A Maths');field.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await waitFor("document.querySelector('#fixture-class')?.value==='9A Maths'");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Fail save').click()");
  assert.equal(await evaluate("document.querySelector('#fixture-class').value"),'9A Maths');
  assert.equal(await evaluate("document.querySelector('.setup-guide-done')===null"),true);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Hide guidance').click()");
  await waitFor("Boolean(document.querySelector('.setup-guide-reopen'))");
  await evaluate("document.querySelector('.setup-guide-reopen').click()");
  await waitFor("Boolean(document.querySelector('.setup-guide'))");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Save classes').click()");
  assert.equal(await evaluate("Boolean(document.querySelector('.setup-guide'))"),true,
    'pending save keeps guidance visible');
  await evaluate('window.__finishClassSave(true)');
  await waitFor("Boolean(document.querySelector('.setup-guide-reopen'))");
  await evaluate("[...document.querySelectorAll('main a')].find(a=>a.textContent==='Checklist').click()");
  await waitFor("document.querySelector('.setup-progress')?.textContent.includes('3 of 4')");
  await evaluate("[...document.querySelectorAll('.setup-checklist-item')][0].querySelector('a').click()");
  await waitFor("Boolean(document.querySelector('.setup-guide-reopen'))");
  await evaluate("document.querySelector('.setup-guide-reopen').click()");
  await waitFor("Boolean(document.querySelector('.setup-guide'))");
  await evaluate("[...document.querySelectorAll('.setup-guide a')].at(-1).click()");
  await waitFor("Boolean(document.querySelector('.setup-progress'))");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Show setup guidance again').click()");
  await waitFor("document.body.textContent.includes('Guidance is ready on each setup page')");
  await evaluate("[...document.querySelectorAll('.setup-checklist-item')][0].querySelector('a').click()");
  await waitFor("Boolean(document.querySelector('.setup-guide'))");
  await evaluate("[...document.querySelectorAll('.setup-guide a')].at(-1).click()");
  await waitFor("Boolean(document.querySelector('.setup-progress'))");
  await evaluate('window.__setupOptionalActive=true');
  await evaluate("[...document.querySelectorAll('.setup-checklist-item')][4].querySelector('a').click()");
  await waitFor("Boolean(document.querySelector('.setup-guide'))");
  await evaluate("[...document.querySelectorAll('.setup-guide a')].at(-1).click()");
  await waitFor("Boolean(document.querySelector('.setup-checklist'))");
  await evaluate("[...document.querySelectorAll('.setup-checklist-item')][5].querySelector('a').click()");
  await waitFor("Boolean(document.querySelector('.setup-guide'))");
  await evaluate("[...document.querySelectorAll('.setup-guide a')].at(-1).click()");
  await waitFor("Boolean(document.querySelector('.setup-checklist'))");
  await evaluate('window.__setupOptionalActive=false');
  await evaluate("[...document.querySelectorAll('.setup-checklist-item')][2].querySelector('a').click()");
  await waitFor("Boolean(document.querySelector('.setup-guide'))");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Save classes').click()");
  await evaluate('window.__finishClassSave(false)');
  await waitFor("document.querySelector('[role=alert]')?.textContent.includes('Save failed')");
  assert.equal(await evaluate("Boolean(document.querySelector('.setup-guide'))"),true,
    'failed save keeps restored guidance visible');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Save classes').click()");
  await evaluate("window.__setSetupFixture(value=>({...value,classes:{...value.classes,authoritativeEntries:[]}}))");
  await evaluate("window.__switchSetupAccount('other-account')");
  await waitFor("window.__setupAccount==='other-account'");
  await evaluate('window.__finishClassSave(true)');
  assert.equal(await evaluate("Boolean(document.querySelector('.setup-guide'))"),true,
    'late result for the old account cannot hide the new account guide');
  await evaluate("window.__switchSetupAccount('fixture-account')");
  await waitFor("window.__setupAccount==='fixture-account'");
  assert.equal(await evaluate("Boolean(document.querySelector('.setup-guide'))"),true,
    'stale result did not consume the restored guidance for the originating account');
  await evaluate("window.__setSetupFixture(value=>({...value,classes:{...value.classes,authoritativeEntries:[{id:'class-a',name:'9A Maths'}]}}))");
  await evaluate('window.__setupOptionalFail=true');
  await evaluate("[...document.querySelectorAll('.setup-guide a')].at(-1).click()");
  await waitFor("document.querySelector('.setup-progress')?.textContent.includes('3 of 4')");
  await waitFor("[...document.querySelectorAll('.setup-checklist-item')].slice(-2).every(item=>item.querySelector('.setup-step-status')?.textContent.includes('Could not confirm'))");
  await evaluate("window.__setSetupFixture(value=>({...value,timetable:{...value.timetable,recurring:[{sessions:[{classId:'class-a'}]}]}}))");
  await waitFor("document.querySelector('.setup-progress')?.textContent.includes('4 of 4')");
  await evaluate("window.__setSetupFixture(value=>({...value,timetable:{...value.timetable,recurringScopeKey:'new-session:year'}}))");
  await waitFor("document.querySelector('.setup-progress')?.textContent.includes('3 of 4')");
  await evaluate("window.__setSetupFixture(value=>({...value,timetable:{...value.timetable,loadedRecurringScopeKey:'new-session:year'}}))");
  await waitFor("document.querySelector('.setup-progress')?.textContent.includes('4 of 4')");
  await evaluate("window.__setSetupFixture(value=>({...value,year:{...value.year,selectedAcademicYearId:'year-b',academicYears:[...value.year.academicYears,{id:'year-b'}]}}))");
  await waitFor("document.querySelector('.setup-progress')?.textContent.includes('1 of 4')");
  for(const width of [320,375,390,768]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:true},sessionId);
    const x=await evaluate("({viewport:innerWidth,document:document.documentElement.scrollWidth})");
    assert.ok(x.document<=x.viewport+1,`setup overflows at ${width}px`);
  }
  await send('Page.reload',{},sessionId);
  await waitFor("Boolean(document.querySelector('.setup-checklist'))");
  await evaluate("[...document.querySelectorAll('.setup-checklist-item')][0].querySelector('a').click()");
  await waitFor("document.querySelector('.setup-guide-title')?.textContent==='Add your academic year'");
  assert.equal(await evaluate("Boolean(document.querySelector('.setup-guide'))"),true,
    'restored guidance persists across reload for an already saved section');
  console.log('Rendered setup restore, pending/failed/successful saves, account replacement, reload, progress and mobile widths passed.');
} catch(error){originalFailure=error;throw error;}
finally {const cleanup=[];try{socket?.close();}catch(error){cleanup.push(error);}
  if(chrome && chrome.exitCode===null && chrome.signalCode===null){try{
    chrome.kill();let exited=false;const exit= new Promise(resolve=>chrome.once('exit',()=>{exited=true;resolve();}));
    await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,2500))]);
    if(!exited){chrome.kill('SIGKILL');await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(Error('Chrome exit timeout')),2500))]);}
  }catch(error){cleanup.push(error);}}
  try{await rm(directory,{recursive:true,force:true});}catch(error){cleanup.push(error);}
  if(cleanup.length){if(originalFailure)console.error('Secondary cleanup errors:',cleanup.map(error=>error.message));
    else throw cleanup[0];}}
