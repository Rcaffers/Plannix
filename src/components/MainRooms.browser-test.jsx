import { useState, useSyncExternalStore, useLayoutEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { TimetableSessionProvider, useTimetableSessions } from '../context/TimetableSessionContext.jsx';
import ProjectCard from './ProjectCard.jsx';
import { serverManagedAuth,setServerSessionContext,invalidateServerSessionContext } from '../utils/serverAuthTransport.js';
import '../styles/base.css';
const id=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const ids={assigned:id(20),blank:id(21),user:id(1),other:id(2),org:id(3),year:id(4),table:id(5),week:id(6),p1:id(7),p2:id(8),active:id(9),archived:id(10),c1:id(11),c2:id(12),c3:id(13),collection:id(14),weekB:id(60),collectionB:id(61),p3:id(62),roomB:id(63)};
window.__ids=ids;window.__year=ids.year;window.__table=ids.table;window.__user=ids.user;window.__org=ids.org;window.__session=2;window.__roomLoads=0;window.__sessionReads=0;window.__writes=0;window.__applied=0;window.__heldReads=[];window.__heldWrites=[];window.__inputWeek='cycle-1';
const classes=[{id:ids.c1,name:'Maths',frequency:6,defaultRoomId:ids.active},{id:ids.c2,name:'Science',frequency:6,defaultRoomId:ids.archived},{id:ids.c3,name:'English literature and language extended class name',frequency:6}];
const catalogue=[{id:ids.active,name:'Room 12',isActive:true},{id:ids.archived,name:'Old room',isActive:false}];
const initial=()=>[{id:id(20),day:0,periodId:ids.p1,classId:ids.c1,title:'Existing assigned lesson',notes:'',roomId:ids.archived},{id:id(21),day:0,periodId:ids.p2,classId:ids.c2,title:'Existing blank lesson',notes:'',roomId:null}];
window.__longName='Room '+('Long laboratory name '.repeat(8)).trim();window.__overrides={};window.__heldDates=[];window.__heldCatalogues=[];window.__heldRestores=[];window.__store=[...initial(),{id:id(80),day:0,periodId:ids.p3,classId:ids.c3,title:'Long room lesson',notes:'',roomId:ids.active}];window.__storeB=[{id:id(70),day:0,periodId:ids.p1,classId:ids.c3,title:'Week B lesson',notes:'',roomId:null}];window.__revision=1;
const subscribe=fn=>{window.addEventListener('fixture-context',fn);return()=>window.removeEventListener('fixture-context',fn);};
export function useAcademicYear(){const selectedAcademicYearId=useSyncExternalStore(subscribe,()=>window.__year);const academicYear=useMemo(()=>({id:selectedAcademicYearId,startDate:'2026-09-01',endDate:'2027-08-31',holidays:[]}),[selectedAcademicYearId]);return {selectedAcademicYearId,academicYear,registerAcademicYearChangeGuard:()=>()=>{}};}
export function useClasses(){useSyncExternalStore(subscribe,()=>`${window.__user}:${window.__org}:${window.__year}:${window.__table}:${window.__session}`);return {authoritativeEntries:classes,isLoading:false,error:'',roomScope:{key:`${window.__user}:${window.__org}:${window.__year}:${window.__table}:${window.__session}`,userId:window.__user,organisationId:window.__org}};}
export function useTimetableLayout(){const timetableId=useSyncExternalStore(subscribe,()=>window.__table);return {timetableId,layout:{cycle:window.__twoWeek?'two-week':'one-week'},weeks:[{id:ids.week,code:'A'},...(window.__twoWeek?[{id:ids.weekB,code:'B'}]:[])],periods:[{id:ids.p1,type:'teaching',number:1},{id:ids.p2,type:'teaching',number:2},{id:ids.p3,type:'teaching',number:3}],dayLabels:['Mon','Tue','Wed','Thu','Fri'],rowSegments:[{kind:'lesson',rowIndex:0,timeLabel:'09:00',rangeLabel:'09:00–10:00'},{kind:'lesson',rowIndex:1,timeLabel:'10:00',rangeLabel:'10:00–11:00'},{kind:'lesson',rowIndex:2,timeLabel:'11:00',rangeLabel:'11:00–12:00'}]};}
export async function fetchRooms(){window.__roomLoads++;if(window.__failCatalogue)throw Error('Catalogue unavailable');const result={rooms:window.__user===ids.other?[{id:ids.roomB,name:'Other organisation room',isActive:true}]:catalogue.filter(r=>!window.__missingCatalogueRoom||r.id!==ids.archived).map(r=>({...r,name:r.id===ids.active?window.__longName:r.name})),canManage:false};if(window.__holdCatalogue){result.rooms=result.rooms.map(r=>({...r,name:'Stale catalogue name'}));return new Promise(resolve=>window.__heldCatalogues.push(()=>resolve(result)));}return result;}
window.__renameArchived=()=>{catalogue.find(r=>r.id===ids.archived).name='Renamed old room';};
export async function saveRoom(){throw Error('Room management must not be called');}
function response(includeRooms){const clean=items=>structuredClone(items).map(s=>{if(includeRooms)return s;const {roomId,...legacy}=s;return legacy;});return {revision:window.__revision,weeks:[{weekId:ids.week,code:'A',collectionId:ids.collection,sessions:clean(window.__store)},...(window.__twoWeek?[{weekId:ids.weekB,code:'B',collectionId:ids.collectionB,sessions:clean(window.__storeB)}]:[])],...(includeRooms?{roomAssignmentsLoaded:true}:{})};}
export function fetchRecurringTimetableSessions(scope){window.__sessionReads++;const snapshot=response(scope.includeRooms);if(scope.includeRooms&&window.__failRead)return Promise.reject(Error('Room assignment read failed'));if(scope.includeRooms&&window.__holdRead)return new Promise(resolve=>{snapshot.weeks.forEach(w=>w.sessions.forEach(s=>{s.title='Stale held-context lesson';}));window.__heldReads.push(()=>resolve(snapshot));});return Promise.resolve(snapshot);}
export function saveRecurringTimetableSessions(){throw Error('Main timetable must not write repeating placements directly');}
export function fetchDatedTimetableSessions(input){
 window.__dateReads=(window.__dateReads||0)+1;
 if(!window.__initialDate)window.__initialDate=input.weekStartDate;
 if(window.__failDate)return Promise.reject(Error('Room assignment read failed'));
 const override=window.__overrides[input.weekStartDate];
 const items=structuredClone(override || window.__store).map(s=>{if(window.__user===ids.other&&s.roomId)s.roomId=ids.roomB;if(!input.includeRooms)delete s.roomId;if(!override)delete s.id;return s;});
 const result={revision:window.__revision,weekStartDate:input.weekStartDate,repeatingWeekId:ids.week,source:override?'override':'recurring',overrideExists:!!override,collectionId:override?ids.collection:null,sessions:items,...(input.includeRooms?{roomAssignmentsLoaded:true}:{})};
 if(window.__holdDate)return new Promise(resolve=>window.__heldDates.push(()=>resolve(result)));return Promise.resolve(result);
}
window.__seedNextOverride=()=>{const d=new Date(window.__initialDate+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+7);window.__overrides[d.toISOString().slice(0,10)]=[{id:id(90),day:0,periodId:ids.p1,classId:ids.c1,title:'Dated override lesson',notes:'',roomId:ids.active}];};
export async function saveDatedTimetableSessions(input){window.__writes++;if(window.__rejectWrite)throw Object.assign(Error('Synthetic save failure'),{status:503});window.__revision++;const saved=structuredClone(input.sessions).map((s,i)=>({...s,id:s.id||id(100+i)}));window.__overrides[input.weekStartDate]=saved;return {revision:window.__revision,collectionId:ids.collection,repeatingWeekId:ids.week,sessions:saved,roomAssignmentsLoaded:!!input.includeRooms};}
export async function removeDatedTimetableOverride(input){window.__writes++;window.__revision++;delete window.__overrides[input.weekStartDate];const result=await fetchDatedTimetableSessions(input);if(window.__holdRestore)return new Promise(resolve=>window.__heldRestores.push(()=>resolve(result)));return result;}
export const saveTimetableSessionBatch=()=>{throw Error('No batch expected in this fixture');};
function SessionObserver(){const context=useTimetableSessions();useLayoutEffect(()=>{window.__sessionContext=context;});return null;}
function Fixture(){const [user,setUser]=useState(ids.user),[,rerender]=useState(0);
 const selectSession=userId=>{if(serverManagedAuth){invalidateServerSessionContext();setServerSessionContext('__Host-plannix-s-'+(++window.__session),'c'.repeat(43),userId);}};
 window.__setScope=(key,value)=>{window['__'+key]=value;rerender(n=>n+1);window.dispatchEvent(new Event('fixture-context'));};
 window.__replaceSession=()=>{selectSession(user);rerender(n=>n+1);window.dispatchEvent(new Event('plannix-server-session-change'));};
 window.__switchAccount=()=>{window.__user=ids.other;selectSession(ids.other);setUser(ids.other);window.dispatchEvent(new Event('fixture-context'));};
 if(serverManagedAuth){try{setServerSessionContext('__Host-plannix-s-'+window.__session,'c'.repeat(43),user);}catch{}}
 return <TimetableSessionProvider user={{id:user,organisationId:window.__org}}><SessionObserver /><ProjectCard project={{title:'Synthetic timetable'}} weekMode="date" enableEditing={false} showAssignedRooms /></TimetableSessionProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture />);

export async function deleteRoom(){throw Error('Room deletion must not be called by this fixture');}
