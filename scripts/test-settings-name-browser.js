import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-settings-name-'));
let chrome; let socket;
try {
  await build({ configFile:false, envDir:directory, logLevel:'error', define:{'process.env.NODE_ENV':'"production"'}, esbuild:{jsx:'automatic'},
    plugins:[{name:'settings-name-fixture',enforce:'pre',resolveId(source,importer) {
      if ((importer?.endsWith('/TimetableLayoutContext.jsx') || importer?.endsWith('/Settings.jsx'))
        && (source === '../context/AcademicYearContext' || source === './AcademicYearContext'
          || source === '../utils/api')) return path.resolve('src/pages/SettingsName.browser-mocks.js');
      return null;
    }}],
    build:{outDir:directory,emptyOutDir:false,lib:{entry:'src/pages/SettingsName.browser-test.jsx',
      formats:['iife'],name:'SettingsNameTest',fileName:()=>'test.js',cssFileName:'test'}} });
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
    if(Date.now()>end)throw Error(`Rendered Settings timed out: ${expression}; body=${await evaluate('document.body.textContent.slice(0,250)')}; errors=${JSON.stringify(await evaluate('window.__testErrors'))}`);
    await new Promise(resolve=>setTimeout(resolve,30));}};
  const setName=async name=>evaluate(`(() => {const input=document.querySelector('#timetable-name');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor("document.querySelector('#timetable-name')?.value==='My timetable'");
  await setName('');
  await waitFor("document.querySelector('#timetable-name')?.value===''");
  await setName('Replacement timetable');
  await waitFor("document.querySelector('#timetable-name')?.value==='Replacement timetable'");
  await setName('   ');
  await waitFor("document.querySelector('#timetable-name')?.value==='   '");
  await evaluate(`(() => {const input=document.querySelector('#timetable-periods');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(input,'6');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor("document.querySelector('#timetable-periods')?.value==='6'");
  await evaluate("document.querySelector('.settings-save').click()");
  await waitFor("document.querySelector('#timetable-name-error')?.textContent==='Enter a timetable name before saving.'");
  assert.equal(await evaluate('window.__layoutSaveCalls'),0,'blank name never reaches the save API');
  assert.equal(await evaluate("document.querySelector('#timetable-name')?.value"),'   ','invalid input remains editable');
  assert.equal(await evaluate("document.querySelector('#timetable-periods')?.value"),'6','blank-name validation retains other draft edits');
  assert.equal(await evaluate("document.querySelector('#timetable-name')?.getAttribute('aria-invalid')"),'true');
  await setName('  My replacement  ');
  await waitFor("document.querySelector('#timetable-name-error')===null");
  await evaluate("document.querySelector('.settings-save').click()");
  await waitFor("window.__layoutSaveCalls===1 && document.querySelector('#timetable-name')?.value==='My replacement'");
  assert.equal(await evaluate('window.__storedLayout.periodsPerDay'),6,'successful save includes the retained period edit');
  await setName('Unsaved draft');
  await waitFor("document.querySelector('#timetable-name')?.value==='Unsaved draft'");
  const readsBeforeReload=await evaluate('window.__layoutFetchCalls');
  await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Reload saved layout').click()");
  await waitFor(`window.__layoutFetchCalls>${readsBeforeReload} && document.querySelector('#timetable-name')?.value==='My replacement'`);
  assert.equal(await evaluate("window.__storedLayout.name"),'My replacement');
  assert.equal(await evaluate("document.querySelector('#timetable-periods')?.value"),'6','reload preserves the saved period edit');
  assert.equal(await evaluate("document.querySelector('.settings-timetable-form button[type=submit]').disabled"),true,
    'unchanged saved layout does not offer an ordinary redundant save');
  await evaluate('window.__restoreLayoutGuidance()');
  await waitFor("!document.querySelector('.settings-timetable-form button[type=submit]').disabled");
  assert.equal(await evaluate('window.__layoutGuidancePreference()'),'shown');
  await evaluate('window.__layoutSaveFailure=true;document.querySelector(".settings-timetable-form button[type=submit]").click()');
  await waitFor("!!document.querySelector('.settings-error')");
  assert.equal(await evaluate('window.__layoutGuidancePreference()'),'shown',
    'failed unchanged save retains restored guidance');
  assert.equal(await evaluate("document.querySelector('.settings-timetable-form button[type=submit]').disabled"),false,
    'failed unchanged save remains available for retry');
  await evaluate('window.__layoutSaveFailure=false;window.__holdLayoutSave=true;document.querySelector(".settings-timetable-form button[type=submit]").click()');
  await waitFor("typeof window.__resolveLayoutSave==='function'");
  assert.equal(await evaluate('window.__layoutGuidancePreference()'),'shown',
    'pending unchanged save retains restored guidance');
  assert.equal(await evaluate("document.querySelector('.settings-timetable-form button[type=submit]').disabled"),true,
    'pending save prevents duplicate submissions');
  await evaluate('window.__holdLayoutSave=false;window.__resolveLayoutSave()');
  await waitFor("window.__layoutGuidancePreference()==='completed'");
  assert.equal(await evaluate("document.querySelector('.settings-timetable-form button[type=submit]').disabled"),true,
    'successful unchanged save completes guidance and restores ordinary disabled state');
  await evaluate('window.__restoreLayoutGuidance();window.__holdYearTwoFetch=true;window.__selectMockAcademicYear("year-2")');
  await waitFor("typeof window.__resolveYearTwoFetch==='function'");
  assert.equal(await evaluate("document.querySelector('.settings-timetable-form button[type=submit]').disabled"),true,
    'a new academic year cannot save the previous year layout while its load is pending');
  const savesBeforeNewYear=await evaluate('window.__layoutSaveCalls');
  await evaluate('document.querySelector(".settings-timetable-form").requestSubmit()');
  assert.equal(await evaluate('window.__layoutSaveCalls'),savesBeforeNewYear,
    'programmatic submit also cannot save the previous year layout');
  await evaluate('window.__holdYearTwoFetch=false;window.__resolveYearTwoFetch()');
  await waitFor("!document.querySelector('.settings-timetable-form button[type=submit]').disabled");
  assert.equal(await evaluate("document.querySelector('#timetable-name')?.value"),'My timetable',
    'new year receives its own default layout after the held load');
  console.log('Rendered Settings name clearing, retyping, blank save validation, successful save and reload passed.');
} finally {
  try{socket?.close();}catch{ /* Browser is closing. */ }
  if(chrome && chrome.exitCode===null && chrome.signalCode===null){chrome.kill();
    await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2500))]);
    if(chrome.exitCode===null && chrome.signalCode===null)chrome.kill('SIGKILL');}
  await rm(directory,{recursive:true,force:true});
}
