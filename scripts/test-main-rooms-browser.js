import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-main-rooms-'));
let chrome; let socket;
try {
  const authMode=process.env.PLANNIX_BROWSER_AUTH_MODE || 'bearer';
  assert.ok(['bearer','server'].includes(authMode));
  await build({ configFile:false, logLevel:'error', define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_PLANNIX_AUTH_MODE':JSON.stringify(authMode)}, esbuild:{jsx:'automatic'},
    plugins:[{name:'input-rooms-fixture',enforce:'pre',resolveId(source,importer){
      if(importer?.endsWith('/TimetableSessionContext.jsx') && ['./AcademicYearContext','./ClassContext','./TimetableLayoutContext','../utils/timetableSessionApi'].includes(source)) return path.resolve('src/components/MainRooms.browser-test.jsx');
      if(importer?.endsWith('/ProjectCard.jsx') && ['../context/AcademicYearContext','../context/ClassContext','../context/TimetableLayoutContext'].includes(source)) return path.resolve('src/components/MainRooms.browser-test.jsx');
      if(importer?.endsWith('/useRooms.js') && source==='../utils/roomApi')return path.resolve('src/components/MainRooms.browser-test.jsx');
      return null;
    }}],
    build:{outDir:directory,emptyOutDir:false,lib:{entry:'src/components/MainRooms.browser-test.jsx',
      formats:['iife'],name:'ClassesGuidanceTest',fileName:()=>'test.js',cssFileName:'test'}} });
  await writeFile(path.join(directory,'index.html'),'<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="test.css"></head><body><div id="root"></div><script>window.__testErrors=[];window.confirm=()=>true;addEventListener("error",e=>window.__testErrors.push(e.message));</script><script src="test.js"></script></body></html>');
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
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false},sessionId);
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);return result.result.value;};
  const waitFor=async expression=>{const end=Date.now()+6000;while(!await evaluate(expression)){
    if(Date.now()>end)throw Error(`Rendered Classes timed out: ${expression}; body=${await evaluate('document.body.textContent.slice(0,250)')}; errors=${JSON.stringify(await evaluate('window.__testErrors'))}`);
    await new Promise(resolve=>setTimeout(resolve,30));}};
  const renderedBarrier=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const change=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  await waitFor("document.querySelector('.session-room')?.textContent.includes('Old room') && !document.querySelector('.timetable-room-status')");
  const rooms=()=>evaluate("[...document.querySelectorAll('.session-room')].map(e=>e.getAttribute('aria-label'))");
  assert.deepEqual(await rooms(),['Room: Old room (Archived)','Room: '+await evaluate('__longName')]);
  assert.equal(await evaluate("[...document.querySelectorAll('.lesson-card')].find(e=>e.textContent.includes('Existing blank lesson')).querySelector('.session-room')===null"),true);
  assert.equal(await evaluate("document.querySelector('#lesson-room-input')===null"),true);
  const open=async()=>{await evaluate("[...document.querySelectorAll('.lesson-card')].find(e=>e.textContent.includes('Existing assigned lesson')).click()");await waitFor("document.querySelector('.lesson-modal')!==null");};
  await open();assert.equal(await evaluate("document.querySelector('#lesson-room-input')===null"),true,'main lesson editor has no room controls');
  await change('#lesson-title-input','Unrelated lesson edit');await evaluate("document.querySelector('.lesson-modal-save').click()");await waitFor("window.__sessionContext.saved && !window.__sessionContext.isSaving && !document.querySelector('.timetable-room-status')");
  assert.equal(await evaluate('__store[0].roomId'),await evaluate('__ids.archived'));
  assert.equal(await evaluate('__store[0].title'),'Existing assigned lesson','dated editing does not rewrite repeating lessons');
  assert.equal(await evaluate('__overrides[__initialDate][0].roomId'),await evaluate('__ids.archived'));
  await evaluate('window.__renameArchived()');await evaluate('void window.__sessionContext.reload()');await waitFor("document.querySelector('.session-room')?.textContent==='Renamed old room (Archived)'");
  // Dated overrides deliberately differ from the repeating assignment.
  await evaluate('window.__seedNextOverride();window.__holdRestore=true;void window.__sessionContext.removeOverride()');await waitFor('__heldRestores.length===1');await evaluate("document.querySelector('[aria-label=\"Go to next week\"]').click()");
  await waitFor("document.body.textContent.includes('Dated override lesson') && !document.querySelector('.timetable-room-status')");
  assert.deepEqual(await rooms(),['Room: '+await evaluate('__longName')]);
  await evaluate('window.__holdRestore=false;window.__heldRestores.splice(0).forEach(f=>f())');await renderedBarrier();assert.equal(await evaluate("document.body.textContent.includes('Dated override lesson') && !document.querySelector('.timetable-room-status')"),true,'late restore cannot replace the displayed week');
  // Hold the next week's response: old room labels disappear synchronously.
  await evaluate('window.__holdDate=true');await evaluate("document.querySelector('[aria-label=\"Go to next week\"]').click()");await waitFor('__heldDates.length>0');
  assert.equal(await evaluate("[...document.querySelectorAll('.session-room')].some(e=>e.getAttribute('aria-label')?.startsWith('Room:'))"),false);
  await evaluate('window.__holdDate=false');await evaluate("document.querySelector('[aria-label=\"Go to next week\"]').click()");await waitFor("!document.querySelector('.timetable-room-status') && document.body.textContent.includes('Existing assigned lesson')");
  await evaluate('__heldDates.splice(0).forEach(f=>f())');await renderedBarrier();assert.equal(await evaluate("document.body.textContent.includes('Dated override lesson')"),false);
  await evaluate('window.__holdCatalogue=true');await evaluate("document.querySelector('[aria-label=\"Go to next week\"]').click()");await waitFor('__heldCatalogues.length>0');
  assert.equal(await evaluate("[...document.querySelectorAll('.session-room')].some(e=>e.getAttribute('aria-label')?.startsWith('Room:'))"),false);
  await evaluate('window.__holdCatalogue=false');await evaluate("document.querySelector('[aria-label=\"Go to next week\"]').click()");await waitFor("!document.querySelector('.timetable-room-status')");await evaluate('__heldCatalogues.splice(0).forEach(f=>f())');await renderedBarrier();assert.equal(await evaluate("document.body.textContent.includes('Stale catalogue name')"),false);
  // Assignment failure is explicit and never permits an edit of stale sessions.
  await evaluate('window.__failDate=true');await evaluate('void window.__sessionContext.reload()');await waitFor("document.body.textContent.includes('Room information is unavailable')");
  assert.equal(await evaluate("[...document.querySelectorAll('.session-room')].some(e=>e.getAttribute('aria-label')?.startsWith('Room:'))"),false);
  const writes=await evaluate('__writes');await evaluate("document.querySelector('.lesson-card')?.click()");assert.equal(await evaluate("document.querySelector('.lesson-modal')"),null);assert.equal(await evaluate('__writes'),writes);
  await evaluate('window.__failDate=false');await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry room information').click()");await waitFor("!document.querySelector('.timetable-room-status')");
  // A catalogue outage does not imply No room or discard the saved IDs.
  await evaluate('window.__failCatalogue=true');await evaluate('void window.__sessionContext.reload()');await waitFor("document.body.textContent.includes('Room information is unavailable')");assert.equal(await evaluate("document.querySelector('.session-room').textContent"),'Room unavailable');
  assert.equal(await evaluate("[...document.querySelectorAll('.lesson-card')].find(e=>e.textContent.includes('Existing blank lesson')).querySelector('.session-room')===null"),true,'a confirmed null remains blank during a catalogue outage');
  await open();await change('#lesson-notes-input','Notes saved while the room name is unavailable');await evaluate("document.querySelector('.lesson-modal-save').click()");await waitFor("window.__sessionContext.saved && !window.__sessionContext.isSaving");assert.equal(await evaluate('window.__sessionContext.dated.sessions[0].roomId'),await evaluate('__ids.archived'));assert.equal(await evaluate('window.__sessionContext.dated.sessions[1].roomId'),null);
  await evaluate('window.__failCatalogue=false');await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry room information').click()");await waitFor("!document.querySelector('.timetable-room-status')");
  await open();await change('#lesson-title-input','Failed draft stays pending');await evaluate('window.__rejectWrite=true');await evaluate("document.querySelector('.lesson-modal-save').click()");await waitFor("window.__sessionContext.unsaved && !window.__sessionContext.isSaving");
  const rejectedWrites=await evaluate('__writes'),rejectedReads=await evaluate('__dateReads');await evaluate('window.confirm=()=>false');await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry room information').click()");assert.equal(await evaluate('__dateReads'),rejectedReads);assert.equal(await evaluate('window.__sessionContext.unsaved'),true);
  await evaluate('window.confirm=()=>true;window.__rejectWrite=false');await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry room information').click()");await waitFor("!document.querySelector('.timetable-room-status') && !window.__sessionContext.unsaved");assert.equal(await evaluate('__writes'),rejectedWrites,'reload never replays a failed save');
  await evaluate('window.__missingCatalogueRoom=true');await evaluate('void window.__sessionContext.reload()');await waitFor("document.body.textContent.includes('Room information is unavailable')");assert.equal(await evaluate("document.querySelector('.session-room').textContent"),'Room unavailable','a missing room name cannot become a class default');
  await evaluate('window.__missingCatalogueRoom=false');await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry room information').click()");await waitFor("!document.querySelector('.timetable-room-status')");
  for(const width of [1280,390]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},sessionId);await renderedBarrier();
    assert.equal(await evaluate("[...document.querySelectorAll('.lesson-card')].every(e=>e.scrollWidth<=e.clientWidth+1)"),true,'long names do not overflow cards');
    assert.equal(await evaluate("[...document.querySelectorAll('.session-room')].every(e=>{const room=e.getBoundingClientRect(),name=e.parentElement.querySelector('.session-class').getBoundingClientRect(),heading=e.parentElement.getBoundingClientRect();return !e.textContent.startsWith('Room:')&&e.getAttribute('aria-label').startsWith('Room:')&&getComputedStyle(e).fontWeight==='700'&&name.right<=room.left+1&&Math.abs(room.right-heading.right)<2&&room.top<name.bottom;})"),true,'bold accessible rooms sit right of class names without overlap');
    assert.equal(await evaluate("[...document.querySelectorAll('.lesson-card')].every(e=>{const room=e.querySelector('.session-room'),title=e.querySelector('.session-lesson-title');return !room||!title||title.getBoundingClientRect().top>=room.getBoundingClientRect().bottom-1;})"),true,'room names do not cover lesson titles');}
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false},sessionId);
  // Late account/session/year/organisation reads cannot replace the new view.
  for(const changeContext of ["window.__setScope('year',crypto.randomUUID())","window.__setScope('org',crypto.randomUUID())","window.__switchAccount()",...(authMode==='server'?["window.__replaceSession()"]:[])]){
    await evaluate('window.__holdDate=true');await evaluate('void window.__sessionContext.reload()');await waitFor('__heldDates.length>0');
    await evaluate('window.__holdDate=false;'+changeContext);await waitFor("!document.querySelector('.timetable-room-status')");
    const before=await rooms();await evaluate('__heldDates.splice(0).forEach(f=>f())');await renderedBarrier();assert.deepEqual(await rooms(),before);
  }
  assert.equal(await evaluate("document.querySelector('.session-room').textContent.includes('Other organisation room')"),true);
  assert.deepEqual(await evaluate('__testErrors'),[]);console.log('Main timetable actual rooms, null/archive/rename, dated overrides, failure recovery, stale scopes and desktop/phone rendering passed.');

} finally {
  try{socket?.close();}catch{ /* Browser is closing. */ }
  if(chrome && chrome.exitCode===null && chrome.signalCode===null){chrome.kill();
    await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2500))]);
    if(chrome.exitCode===null && chrome.signalCode===null)chrome.kill('SIGKILL');}
  await rm(directory,{recursive:true,force:true});
}
