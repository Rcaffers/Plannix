import test from 'node:test';import assert from 'node:assert/strict';
import { newPlacementRoom } from './timetableRooms.js';
import { displayToSession,sessionToDisplay } from './timetableSessionState.js';
import { applyClassPlacement } from './timetableClassPlacement.js';
test('new defaults distinguish active, absent, archived and unavailable rooms',()=>{
 const classes=[{id:'a',defaultRoomId:'active'},{id:'b',defaultRoomId:'archived'},{id:'c',defaultRoomId:null},{id:'d',defaultRoomId:'missing'}],rooms=[{id:'active',isActive:true},{id:'archived',isActive:false}];
 assert.equal(newPlacementRoom('a',classes,rooms),'active');assert.equal(newPlacementRoom('b',classes,rooms),undefined);assert.equal(newPlacementRoom('c',classes,rooms),null);assert.equal(newPlacementRoom('d',classes,rooms),undefined);
});
test('display conversion and supported moves/swaps retain explicit null and room IDs',()=>{
 const a={id:'a',day:0,periodId:'p1',classId:'c',title:'',notes:'',roomId:null},b={id:'b',day:1,periodId:'p1',classId:'c',title:'',notes:'',roomId:'archived'};
 const shown=sessionToDisplay(a,new Map([['p1',0]]),new Map([['c','Class']]),'temp');assert.equal(displayToSession(shown,new Map([[0,'p1']])).roomId,null);
 const result=applyClassPlacement({sessions:[a,b],frequencySessions:[a,b],plannedClasses:[{id:'c',name:'Class',max:4}],weekId:'A',slots:[{weekId:'A',day:0,periodId:'p1'},{weekId:'A',day:1,periodId:'p1'}],safe:true,destination:{weekId:'A',day:1,periodId:'p1'},action:{type:'session',weekId:'A',source:{weekId:'A',day:0,periodId:'p1'},session:a}});
 assert.equal(result.ok,true);assert.equal(result.sessions.find(s=>s.id==='a').roomId,null);assert.equal(result.sessions.find(s=>s.id==='b').roomId,'archived');
});
