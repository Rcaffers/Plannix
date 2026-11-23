import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'plannix-classes-rooms-'));
let chrome; let socket;
try {
  const authMode=process.env.PLANNIX_BROWSER_AUTH_MODE || 'bearer';
  assert.ok(['bearer','server'].includes(authMode));
  await build({ configFile:false, logLevel:'error', define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_PLANNIX_AUTH_MODE':JSON.stringify(authMode)}, esbuild:{jsx:'automatic'},
    plugins:[{name:'classes-guidance-fixture',enforce:'pre',resolveId(source,importer) {
      if (importer?.endsWith('/useRooms.js') && source === '../utils/roomApi') return path.resolve('src/pages/ClassesRooms.browser-mocks.js');
      if (importer?.endsWith('/ClassContext.jsx')
        && (source === './AcademicYearContext' || source === '../utils/api'))
        return path.resolve('src/pages/ClassesRooms.browser-mocks.js');
      if ((importer?.endsWith('/SetupGuide.jsx') || importer?.endsWith('/Classes.jsx'))
        && ['../context/AcademicYearContext','../context/TimetableLayoutContext',
          '../context/TimetableSessionContext'].includes(source))
        return path.resolve('src/pages/ClassesRooms.browser-mocks.js');
      return null;
    }}],
    build:{outDir:directory,emptyOutDir:false,lib:{entry:'src/pages/ClassesRooms.browser-test.jsx',
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
  await waitFor("document.querySelector('#class-room-0')?.value==='91000000-0000-4000-8000-000000000002'");
  assert.equal(await evaluate("document.querySelector('#class-room-0 option:checked').disabled"),true,'archived current assignment is retained but not a new option');
  assert.match(await evaluate("document.querySelector('#class-room-0 option:checked').textContent"),/Archived/);
  assert.equal(await evaluate("document.querySelectorAll('#class-room-0 option').length"),3);
  await evaluate("document.querySelector('.classes-collection-form .classes-save').click()");
  await waitFor("window.__classWrites===1 && !document.querySelector('.classes-collection-form .classes-save').disabled");
  assert.equal(await evaluate("window.__classes['ayear-1'][0].defaultRoomId"),'91000000-0000-4000-8000-000000000002');
  await change('#class-room-0','91000000-0000-4000-8000-000000000001');
  await evaluate("document.querySelector('.classes-collection-form .classes-save').click()");
  await waitFor("window.__classWrites===2 && !document.querySelector('.classes-collection-form .classes-save').disabled");
  assert.equal(await evaluate("window.__classes['ayear-1'][0].defaultRoomId"),'91000000-0000-4000-8000-000000000001');
  await change('#class-room-0','');await evaluate("document.querySelector('.classes-collection-form .classes-save').click()");
  await waitFor("window.__classWrites===3 && !document.querySelector('.classes-collection-form .classes-save').disabled");
  assert.equal(await evaluate("window.__classes['ayear-1'][0].defaultRoomId"),null);
  assert.equal(await evaluate("[...document.querySelectorAll('.rooms-card button')].some(b=>/Archive|Reactivate/.test(b.textContent))"),false);
  await evaluate("document.querySelector('[aria-label=\"Rename room Old room\"]').click()");
  await waitFor("document.activeElement?.id.startsWith('room-rename-')");
  await change('[id^=room-rename-]','Cancelled archived name');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
  await waitFor("!document.querySelector('.rooms-inline-editor') && document.activeElement?.getAttribute('aria-label')==='Rename room Old room'");
  assert.equal(await evaluate("window.__rooms.a.find(r=>r.name==='Old room').isActive"),false);
  await evaluate("document.querySelector('[aria-label=\"Delete room Old room\"]').click()");await waitFor("document.activeElement?.textContent==='Cancel'");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
  await waitFor("!document.querySelector('.rooms-delete-confirmation') && document.activeElement?.getAttribute('aria-label')==='Delete room Old room'");
  const cancelled=await evaluate('window.__roomWrites');
  await evaluate("document.querySelector('[aria-label=\"Delete room Old room\"]').click()");
  assert.equal(await evaluate("document.querySelector('.rooms-delete-confirmation').textContent.includes('Old room')"),true);
  await evaluate("[...document.querySelectorAll('.rooms-delete-confirmation button')].find(b=>b.textContent==='Cancel').click()");assert.equal(await evaluate('__roomWrites'),cancelled);
  await evaluate("document.querySelector('[aria-label=\"Delete room Old room\"]').click()");await waitFor("document.querySelector('.rooms-confirm-delete')!==null");await evaluate("document.querySelector('.rooms-confirm-delete').click()");
  await waitFor("document.querySelector('.rooms-card [role=alert]')?.textContent.includes('Remove those assignments')");
  assert.equal(await evaluate("window.__rooms.a.some(r=>r.name==='Old room' && !r.isActive)"),true);
  await evaluate("document.querySelector('[aria-label=\"Rename room Room 12\"]').click()");
  await change('[id^=room-rename-]','Renamed lab');await evaluate("document.querySelector('.rooms-inline-editor').requestSubmit()");
  await waitFor("document.querySelector('[aria-label=\"Rename room Renamed lab\"]')!==null");
  await evaluate("document.querySelector('[aria-label=\"Rename room Renamed lab\"]').click()");await change('[id^=room-rename-]','Rejected lab');
  await evaluate('window.__rejectRoomWrite=true');await evaluate("document.querySelector('.rooms-inline-editor').requestSubmit()");
  await waitFor("document.querySelector('.rooms-card [role=alert]')?.textContent.includes('Synthetic room validation')");
  assert.equal(await evaluate("document.querySelector('[id^=room-rename-]').value"),'Rejected lab');assert.equal(await evaluate("window.__rooms.a.some(r=>r.name==='Renamed lab')"),true);
  await evaluate('window.__rejectRoomWrite=false');await evaluate("[...document.querySelectorAll('.rooms-inline-editor button')].find(b=>b.textContent==='Cancel').click()");
  await waitFor("document.activeElement?.getAttribute('aria-label')==='Rename room Renamed lab'");
  // Full readback failure after a confirmed server write remains recoverable without replay.
  await change('#room-name','New science room');await evaluate('window.__failRoomRead=true');
  await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  await waitFor("document.querySelector('.rooms-card [role=alert]')?.textContent.includes('could not be confirmed')");
  const writes=await evaluate('window.__roomWrites');
  assert.equal(await evaluate("document.querySelector('.rooms-editor button').disabled"),true);
  assert.equal(await evaluate("document.querySelector('#room-name').value"),'New science room','failed readback retains entered name');
  await evaluate('window.__failRoomRead=false');await evaluate("[...document.querySelectorAll('.rooms-card button')].find(b=>b.textContent==='Reload rooms').click()");
  await waitFor("document.querySelector('.rooms-list').textContent.includes('New science room') && !document.querySelector('.rooms-card [role=alert]')");
  assert.equal(await evaluate('window.__roomWrites'),writes,'reload never replays uncertain writes');
  for (const status of [403,404]) {
    await change('#room-name',`Readback status ${status}`);
    await evaluate(`window.__roomReadStatus=${status};window.__failRoomRead=true`);
    await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
    await waitFor("document.querySelector('.rooms-card [role=alert]')?.textContent.includes('may already have saved')");
    const count=await evaluate('window.__roomWrites');
    assert.equal(await evaluate("document.querySelector('.rooms-editor button')?.disabled!==false"),true,'readback rejection never permits a blind replay');
    await evaluate('window.__failRoomRead=false;window.__roomReadStatus=undefined');
    await evaluate("[...document.querySelectorAll('.rooms-card button')].find(b=>b.textContent==='Reload rooms').click()");
    await waitFor(`document.querySelector('.rooms-list').textContent.includes('Readback status ${status}') && !document.querySelector('.rooms-card [role=alert]')`);
    assert.equal(await evaluate('window.__roomWrites'),count);
  }
  // Account change while a write is held: old completion cannot update the new account.
  await evaluate('window.__holdRoomWrite=true');await change('#room-name','Held old-account room');await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  await waitFor('window.__pendingRoomWrites.length===1');
  assert.equal(await evaluate("document.querySelector('.rooms-card [role=status]')?.textContent"),'Saving room changes…');
  await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  assert.equal(await evaluate('window.__pendingRoomWrites.length'),1,'pending save rejects duplicate submissions');
  await evaluate("window.__switchAccount('b')");
  await waitFor("document.querySelector('.rooms-list')?.textContent.includes('Other account room')");
  await evaluate('window.__holdRoomWrite=false;window.__pendingRoomWrites.shift()()');
  await renderedBarrier();
  assert.equal(await evaluate("document.querySelector('.rooms-list').textContent.includes('Held old-account room')"),false);
  assert.equal(await evaluate("document.querySelector('.rooms-editor')===null && document.querySelector('#class-room-0')===null"),true,'read-only account receives no room management or assignment controls');
  await evaluate("window.__switchAccount('a')");await waitFor("document.querySelector('#class-room-0')!==null");
  // Year change while a read is held; a late snapshot cannot override the new scope.
  await evaluate("window.__holdRoomRead=true;window.__setYear('year-2')");await waitFor('window.__pendingRoomReads.length===1');
  await evaluate("window.__holdRoomRead=false;window.__setYear('year-3')");
  await waitFor("document.querySelector('#class-name-0')?.value==='Maths year-3' && document.querySelector('#class-room-0')!==null");
  await evaluate('window.__pendingRoomReads.shift()()');await renderedBarrier();
  assert.equal(await evaluate("document.querySelector('#class-name-0').value"),'Maths year-3');
  // Same-account session replacement invalidates held class saves too.
  await evaluate('window.__holdClassWrite=true');await change('#class-name-0','Old session draft');await evaluate("document.querySelector('.classes-collection-form .classes-save').click()");
  await waitFor('window.__pendingClassWrites.length===1');await evaluate("window.dispatchEvent(new Event('plannix-server-session-change'))");
  await waitFor("document.querySelector('#class-name-0')?.value==='Maths year-3'");
  await evaluate('window.__holdClassWrite=false;window.__pendingClassWrites.shift()()');await renderedBarrier();
  assert.equal(await evaluate("document.querySelector('#class-name-0').value"),'Maths year-3');
  await waitFor("document.querySelector('[aria-label=\"Rename room Renamed lab\"]')?.disabled===false");
  await evaluate("document.querySelector('[aria-label=\"Rename room Renamed lab\"]').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13},sessionId);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessionId);
  await waitFor("document.activeElement?.id.startsWith('room-rename-')");
  await change('[id^=room-rename-]','Long room name '.repeat(12));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sessionId);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sessionId);
  assert.equal(await evaluate("document.activeElement?.textContent"),'Save','keyboard order reaches the save action');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13},sessionId);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessionId);
  await waitFor("document.querySelector('.rooms-list').textContent.includes('Long room name') && document.querySelector('.rooms-card [role=status]')?.textContent==='Room saved.'");
  for (const width of [1280,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},sessionId);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'no horizontal overflow');
    assert.equal(await evaluate("[...document.querySelectorAll('.rooms-card button')].every(b=>b.type!=='submit'||b.closest('form'))"),true);
  }
  // Confirmed delete followed by failed readback blocks a second deletion until reload.
  await change('#room-name','Delete-only room');await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  await waitFor("document.querySelector('[aria-label=\"Delete room Delete-only room\"]')?.disabled===false");
  await evaluate('window.__failRoomRead=true');await evaluate("document.querySelector('[aria-label=\"Delete room Delete-only room\"]').click()");await waitFor("document.querySelector('.rooms-confirm-delete')!==null");await evaluate("document.querySelector('.rooms-confirm-delete').click()");
  await waitFor("document.querySelector('.rooms-card [role=alert]')?.textContent.includes('deletion could not be confirmed')");
  const deletionWrites=await evaluate('__roomWrites');assert.equal(await evaluate("document.querySelector('[aria-label=\"Delete room Delete-only room\"]').disabled"),true);
  await evaluate('window.__failRoomRead=false');await evaluate("[...document.querySelectorAll('.rooms-card button')].find(b=>b.textContent==='Reload rooms').click()");
  await waitFor("!document.querySelector('[aria-label=\"Delete room Delete-only room\"]') && !document.querySelector('.rooms-card [role=alert]')");assert.equal(await evaluate('__roomWrites'),deletionWrites);
  await change('#room-name','Uncertain delete room');await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  await waitFor("document.querySelector('[aria-label=\"Delete room Uncertain delete room\"]')?.disabled===false");
  await evaluate('window.__uncertainWrite=true');await evaluate("document.querySelector('[aria-label=\"Delete room Uncertain delete room\"]').click()");await waitFor("document.querySelector('.rooms-confirm-delete')!==null");await evaluate("document.querySelector('.rooms-confirm-delete').click()");
  await waitFor("document.querySelector('.rooms-card [role=alert]')?.textContent.includes('deletion could not be confirmed')");
  const uncertainDeleteWrites=await evaluate('__roomWrites');await evaluate('window.__uncertainWrite=false');await evaluate("[...document.querySelectorAll('.rooms-card button')].find(b=>b.textContent==='Reload rooms').click()");
  await waitFor("!document.querySelector('[aria-label=\"Delete room Uncertain delete room\"]') && !document.querySelector('.rooms-card [role=alert]')");assert.equal(await evaluate('__roomWrites'),uncertainDeleteWrites);
  await change('#room-name','Confirmed delete room');await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  await waitFor("document.querySelector('[aria-label=\"Delete room Confirmed delete room\"]')?.disabled===false");await evaluate("document.querySelector('[aria-label=\"Delete room Confirmed delete room\"]').click()");await waitFor("document.querySelector('.rooms-confirm-delete')!==null");await evaluate("document.querySelector('.rooms-confirm-delete').click()");
  await waitFor("!document.querySelector('[aria-label=\"Delete room Confirmed delete room\"]') && document.querySelector('.rooms-card [role=status]')?.textContent==='Room deleted.'");
  await change('#room-name','Held delete room');await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  await waitFor("document.querySelector('[aria-label=\"Delete room Held delete room\"]')?.disabled===false");await evaluate('window.__holdRoomWrite=true');
  await evaluate("document.querySelector('[aria-label=\"Delete room Held delete room\"]').click()");await waitFor("document.querySelector('.rooms-confirm-delete')!==null");await evaluate("document.querySelector('.rooms-confirm-delete').click()");await waitFor('__pendingRoomWrites.length===1');
  await evaluate("document.querySelector('[aria-label=\"Delete room Held delete room\"]').click()");await waitFor("document.querySelector('.rooms-confirm-delete')!==null");await evaluate("document.querySelector('.rooms-confirm-delete').click()");assert.equal(await evaluate('__pendingRoomWrites.length'),1);
  await evaluate("window.__switchAccount('b')");await waitFor("document.querySelector('.rooms-list')?.textContent.includes('Other account room')");
  await evaluate('window.__holdRoomWrite=false;window.__pendingRoomWrites.shift()()');await renderedBarrier();assert.equal(await evaluate("document.querySelector('.rooms-card .classes-saved')===null"),true);
  await evaluate("window.__switchAccount('a')");await waitFor("document.querySelector('#room-name') && !document.querySelector('[aria-label=\"Delete room Held delete room\"]')");
  // A filtered read after lost management access is not proof of deletion.
  await change('#room-name','Role-change delete room');await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  await waitFor("document.querySelector('[aria-label=\"Delete room Role-change delete room\"]')?.disabled===false");
  await evaluate('window.__loseRoleAfterDelete=true');await evaluate("document.querySelector('[aria-label=\"Delete room Role-change delete room\"]').click()");await waitFor("document.querySelector('.rooms-confirm-delete')!==null");await evaluate("document.querySelector('.rooms-confirm-delete').click()");
  await waitFor("document.querySelector('.rooms-card [role=alert]')?.textContent.includes('deletion could not be confirmed')");
  assert.equal(await evaluate("document.querySelector('.rooms-card .classes-saved')===null"),true);const roleChangeWrites=await evaluate('__roomWrites');
  await evaluate('window.__loseRoleAfterDelete=false;window.__loseReadbackRole=false');await evaluate("[...document.querySelectorAll('.rooms-card button')].find(b=>b.textContent==='Reload rooms').click()");
  await waitFor("!document.querySelector('.rooms-card [role=alert]') && !document.querySelector('[aria-label=\"Delete room Role-change delete room\"]')");assert.equal(await evaluate('__roomWrites'),roleChangeWrites);
  // Default-only deletion clears saved defaults and refreshes the actual class provider.
  await change('#room-name','Default-only room');await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  await waitFor("document.querySelector('[aria-label=\"Delete room Default-only room\"]')?.disabled===false");
  const defaultRoom=await evaluate("window.__rooms.a.find(r=>r.name==='Default-only room').id");
  await change('#class-room-0',defaultRoom);await evaluate("document.querySelector('.classes-collection-form').requestSubmit()");
  await waitFor("document.querySelector('[aria-label=\"Delete room Default-only room\"]')?.disabled===false");
  await evaluate("document.querySelector('[aria-label=\"Delete room Default-only room\"]').click()");
  await waitFor("document.querySelector('.rooms-confirm-delete')!==null");
  assert.equal(await evaluate("document.querySelector('.rooms-delete-confirmation').textContent.includes('No default room')"),true);
  for(const width of [1280,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},sessionId);await renderedBarrier();
    assert.equal(await evaluate("(()=>{const card=document.querySelector('.rooms-card').getBoundingClientRect(),confirmation=document.querySelector('.rooms-delete-confirmation').getBoundingClientRect();return confirmation.left>=card.left && confirmation.right<=card.right && [...document.querySelectorAll('.rooms-delete-confirmation button')].every(b=>b.getBoundingClientRect().right<=card.right);})()"),true,'named deletion confirmation and actions stay inside the card at desktop and phone widths');
  }
  await evaluate("document.querySelector('.rooms-confirm-delete').click()");
  await waitFor("!document.querySelector('[aria-label=\"Delete room Default-only room\"]') && document.querySelector('#class-room-0').value==='' && document.querySelector('.rooms-card [role=status]')?.textContent==='Room deleted.'");
  // A confirmed deletion with failed class refresh stays uncertain until explicit readback.
  await change('#room-name','Class-refresh failure room');await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  await waitFor("document.querySelector('[aria-label=\"Delete room Class-refresh failure room\"]')?.disabled===false");
  await change('#class-room-0',await evaluate("window.__rooms.a.find(r=>r.name==='Class-refresh failure room').id"));
  await evaluate("document.querySelector('.classes-collection-form').requestSubmit()");
  await waitFor("document.querySelector('[aria-label=\"Delete room Class-refresh failure room\"]')?.disabled===false");
  await evaluate("window.__failClassRead=true;document.querySelector('[aria-label=\"Delete room Class-refresh failure room\"]').click()");
  await waitFor("document.querySelector('.rooms-confirm-delete')!==null");await evaluate("document.querySelector('.rooms-confirm-delete').click()");
  await waitFor("document.querySelector('.rooms-card [role=alert]')?.textContent.includes('deletion could not be confirmed')");
  assert.equal(await evaluate("document.querySelector('.classes-collection-form .classes-save').disabled"),true);
  const classRefreshWrites=await evaluate('__roomWrites');
  await evaluate('window.__failClassRead=false');await evaluate("[...document.querySelectorAll('.rooms-card button')].find(b=>b.textContent==='Reload rooms').click()");
  await waitFor("!document.querySelector('.rooms-card [role=alert]') && document.querySelector('#class-room-0')?.value===''");
  assert.equal(await evaluate('__roomWrites'),classRefreshWrites,'failed class refresh recovery only reads, never replays deletion');
  await evaluate('window.__setYear(null)');
  await waitFor("document.querySelector('.rooms-editor')!==null && document.querySelector('.rooms-card').getAttribute('aria-busy')==='false'");
  await waitFor("document.querySelectorAll('.classes-entry-card').length===0 && document.querySelector('.rooms-editor input')?.disabled===false");
  assert.equal(await evaluate("document.querySelector('.classes-collection-form .classes-save').disabled"),true,'year is required for classes, not organisation-wide room management');
  assert.deepEqual(await evaluate('window.__testErrors'),[]);
  await change('#room-name','No-year recovery room');await evaluate('window.__uncertainWrite=true');await evaluate("document.querySelector('.rooms-editor').requestSubmit()");
  await waitFor("document.querySelector('.rooms-card [role=alert]')!==null");
  await evaluate('window.__uncertainWrite=false');await evaluate("[...document.querySelectorAll('.rooms-card button')].find(b=>b.textContent==='Reload rooms').click()");
  await waitFor("!document.querySelector('.rooms-card [role=alert]') && document.querySelector('.rooms-list').textContent.includes('No-year recovery room')");
  // Organisation-wide deletion is usable without selecting an academic year.
  await evaluate("window.__failClassRead=true;document.querySelector('[aria-label=\"Delete room No-year recovery room\"]').click()");
  await waitFor("document.querySelector('.rooms-confirm-delete')!==null");await evaluate("document.querySelector('.rooms-confirm-delete').click()");
  await waitFor("!document.querySelector('[aria-label=\"Delete room No-year recovery room\"]') && document.querySelector('.rooms-card [role=status]')?.textContent==='Room deleted.'");
  assert.equal(await evaluate("document.querySelectorAll('.classes-entry-card').length"),0);
  await evaluate('window.__failClassRead=false');
  console.log('Rendered room management, readback recovery, default persistence, archived selection, account/year/session races and desktop/phone layout passed.');
} finally {
  try{socket?.close();}catch{ /* Browser is closing. */ }
  if(chrome && chrome.exitCode===null && chrome.signalCode===null){chrome.kill();
    await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2500))]);
    if(chrome.exitCode===null && chrome.signalCode===null)chrome.kill('SIGKILL');}
  await rm(directory,{recursive:true,force:true});
}
