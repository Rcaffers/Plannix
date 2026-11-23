import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-input-rooms-'));
let chrome; let socket;
try {
  const authMode=process.env.PLANNIX_BROWSER_AUTH_MODE || 'bearer';
  assert.ok(['bearer','server'].includes(authMode));
  await build({ configFile:false, logLevel:'error', define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_PLANNIX_AUTH_MODE':JSON.stringify(authMode)}, esbuild:{jsx:'automatic'},
    plugins:[{name:'input-rooms-fixture',enforce:'pre',resolveId(source,importer){
      if(importer?.endsWith('/TimetableSessionContext.jsx') && ['./AcademicYearContext','./ClassContext','./TimetableLayoutContext','../utils/timetableSessionApi'].includes(source)) return path.resolve('src/components/InputRooms.browser-test.jsx');
      if(importer?.endsWith('/ProjectCard.jsx') && ['../context/AcademicYearContext','../context/ClassContext','../context/TimetableLayoutContext'].includes(source)) return path.resolve('src/components/InputRooms.browser-test.jsx');
      if(importer?.endsWith('/useRooms.js') && source==='../utils/roomApi')return path.resolve('src/components/InputRooms.browser-test.jsx');
      return null;
    }}],
    build:{outDir:directory,emptyOutDir:false,lib:{entry:'src/components/InputRooms.browser-test.jsx',
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
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);return result.result.value;};
  const waitFor=async expression=>{const end=Date.now()+6000;while(!await evaluate(expression)){
    if(Date.now()>end)throw Error(`Rendered Classes timed out: ${expression}; body=${await evaluate('document.body.textContent.slice(0,250)')}; errors=${JSON.stringify(await evaluate('window.__testErrors'))}`);
    await new Promise(resolve=>setTimeout(resolve,30));}};
  const renderedBarrier=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const change=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  await waitFor("document.querySelector('.lesson-card-action') && !document.body.textContent.includes('Loading and confirming room assignments')");
  // The provider survives navigation from the dated main timetable into Input classes.
  await evaluate('window.__disableRoomControls()');await renderedBarrier();await evaluate("window.__sessionContext.loadDate('2026-11-23')");
  await evaluate('window.__failRead=true;window.__enableRoomControls()');await waitFor("document.body.textContent.includes('Room assignment read failed')");
  await evaluate('window.__failRead=false');await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reload timetable and rooms').click()");
  await waitFor("document.querySelector('.lesson-card-action') && !document.body.textContent.includes('Loading and confirming room assignments')");
  const roomValue=()=>evaluate("document.querySelector('#lesson-room-input')?.value");
  const open=async n=>{await evaluate(`[...document.querySelectorAll('.lesson-card-action')][${n}].click()`);await waitFor("document.querySelector('#lesson-room-input')!==null");};
  const save=async()=>{await evaluate("document.querySelector('.lesson-modal-save').click()");await waitFor("document.querySelector('.lesson-modal')===null");await renderedBarrier();};
  await open(0);assert.equal(await roomValue(),await evaluate('__ids.archived'));assert.match(await evaluate("document.querySelector('#lesson-room-input option:checked').textContent"),/Archived/);
  await change('#lesson-title-input','Unrelated title edit');await save();assert.equal(await evaluate('__store.find(s=>s.id===__ids.assigned).roomId'),await evaluate('__ids.archived'));
  await open(1);assert.equal(await roomValue(),'','existing no-room is not filled from the archived class default');await change('#lesson-title-input','Blank stays blank');await save();assert.equal(await evaluate('__store.find(s=>s.id===__ids.blank).roomId'),null);
  await open(0);await change('#lesson-room-input','');await save();assert.equal(await evaluate('__store.find(s=>s.id===__ids.assigned).roomId'),null);
  // Active default: palette placement initializes an explicit room; no-default initializes null.
  await evaluate("[...document.querySelectorAll('.class-placement-chip')].find(b=>b.textContent.includes('Maths')).click()");
  await evaluate("document.querySelector('.lesson-card--empty').click()");await waitFor('__store.length===3 && __store.some(s=>s.roomId===__ids.active)');
  await evaluate("[...document.querySelectorAll('.class-placement-chip')].find(b=>b.textContent.includes('No default')).click()");await evaluate("document.querySelector('.lesson-card--empty').click()");await waitFor('__store.length===4');assert.equal(await evaluate('__store.at(-1).roomId'),null);
  // Archived default: no write until an explicit valid room/no-room choice.
  const writes=await evaluate('__writes');await evaluate("[...document.querySelectorAll('.class-placement-chip')].find(b=>b.textContent.includes('Science')).click()");await evaluate("document.querySelector('.lesson-card--empty').click()");await waitFor("document.querySelector('#lesson-room-input')?.value==='__choose-room__'");assert.equal(await evaluate('__writes'),writes);
  await evaluate("document.querySelector('.lesson-modal-save').click()");assert.equal(await evaluate('__writes'),writes);await change('#lesson-room-input','');await save();assert.equal(await evaluate('__store.length'),5);
  // Read failure cannot publish empty assignments or enable room writes.
  await evaluate('window.__failRead=true');
  await evaluate("window.__setScope('table','a0000000-0000-4000-8000-000000000050')");await waitFor("document.body.textContent.includes('Room assignment read failed')");const before=await evaluate('__writes');await evaluate("document.querySelector('.lesson-card-action')?.click()");assert.equal(await evaluate('__writes'),before);assert.equal(await evaluate("document.querySelector('#lesson-room-input')"),null);
  await evaluate('window.__failRead=false');await evaluate("[...document.querySelectorAll('button')].find(b=>['Reload','Reload timetable and rooms'].includes(b.textContent.trim())).click()");await waitFor("!document.body.textContent.includes('Room assignment read failed') && document.querySelector('.lesson-card-action')!==null");
  await open(0);await change('#lesson-room-input',await evaluate('__ids.active'));await evaluate('window.__rejectWrite=true');await save();await waitFor("document.body.textContent.includes('Write failed')");assert.equal(await evaluate('__store.find(s=>s.id===__ids.assigned).roomId'),null);
  await evaluate('window.__rejectWrite=false');await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reload timetable and rooms').click()");await waitFor("!document.body.textContent.includes('Write failed')");
  // Unknown write completion: retry is revision-fenced; reload confirms without replay.
  await open(0);await change('#lesson-room-input',await evaluate('__ids.active'));await evaluate('window.__uncertainWrite=true');await save();await waitFor("document.body.textContent.includes('Write completion uncertain')");const applied=await evaluate('__applied');await evaluate('window.__uncertainWrite=false');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retry save').click()");await waitFor("document.body.textContent.includes('Revision conflict')");assert.equal(await evaluate('__applied'),applied);
  const reads=await evaluate('__sessionReads');await evaluate('window.confirm=()=>false');await evaluate("[...document.querySelectorAll('button')].find(b=>['Reload','Reload timetable and rooms'].includes(b.textContent.trim())).click()");assert.equal(await evaluate('__sessionReads'),reads,'discard refusal preserves pending room changes');await evaluate('window.confirm=()=>true');
  await evaluate("[...document.querySelectorAll('button')].find(b=>['Reload','Reload timetable and rooms'].includes(b.textContent.trim())).click()");await waitFor("!document.body.textContent.includes('Write completion uncertain') && !document.body.textContent.includes('Revision conflict')");
  await open(0);assert.equal(await roomValue(),await evaluate('__ids.active'));await evaluate("document.querySelector('.lesson-modal-cancel').click()");
  // Late reads must not settle a replacement timetable/account/session context.
  await evaluate("window.__holdRead=true;window.__setScope('table','a0000000-0000-4000-8000-000000000051')");await waitFor('__heldReads.length>0');await evaluate("window.__holdRead=false;window.__setScope('table','a0000000-0000-4000-8000-000000000052')");await waitFor("document.querySelector('.lesson-card-action')!==null");await evaluate('__heldReads.splice(0).forEach(f=>f())');await renderedBarrier();
  for(const changeContext of ["window.__setScope('year','a0000000-0000-4000-8000-000000000054')","window.__setScope('org','a0000000-0000-4000-8000-000000000055')","window.__switchAccount()",...(authMode==='server'?["window.__replaceSession()"]:[])]){
    await evaluate("window.__holdRead=true;window.__setScope('table',crypto.randomUUID())");await waitFor('__heldReads.length>0');
    await evaluate('window.__holdRead=false;'+changeContext);await waitFor("document.querySelector('.lesson-card-action')!==null && !document.body.textContent.includes('Loading and confirming room assignments')");
    const accepted=await evaluate('__writes');await evaluate('__heldReads.splice(0).forEach(f=>f())');await renderedBarrier();assert.equal(await evaluate('__writes'),accepted);assert.equal(await evaluate("document.body.textContent.includes('Stale held-context lesson')"),false);
    await open(0);assert.equal(await roomValue(),await evaluate('__store.find(s=>s.id===__ids.assigned).roomId||""'));await evaluate("document.querySelector('.lesson-modal-cancel').click()");
  }
  // Confirmed week switches discard the old queue, not its in-flight server write.
  await evaluate("window.__setScope('twoWeek',true)");await renderedBarrier();
  await open(0);await change('#lesson-title-input','Held Week A save');await evaluate('window.__holdWrite=true');await save();await waitFor('__heldWrites.length===1');
  await evaluate('window.confirm=()=>false;window.__setInputWeek("cycle-2")');await renderedBarrier();assert.equal(await evaluate('__inputWeek'),'cycle-1');
  await evaluate('window.confirm=()=>true;window.__holdWrite=false;window.__setInputWeek("cycle-2")');await waitFor("document.body.textContent.includes('Week B lesson') && !window.__sessionContext.isLoading && window.__sessionContext.roomAssignmentsReady");
  await open(0);assert.equal(await roomValue(),'');await evaluate("document.querySelector('.lesson-modal-cancel').click()");
  const currentRevision=await evaluate('window.__sessionContext.revision');await evaluate('__heldWrites.splice(0).forEach(f=>f())');await renderedBarrier();assert.equal(await evaluate('window.__sessionContext.revision'),currentRevision);assert.equal(await evaluate('window.__sessionContext.saved'),false,'old week completion cannot report a save in the new week');
  await evaluate('window.__setInputWeek("cycle-1")');await waitFor("document.body.textContent.includes('Held Week A save') && !window.__sessionContext.isLoading");
  await evaluate('window.__setInputWeek("cycle-2")');await waitFor("document.body.textContent.includes('Week B lesson') && !window.__sessionContext.isLoading");
  await open(0);await change('#lesson-title-input','Held Week B save');await evaluate('window.__holdWrite=true');await save();await waitFor('__heldWrites.length===1');
  await evaluate('window.__holdWrite=false;window.__setInputWeek("cycle-1")');await waitFor("document.body.textContent.includes('Held Week A save') && !window.__sessionContext.isLoading");
  await evaluate('__heldWrites.splice(0).forEach(f=>f(true))');await renderedBarrier();assert.equal(await evaluate('window.__sessionContext.error'),'','late previous-week rejection cannot replace current state');
  for(const width of [1280,390]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},sessionId);await open(0);assert.equal(await evaluate("document.querySelector('.lesson-modal').scrollWidth<=document.querySelector('.lesson-modal').clientWidth"),true);await evaluate("document.querySelector('#lesson-room-input').focus()");assert.equal(await evaluate('document.activeElement.id'),'lesson-room-input');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);await waitFor("document.querySelector('.lesson-modal')===null");}
  await evaluate('window.__disableRoomControls()');await renderedBarrier();await evaluate("document.querySelector('.lesson-card-action').click()");assert.equal(await evaluate("document.querySelector('#lesson-room-input')===null"),true,'non-input ProjectCard never exposes a room editor');
  assert.deepEqual(await evaluate('window.__testErrors'),[]);console.log('Input room default, null/archive persistence, failed reads, unknown writes, stale scope, keyboard and desktop/phone checks passed.');
} finally {
  try{socket?.close();}catch{ /* Browser is closing. */ }
  if(chrome && chrome.exitCode===null && chrome.signalCode===null){chrome.kill();
    await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2500))]);
    if(chrome.exitCode===null && chrome.signalCode===null)chrome.kill('SIGKILL');}
  await rm(directory,{recursive:true,force:true});
}
