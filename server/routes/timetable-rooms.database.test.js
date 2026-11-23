// Explicit local-only integration: never reads .env or connects to a linked project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { registerRoomRoutes } from './room-routes.js';
import { createTimetableSessionApi } from '../../src/utils/timetableSessionApi.js';
import { registerTimetableSessionRoutes } from './timetable-session-routes.js';
import { registerClassRoutes } from './class-routes.js';
import { createRequireServerSession } from '../auth/requireServerSession.js';
import { createSessionRequestSecurity } from '../auth/sessionRequestSecurity.js';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { errorHandler } from '../middleware/errorHandler.js';
const container=process.env.PLANNIX_INPUT_ROOMS_TEST_CONTAINER;
const authMode=process.env.PLANNIX_INPUT_ROOMS_TEST_AUTH_MODE || 'bearer';
assert.ok(['bearer','server'].includes(authMode));
test(`room-aware placement API and RLS (${authMode}) on explicit disposable database`,{skip:!container},async t=>{
  const inspect=spawnSync('docker',['inspect',container],{encoding:'utf8'});assert.equal(inspect.status,0);
  const c=JSON.parse(inspect.stdout)[0];assert.equal(c.Config.Labels?.['plannix.rooms.test'],'true');assert.equal(c.HostConfig.NetworkMode,'none');assert.ok(!c.HostConfig.PortBindings || Object.keys(c.HostConfig.PortBindings).length===0);
  const org='11000000-0000-4000-8000-000000000001', otherOrg='11000000-0000-4000-8000-000000000002',year='21000000-0000-4000-8000-000000000001';
  const classId='41000000-0000-4000-8000-000000000001', room1='91000000-0000-4000-8000-000000000001', room2='91000000-0000-4000-8000-000000000002';
  const owner=n=>`01000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  function sql(s){return spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input:s,encoding:'utf8'});}
  const seed=readFileSync(new URL('../../supabase/tests/rooms_foundation.test.sql',import.meta.url),'utf8').split('select extensions.ok((select relrowsecurity')[0].replace(/select extensions.plan\(\d+\);/,'');
  const seeded=sql(seed+`insert into public.plannix_rooms(id,organisation_id,name) values('${room1}','${org}','Lab'),('${room2}','${org}','Retained room');update public.plannix_classes set default_room_id='${room2}' where id='${classId}';select * from pg_temp.call_batch('${owner(1)}',0,'[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"${classId}","title":"Synthetic lesson","notes":""}]}]');update public.plannix_rooms set is_active=false where id='${room2}';COMMIT;`);assert.equal(seeded.status,0,'Synthetic fixture preparation failed');
  const literal=v=>v===null?'null':`'${String(v).replaceAll("'","''")}'`;
  let assignmentFailure=false;
  function client(userId){return {
    from(table){
      assert.ok(['plannix_rooms','plannix_organisation_users','plannix_organisation_user_access_roles','plannix_access_roles','plannix_academic_years'].includes(table));
      const filters=[];let action=null,values=null,single=false,limit='',order='';
      const q={select(){return q;},eq(k,v){assert.match(k,/^[a-z_]+$/);filters.push(`${k}=${literal(v)}`);return q;},in(k,vs){assert.match(k,/^[a-z_]+$/);filters.push(`${k} in (${vs.map(literal).join(',')})`);return q;},order(k,opts){if(!opts?.referencedTable){assert.match(k,/^[a-z_]+$/);order=` order by ${k}`;}return q;},range(a,b){assert.ok(Number.isInteger(a)&&Number.isInteger(b));limit=` limit ${b-a+1} offset ${a}`;return q;},insert(v){action='insert';values=v;return q;},update(v){action='update';values=v;return q;},maybeSingle(){single=true;return q;},
      then(resolve,reject){
        const where=filters.length?' where '+filters.join(' and '):'';
        let statement;
        if(action==='insert')statement=`insert into public.${table} (${Object.keys(values).join(',')}) values (${Object.values(values).map(literal).join(',')}) returning *`;
        else if(action==='update')statement=`update public.${table} set ${Object.entries(values).map(([k,v])=>`${k}=${literal(v)}`).join(',')}${where} returning *`;
        else if(table==='plannix_academic_years')statement=`select id,classes_revision,(select coalesce(json_agg(c order by c.sort_order,c.id),'[]') from public.plannix_classes c where c.academic_year_id=plannix_academic_years.id) classes from public.${table}${where}`;
        else statement=`select * from public.${table}${where}${order}${limit}`;
        const wrapped=action?`with rows as (${statement}) select coalesce(json_agg(rows),'[]') from rows`:`select coalesce(json_agg(rows),'[]') from (${statement}) rows`;
        const r=sql(`BEGIN;set local request.jwt.claim.sub=${literal(userId)};set local role authenticated;${wrapped};COMMIT;`);
        const data=r.status===0?JSON.parse(r.stdout):null;
        return Promise.resolve(r.status===0?{data:single?data[0]??null:data,error:null}:{data:null,error:{code:r.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'XX000',message:r.stderr.match(/ERROR:\s+[A-Z0-9]{5}:\s*([^\n]+)/)?.[1]}}).then(resolve,reject);
      }};return q;
    },
    rpc(name,input){
      const work=async()=>{
      if(assignmentFailure && name==='plannix_get_timetable_room_assignments')return {error:{status:503}};
      const signatures={
        plannix_get_recurring_timetable_sessions:[['target_organisation_id','uuid'],['target_academic_year_id','uuid'],['target_timetable_id','uuid']],
        plannix_get_timetable_room_assignments:[['target_organisation_id','uuid'],['target_academic_year_id','uuid'],['target_timetable_id','uuid']],
        plannix_save_recurring_timetable_sessions:[['target_organisation_id','uuid'],['target_academic_year_id','uuid'],['target_timetable_id','uuid'],['target_week_id','uuid'],['expected_revision','bigint'],['target_sessions','jsonb']],
        plannix_apply_timetable_session_batch:[['target_organisation_id','uuid'],['target_academic_year_id','uuid'],['target_timetable_id','uuid'],['expected_revision','bigint'],['target_mutations','jsonb']],
        plannix_get_dated_timetable_sessions:[['target_organisation_id','uuid'],['target_academic_year_id','uuid'],['target_timetable_id','uuid'],['target_week_start_date','date']],
        plannix_save_dated_timetable_sessions:[['target_organisation_id','uuid'],['target_academic_year_id','uuid'],['target_timetable_id','uuid'],['target_week_start_date','date'],['expected_revision','bigint'],['target_sessions','jsonb']],
      };
      assert.ok(signatures[name]);
      const args=signatures[name].map(([key,type])=>literal(type==='jsonb'?JSON.stringify(input[key]):input[key])+'::'+type);
      const r=sql(`BEGIN;set local request.jwt.claim.sub=${literal(userId)};set local role authenticated;select coalesce(json_agg(r),'[]') from public.${name}(${args.join(',')}) r;COMMIT;`);
      return r.status===0?{data:JSON.parse(r.stdout),error:null}:{error:{code:r.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'XX000',message:r.stderr.match(/ERROR:\s+[A-Z0-9]{5}:\s*([^\n]+)/)?.[1]}};
      };
      return {then:(resolve,reject)=>work().then(resolve,reject),range:(from,to)=>work().then(result=>({...result,...(Array.isArray(result.data)?{data:result.data.slice(from,to+1),count:result.data.length}:{})}))};
    }
  };}
  const bearerGuard=createRequireSupabaseAuth({getClient:()=>({auth:{getUser:async token=>({data:{user:{id:owner(Number(token.split('.').at(-1))),email_confirmed_at:'2026-01-01T00:00:00Z'}},error:null})}})});
  let cookieGuard;
  const requireAuth=(req,res,next)=>{
    if(authMode==='bearer')return bearerGuard(req,res,next);
    if(req.headers.authorization)return res.status(401).json({message:'Authentication is required.'});
    return cookieGuard(req,res,error=>{if(error)return next(error);req.auth={userId:req.serverSession.userId,accessToken:req.serverSession.accessToken};next();});
  };
  const app=express();app.use(express.json());registerRoomRoutes({app,requireAuth,createRequestClient:auth=>client(auth.userId)});registerClassRoutes({app,requireAuth,createRequestClient:auth=>client(auth.userId)});registerTimetableSessionRoutes({app,requireAuth,createRequestClient:auth=>client(auth.userId)});app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`,csrfKey=Buffer.alloc(32,7);
  const cookie=n=>`__Host-plannix-b-1=${'a'.repeat(43)}; __Host-plannix-s-${n+10}=${'b'.repeat(43)}`;
  const security=createSessionRequestSecurity({origin,csrfKey});let sessionState='current';let providerAvailable=true;
  cookieGuard=createRequireServerSession({origin,csrfKey,repository:{async resolveForApplication(header){
    const n=Number(header.match(/__Host-plannix-s-([0-9]+)=/)?.[1])-10;
    if(!Number.isInteger(n)||n<1||n>5)return {state:'invalid'};
    return {state:sessionState,header,sessionName:`__Host-plannix-s-${n+10}`,ownerId:owner(n),sessionId:'synthetic-session',tokenVersion:1,accessToken:`synthetic.${n}`};
  }},identity:{async validateAccess({accessToken,expectedUserId}){assert.equal(expectedUserId,owner(Number(accessToken.split('.').at(-1))));if(!providerAvailable)throw Error('Synthetic provider unavailable');}}});
  const headers=n=>authMode==='bearer'?{Authorization:`Bearer synthetic.${n}`}:{Cookie:cookie(n),Origin:origin,'X-Plannix-Expected-Session':`__Host-plannix-s-${n+10}`,'X-Plannix-CSRF':security.csrfFor(cookie(n))};
  const request=(path,{n=1,method='GET',body,override={}}={})=>fetch(origin+path,{method,headers:{...headers(n),'Content-Type':'application/json',...override},...(body?{body:JSON.stringify(body)}:{})});

  const timetableId='31000000-0000-4000-8000-000000000001',weekId='32000000-0000-4000-8000-000000000001',periodId='33000000-0000-4000-8000-000000000001',period2='33000000-0000-4000-8000-000000000002';
  const query=`organisationId=${org}&academicYearId=${year}&timetableId=${timetableId}`;
  const path='/api/timetable/sessions/recurring';
  const load=async(n=1)=>{const r=await request(path+'?'+query+'&includeRooms=true',{n});assert.equal(r.status,200);return r.json();};
  let data=await load();assert.equal(data.roomAssignmentsLoaded,true);assert.equal(data.weeks[0].sessions[0].roomId,room2);
  const legacy=await (await request(path+'?'+query)).json();assert.equal(Object.hasOwn(legacy.weeks[0].sessions[0],'roomId'),false);
  for(const n of [2,3,4])assert.equal((await request(path+'?'+query+'&includeRooms=true',{n})).status,200);
  assert.ok([403,404].includes((await request(path+'?'+query+'&includeRooms=true',{n:5})).status));
  const put=(sessions,revision=data.revision,n=1)=>request(path,{n,method:'PUT',body:{organisationId:org,academicYearId:year,timetableId,weekId,expectedRevision:revision,includeRooms:true,sessions}});
  for(const n of [2,3,4])assert.equal((await put(data.weeks[0].sessions,data.revision,n)).status,403);
  // Unrelated save retains the existing archived assignment; a class default change never rewrites it.
  assert.equal(sql(`update public.plannix_classes set default_room_id='${room1}' where id='${classId}';`).status,0);
  let r=await put(data.weeks[0].sessions.map(s=>({...s,title:'Updated title'})));assert.equal(r.status,200);let saved=await r.json();assert.equal(saved.sessions[0].roomId,room2);data=await load();
  const current=data.weeks[0].sessions;
  const second={day:1,periodId,classId,title:'',notes:''}; // old caller omits room: DB uses active default.
  r=await put([...current,second]);assert.equal(r.status,200);saved=await r.json();assert.equal(saved.sessions.find(s=>s.day===1).roomId,room1);data=await load();
  // Clearing is explicit; later default changes and unrelated full-collection saves retain null.
  r=await put(data.weeks[0].sessions.map(s=>s.day===1?{...s,roomId:null}:s));assert.equal(r.status,200);saved=await r.json();data=await load();assert.equal(data.weeks[0].sessions.find(s=>s.day===1).roomId,null);
  // Swap IDs and rooms together, including retained archived room and explicit no-room.
  r=await put(data.weeks[0].sessions.map(s=>({...s,day:s.day===0?1:0})));assert.equal(r.status,200);saved=await r.json();assert.equal(saved.sessions.find(s=>s.day===1).roomId,room2);assert.equal(saved.sessions.find(s=>s.day===0).roomId,null);data=await load();
  // Dated inheritance reads the exact repeating room/null; materialisation preserves both.
  const datePath='/api/timetable/sessions/date?'+query+'&weekStartDate=2027-02-15&includeRooms=true';
  const inherited=await (await request(datePath)).json();assert.equal(inherited.source,'recurring');assert.equal(inherited.sessions.find(s=>s.day===1).roomId,room2);assert.equal(inherited.sessions.find(s=>s.day===0).roomId,null);
  r=await request('/api/timetable/sessions/date',{method:'PUT',body:{organisationId:org,academicYearId:year,timetableId,weekStartDate:'2027-02-15',expectedRevision:inherited.revision,includeRooms:true,sessions:inherited.sessions}});assert.equal(r.status,200);const dated=await r.json();assert.equal(dated.sessions.find(s=>s.day===1).roomId,room2);assert.equal(dated.sessions.find(s=>s.day===0).roomId,null);data=await load();
  // Supported text-copy batch keeps destination locations and materialises exact repeating rooms.
  const otherDate=await (await request('/api/timetable/sessions/date?'+query+'&weekStartDate=2027-02-01&includeRooms=true')).json();
  assert.equal(otherDate.sessions.length,2,'copy target inherits the same repeating week');
  const textOnly=items=>items.map(({roomId,...entry})=>({...entry,title:'Copied details',notes:'Synthetic copy'}));
  r=await request('/api/timetable/sessions/batch',{method:'PUT',body:{organisationId:org,academicYearId:year,timetableId,expectedRevision:data.revision,includeRooms:true,mutations:[{type:'date_override',weekStartDate:'2027-02-15',sessions:textOnly(dated.sessions)},{type:'date_override',weekStartDate:'2027-02-01',sessions:textOnly(otherDate.sessions)}]}});assert.equal(r.status,200);
  const batch=await r.json();for(const c of batch.collections){assert.equal(c.sessions.find(s=>s.day===0).roomId,null);assert.equal(c.sessions.find(s=>s.day===1).roomId,room2);}data=await load();
  // New archived assignments are rejected; explicit null allows an archived-default new class placement.
  r=await put([...data.weeks[0].sessions,{day:2,periodId:period2,classId:'41000000-0000-4000-8000-000000000002',title:'',notes:'',roomId:room2}]);assert.equal(r.status,422);
  // Failed assignment reads are errors; a committed write followed by failed readback remains uncertain.
  assignmentFailure=true;assert.equal((await request(path+'?'+query+'&includeRooms=true')).status,503);
  const before=data.revision;r=await put(data.weeks[0].sessions.map(s=>({...s,title:'Committed before failed room read'})),before);assert.equal(r.status,503);
  assignmentFailure=false;const after=await load();assert.equal(after.revision,before+1);assert.equal(after.weeks[0].sessions.length,2);assert.equal((await put(data.weeks[0].sessions,before)).status,409);
  if(authMode==='bearer'){
    const api=createTimetableSessionApi({getSession:async()=>({access_token:'synthetic.1'}),fetchImpl:(p,o)=>fetch(origin+p,o)});
    const result=await api.loadRecurring({organisationId:org,academicYearId:year,timetableId,includeRooms:true});assert.equal(result.weeks[0].sessions.find(s=>s.day===0).roomId,null);
  }
});
