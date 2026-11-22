import { useSyncExternalStore } from 'react';
export const ROOM_A='91000000-0000-4000-8000-000000000001', ROOM_OLD='91000000-0000-4000-8000-000000000002';
window.__roomWrites=0;window.__roomReads=0;window.__classWrites=0;window.__year='year-1';window.__pendingRoomReads=[];window.__pendingRoomWrites=[];window.__pendingClassWrites=[];
window.__rooms={a:[{id:ROOM_A,name:'Room 12',isActive:true},{id:ROOM_OLD,name:'Old room',isActive:false}],b:[{id:ROOM_A,name:'Other account room',isActive:true}]};
window.__classes={};
const subscribe=fn=>{window.addEventListener('fixture-year',fn);return()=>window.removeEventListener('fixture-year',fn);};
export function useAcademicYear(){const selectedAcademicYearId=useSyncExternalStore(subscribe,()=>window.__year);return {selectedAcademicYearId,registerAcademicYearChangeGuard:()=>()=>{}};}
export function useTimetableLayout(){return {layout:{cycle:'one-week'}};}
export async function fetchClassCollection(org,year){return {revision:1,entries:window.__classes[org+year] || [{id:'ca000000-0000-4000-8000-000000000001',name:org==='a'?'Maths '+year:'Other account class',frequency:2,defaultRoomId:org==='a'?ROOM_OLD:null}]};}
export function saveClassCollection(org,year,revision,entries){window.__classWrites++;const finish=()=>{window.__classes[org+year]=entries;return {revision:revision+1,entries};};if(window.__holdClassWrite)return new Promise(resolve=>window.__pendingClassWrites.push(()=>resolve(finish())));return Promise.resolve(finish());}
export function fetchRooms(scope){window.__roomReads++;const result={rooms:structuredClone(window.__rooms[scope.userId]),canManage:scope.userId==='a'};
 if(window.__holdRoomRead)return new Promise(resolve=>window.__pendingRoomReads.push(()=>resolve(result)));
 if(window.__failRoomRead)return Promise.reject(Object.assign(Error('Synthetic read failure'),{status:window.__roomReadStatus}));
 return Promise.resolve(result);
}
export function saveRoom(scope,id,patch){window.__roomWrites++;const finish=()=>{
 patch={...patch,...(typeof patch.name==='string'?{name:patch.name.trim()}:{})};
 const list=window.__rooms[scope.userId];let room=list.find(r=>r.id===id);
 if(!room){room={id:`91000000-0000-4000-8000-${String(list.length+1).padStart(12,'0')}`,name:patch.name,isActive:true};list.push(room);}else Object.assign(room,patch);
 if(window.__uncertainWrite)return Promise.reject(Error('Synthetic uncertain write'));
 return Promise.resolve({...room});
 };if(window.__holdRoomWrite)return new Promise((resolve,reject)=>window.__pendingRoomWrites.push(()=>finish().then(resolve,reject)));return finish();
}
