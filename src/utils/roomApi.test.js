import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomApi } from './roomApi.js';
const scope={organisationId:'10000000-0000-4000-8000-000000000001',userId:'synthetic-owner'};
const room={id:'91000000-0000-4000-8000-000000000001',name:'Lab',isActive:true};
const session=async()=>({access_token:'synthetic-token',user:{id:scope.userId}});
test('room requests use verified user context, scoped URL, no-store and optional PATCH',async()=>{const seen=[];const api=createRoomApi({getSession:session,fetchImpl:async(path,options)=>{seen.push({path,options});return Response.json(options.method==='GET'?{rooms:[room],canManage:true}:{room});}});assert.deepEqual((await api.load(scope)).rooms,[room]);assert.deepEqual(await api.save(scope,room.id,{isActive:false}),room);assert.match(seen[0].path,/organisationId=10000000/);assert.equal(seen[0].options.cache,'no-store');assert.equal(seen[1].options.method,'PATCH');assert.equal(seen[1].options.body,'{"isActive":false}');});
test('room client rejects wrong account before fetch and malformed room responses',async()=>{let calls=0;const api=createRoomApi({getSession:async()=>({access_token:'synthetic',user:{id:'other'}}),fetchImpl:()=>{calls++;}});await assert.rejects(()=>api.load(scope),/Account changed/);assert.equal(calls,0);for(const value of [{rooms:[{...room,isActive:'true'}],canManage:true},{rooms:[{...room,credential:'unexpected'}],canManage:true},{rooms:[room]}]){await assert.rejects(()=>createRoomApi({getSession:session,fetchImpl:async()=>Response.json(value)}).load(scope),/confirm room/);}});
test('denied and uncertain writes propagate without automatic retries',async()=>{for(const status of [403,409,503]){let calls=0;const api=createRoomApi({getSession:session,fetchImpl:async()=>{calls++;return Response.json({message:'Synthetic failure'},{status});}});await assert.rejects(()=>api.save(scope,null,{name:'Lab'}),e=>e.status===status);assert.equal(calls,1);}});


test('delete confirms only the targeted room and never retries uncertain results',async()=>{
 const seen=[];const api=createRoomApi({getSession:session,fetchImpl:async(path,options)=>{seen.push({path,options});return Response.json({deletedRoomId:room.id});}});
 assert.equal(await api.remove(scope,room.id),room.id);assert.equal(seen[0].options.method,'DELETE');assert.equal(seen[0].options.body,undefined);assert.match(seen[0].path,new RegExp(room.id));
 for(const value of [{deletedRoomId:'other'},{deletedRoomId:room.id,extra:true}])await assert.rejects(createRoomApi({getSession:session,fetchImpl:async()=>Response.json(value)}).remove(scope,room.id),/confirm the deletion/);
 let calls=0;await assert.rejects(createRoomApi({getSession:session,fetchImpl:async()=>{calls++;return Response.json({message:'Unknown completion'},{status:503});}}).remove(scope,room.id),e=>e.status===503);assert.equal(calls,1);
});
test('a context change while authenticating prevents a stale delete',async()=>{
 let current=true,release,calls=0;const api=createRoomApi({getSession:()=>new Promise(resolve=>{release=resolve;}),fetchImpl:()=>{calls++;}});
 const pending=api.remove(scope,room.id,{isCurrent:()=>current});current=false;release({access_token:'synthetic',user:{id:scope.userId}});await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(calls,0);
});
