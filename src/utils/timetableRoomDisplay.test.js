import test from 'node:test';import assert from 'node:assert/strict';
import { timetableRoomText } from './timetableRoomDisplay.js';
const rooms=[{id:'assigned',name:'Science lab',isActive:true},{id:'old',name:'Old room',isActive:false}];
const ready={assignmentsReady:true,catalogueReady:true,rooms};
test('display resolves only the saved assignment, retaining null and archived rooms',()=>{
 assert.equal(timetableRoomText({roomId:'assigned',defaultRoomId:'other'},ready),'Room: Science lab');
 assert.equal(timetableRoomText({roomId:null,defaultRoomId:'assigned'},ready),null);
 assert.equal(timetableRoomText({roomId:'old'},ready),'Room: Old room (Archived)');
 assert.equal(timetableRoomText({roomId:'assigned'},{...ready,rooms:[{...rooms[0],name:'Renamed lab'}]}),'Room: Renamed lab');
});
test('unknown, failed and stale reads never become a different room or No room',()=>{
 for(const session of [{},{roomId:'missing'},{roomId:'assigned'}])assert.equal(timetableRoomText(session,{...ready,assignmentsReady:false}),'Room unavailable');
 assert.equal(timetableRoomText({},ready),'Room unavailable');assert.equal(timetableRoomText({roomId:'missing'},ready),'Room unavailable');
 assert.equal(timetableRoomText({roomId:'assigned'},{...ready,catalogueReady:false}),'Room unavailable');
 assert.equal(timetableRoomText({roomId:null},{...ready,catalogueReady:false}),null);
});
