import { useSyncExternalStore } from 'react';
export const ROOM_A='91000000-0000-4000-8000-000000000001', ROOM_OLD='91000000-0000-4000-8000-000000000002';
window.__roomWrites=0;window.__roomReads=0;window.__classWrites=0;window.__year='year-1';window.__pendingRoomReads=[];window.__pendingRoomWrites=[];window.__pendingClassWrites=[];
window.__rooms={a:[{id:ROOM_A,name:'Room 12',isActive:true},{id:ROOM_OLD,name:'Old room',isActive:false}],b:[{id:ROOM_A,name:'Other account room',isActive:true}]};
window.__classes={};
// This room has an actual lesson reference, independently of its class default.
window.__sessionRooms=[ROOM_OLD];
const subscribe=fn=>{window.addEventListener('fixture-year',fn);return()=>window.removeEventListener('fixture-year',fn);};
export function useAcademicYear(){const selectedAcademicYearId=useSyncExternalStore(subscribe,()=>window.__year);return {selectedAcademicYearId,registerAcademicYearChangeGuard:()=>()=>{}};}
export function useTimetableLayout(){return {layout:{cycle:'one-week'}};}
export async function fetchClassCollection(org,year){if(window.__failClassRead)throw Error('Synthetic class read failure');return {revision:1,entries:window.__classes[org+year] || [{id:'ca000000-0000-4000-8000-000000000001',name:org==='a'?'Maths '+year:'Other account class',frequency:2,defaultRoomId:org==='a'?ROOM_OLD:null}]};}
export function saveClassCollection(org,year,revision,entries){window.__classWrites++;const finish=()=>{window.__classes[org+year]=entries;return {revision:revision+1,entries};};if(window.__holdClassWrite)return new Promise(resolve=>window.__pendingClassWrites.push(()=>resolve(finish())));return Promise.resolve(finish());}
export function fetchRooms(scope){window.__roomReads++;const result={rooms:window.__loseReadbackRole?[]:structuredClone(window.__rooms[scope.userId]),canManage:scope.userId==='a'&&!window.__loseReadbackRole};
 if(window.__holdRoomRead)return new Promise(resolve=>window.__pendingRoomReads.push(()=>resolve(result)));
 if(window.__failRoomRead)return Promise.reject(Object.assign(Error('Synthetic read failure'),{status:window.__roomReadStatus}));
 return Promise.resolve(result);
}
export function saveRoom(scope,id,patch){window.__roomWrites++;const finish=()=>{
 if(window.__rejectRoomWrite)return Promise.reject(Object.assign(Error('Synthetic room validation'),{status:400}));
 patch={...patch,...(typeof patch.name==='string'?{name:patch.name.trim()}:{})};
 const list=window.__rooms[scope.userId];let room=list.find(r=>r.id===id);
 if(!room){room={id:`91000000-0000-4000-8000-${String(list.length+1).padStart(12,'0')}`,name:patch.name,isActive:true};list.push(room);}else Object.assign(room,patch);
 if(window.__uncertainWrite)return Promise.reject(Error('Synthetic uncertain write'));
 return Promise.resolve({...room});
 };if(window.__holdRoomWrite)return new Promise((resolve,reject)=>window.__pendingRoomWrites.push(()=>finish().then(resolve,reject)));return finish();
}

export function deleteRoom(scope,id){window.__roomWrites++;
 const finish=()=>{
  if(window.__sessionRooms.includes(id))return Promise.reject(Object.assign(Error('This room is assigned to a timetable lesson. Remove those assignments before deleting it; class defaults have not changed.'),{status:422}));
  const list=window.__rooms[scope.userId],index=list.findIndex(r=>r.id===id);
  if(index<0)return Promise.reject(Object.assign(Error('Room not found'),{status:404}));
  list.splice(index,1);
  for(const [key,entries] of Object.entries(window.__classes))if(key.startsWith(scope.userId))window.__classes[key]=entries.map(entry=>entry.defaultRoomId===id?{...entry,defaultRoomId:null}:entry);
  if(window.__loseRoleAfterDelete)window.__loseReadbackRole=true;
  if(window.__uncertainWrite)return Promise.reject(Error('Synthetic uncertain deletion'));
  return Promise.resolve(id);
 };if(window.__holdRoomWrite)return new Promise((resolve,reject)=>window.__pendingRoomWrites.push(()=>finish().then(resolve,reject)));return finish();
}
