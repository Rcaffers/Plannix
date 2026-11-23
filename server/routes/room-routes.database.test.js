// Explicit local-only integration: never reads .env or connects to a linked project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { registerRoomRoutes } from './room-routes.js';
import { createClassApi } from '../../src/utils/api.js';
import { registerClassRoutes } from './class-routes.js';
import { createRequireServerSession } from '../auth/requireServerSession.js';
import { createSessionRequestSecurity } from '../auth/sessionRequestSecurity.js';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { errorHandler } from '../middleware/errorHandler.js';
const container=process.env.PLANNIX_ROOMS_TEST_CONTAINER;
const authMode=process.env.PLANNIX_ROOMS_TEST_AUTH_MODE || 'bearer';
assert.ok(['bearer','server'].includes(authMode));
test(`real RLS room API and class-default compatibility (${authMode}) on explicit disposable database`,{skip:!container},async t=>{
  const inspect=spawnSync('docker',['inspect',container],{encoding:'utf8'});assert.equal(inspect.status,0);
  const c=JSON.parse(inspect.stdout)[0];assert.equal(c.Config.Labels?.['plannix.rooms.test'],'true');assert.equal(c.HostConfig.NetworkMode,'none');assert.ok(!c.HostConfig.PortBindings || Object.keys(c.HostConfig.PortBindings).length===0);
  const org='11000000-0000-4000-8000-000000000001', otherOrg='11000000-0000-4000-8000-000000000002',year='21000000-0000-4000-8000-000000000001';
  const classId='41000000-0000-4000-8000-000000000001', room1='91000000-0000-4000-8000-000000000001', room2='91000000-0000-4000-8000-000000000002';
  const owner=n=>`01000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  function sql(s){return spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input:s,encoding:'utf8'});}
  const seed=readFileSync(new URL('../../supabase/tests/rooms_foundation.test.sql',import.meta.url),'utf8').split('select extensions.ok((select relrowsecurity')[0].replace(/select extensions.plan\(\d+\);/,'');
  const seeded=sql(seed+`insert into public.plannix_rooms(id,organisation_id,name) values('${room1}','${org}','Lab'),('${room2}','${org}','Retained room');update public.plannix_classes set default_room_id='${room2}' where id='${classId}';select * from pg_temp.call_batch('${owner(1)}',0,'[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"${classId}","title":"Synthetic lesson","notes":""}]}]');update public.plannix_rooms set is_active=false where id='${room2}';COMMIT;`);assert.equal(seeded.status,0,'Synthetic fixture preparation failed');
  const literal=v=>v===null?'null':`'${String(v).replaceAll("'","''")}'`;
  function client(userId){return {
    from(table){
      assert.ok(['plannix_rooms','plannix_organisation_users','plannix_organisation_user_access_roles','plannix_access_roles','plannix_academic_years'].includes(table));
      const filters=[];let action=null,values=null,single=false,limit='',order='';
      const q={select(){return q;},eq(k,v){assert.match(k,/^[a-z_]+$/);filters.push(`${k}=${literal(v)}`);return q;},in(k,vs){assert.match(k,/^[a-z_]+$/);filters.push(`${k} in (${vs.map(literal).join(',')})`);return q;},order(k,opts){if(!opts?.referencedTable){assert.match(k,/^[a-z_]+$/);order=` order by ${k}`;}return q;},range(a,b){assert.ok(Number.isInteger(a)&&Number.isInteger(b));limit=` limit ${b-a+1} offset ${a}`;return q;},insert(v){action='insert';values=v;return q;},update(v){action='update';values=v;return q;},delete(){action='delete';return q;},maybeSingle(){single=true;return q;},
      then(resolve,reject){
        const where=filters.length?' where '+filters.join(' and '):'';
        let statement;
        if(action==='insert')statement=`insert into public.${table} (${Object.keys(values).join(',')}) values (${Object.values(values).map(literal).join(',')}) returning *`;
        else if(action==='delete')statement=`delete from public.${table}${where} returning *`;
        else if(action==='update')statement=`update public.${table} set ${Object.entries(values).map(([k,v])=>`${k}=${literal(v)}`).join(',')}${where} returning *`;
        else if(table==='plannix_academic_years')statement=`select id,classes_revision,(select coalesce(json_agg(c order by c.sort_order,c.id),'[]') from public.plannix_classes c where c.academic_year_id=plannix_academic_years.id) classes from public.${table}${where}`;
        else statement=`select * from public.${table}${where}${order}${limit}`;
        const wrapped=action?`with rows as (${statement}) select coalesce(json_agg(rows),'[]') from rows`:`select coalesce(json_agg(rows),'[]') from (${statement}) rows`;
        const r=sql(`BEGIN;set local request.jwt.claim.sub=${literal(userId)};set local role authenticated;${wrapped};COMMIT;`);
        const data=r.status===0?JSON.parse(r.stdout):null;
        return Promise.resolve(r.status===0?{data:single?data[0]??null:data,error:null}:{data:null,error:{code:r.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'XX000',message:r.stderr.match(/ERROR:\s+[A-Z0-9]{5}:\s*([^\n]+)/)?.[1]}}).then(resolve,reject);
      }};return q;
    },
    async rpc(name,input){assert.ok(['plannix_save_classes','plannix_delete_room'].includes(name));const statement=name==='plannix_delete_room'?`select to_json(public.plannix_delete_room(${literal(input.target_organisation_id)}::uuid,${literal(input.target_room_id)}::uuid))`:`select json_agg(r) from public.plannix_save_classes(${literal(input.target_organisation_id)}::uuid,${literal(input.target_academic_year_id)}::uuid,${input.expected_revision},${literal(JSON.stringify(input.target_classes))}::jsonb) r`;const r=sql(`BEGIN;set local request.jwt.claim.sub=${literal(userId)};set local role authenticated;${statement};COMMIT;`);return r.status===0?{data:JSON.parse(r.stdout),error:null}:{error:{code:r.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]||'XX000',message:r.stderr.match(/ERROR:\s+[A-Z0-9]{5}:\s*([^\n]+)/)?.[1]}};}
  };}
  const bearerGuard=createRequireSupabaseAuth({getClient:()=>({auth:{getUser:async token=>({data:{user:{id:owner(Number(token.split('.').at(-1))),email_confirmed_at:'2026-01-01T00:00:00Z'}},error:null})}})});
  let cookieGuard;
  const requireAuth=(req,res,next)=>{
    if(authMode==='bearer')return bearerGuard(req,res,next);
    if(req.headers.authorization)return res.status(401).json({message:'Authentication is required.'});
    return cookieGuard(req,res,error=>{if(error)return next(error);req.auth={userId:req.serverSession.userId,accessToken:req.serverSession.accessToken};next();});
  };
  const app=express();app.use(express.json());registerRoomRoutes({app,requireAuth,createRequestClient:auth=>client(auth.userId)});registerClassRoutes({app,requireAuth,createRequestClient:auth=>client(auth.userId)});app.use(errorHandler);
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

  const path=`/api/rooms?organisationId=${org}`;
  if(authMode==='server'){
    for(const override of [{'X-Plannix-CSRF':'invalid'},{'X-Plannix-Expected-Session':'__Host-plannix-s-99'},{Origin:'https://other.invalid'},{Authorization:'Bearer synthetic.1'}]){
      const rejected=await request(path,{method:'POST',body:{name:'Guard must reject'},override});assert.ok([401,403,409].includes(rejected.status));
    }
    for(const state of ['expired','wrong-kind','invalid']){sessionState=state;assert.equal((await request(path)).status,401);}
    sessionState='current';providerAvailable=false;assert.equal((await request(path)).status,503);providerAvailable=true;
  }

  for(const n of [1,2,3,4]){const r=await request(path,{n});assert.equal(r.status,200);const result=await r.json();assert.equal(result.canManage,n===1);if(n===4)assert.deepEqual(result.rooms.map(r=>r.id),[room2]);}
  for(const n of [2,3,4,5])assert.equal((await request(path,{n,method:'POST',body:{name:'Forbidden'}})).status,403);
  assert.equal((await request(`/api/rooms?organisationId=${otherOrg}`)).status,403);
  const add=await request(path,{method:'POST',body:{name:'New room'}});assert.equal(add.status,201);const added=(await add.json()).room;
  for(const patch of [{name:'Renamed room'},{isActive:false},{isActive:true}])assert.equal((await request(`/api/rooms/${added.id}?organisationId=${org}`,{method:'PATCH',body:patch})).status,200);
  assert.equal((await request(`/api/rooms/${added.id}?organisationId=${otherOrg}`,{n:5,method:'PATCH',body:{name:'Wrong org'}})).status,404);
  const classPath=`/api/classes?organisationId=${org}&academicYearId=${year}`;
  let classes=await (await request(classPath)).json();assert.equal(classes.entries[0].defaultRoomId,room2);
  const sessionBefore=sql('select json_agg(json_build_array(id,room_id)) from public.plannix_timetable_sessions;').stdout;
  async function save(entries){return request('/api/classes',{method:'PUT',body:{organisationId:org,academicYearId:year,expectedRevision:classes.revision,entries}});}
  // Retain an archived reference, including through a legacy client omitting room fields.
  let r=await save(classes.entries.map(({defaultRoomId,...entry})=>entry));assert.equal(r.status,200);classes=await r.json();assert.equal(classes.entries[0].defaultRoomId,room2);
  r=await save(classes.entries.map(e=>e.id===classId?{...e,name:'Renamed class'}:e));assert.equal(r.status,200);classes=await r.json();
  r=await save(classes.entries.map(e=>e.id===classId?{...e,defaultRoomId:room1}:e));assert.equal(r.status,200);classes=await r.json();assert.equal(classes.entries[0].defaultRoomId,room1);
  assert.equal(sql('select json_agg(json_build_array(id,room_id)) from public.plannix_timetable_sessions;').stdout,sessionBefore,'Changing class default must not rewrite lessons');
  r=await save(classes.entries.map(e=>e.id===classId?{...e,defaultRoomId:room2}:e));assert.equal(r.status,422);
  r=await save(classes.entries.map(e=>e.id===classId?{...e,defaultRoomId:null}:e));assert.equal(r.status,200);classes=await r.json();assert.ok(classes.entries[0].defaultRoomId==null);
  // Foreign organisation room is rejected by the real database, not only UI filtering.
  const other=await request(`/api/rooms?organisationId=${otherOrg}`,{n:5,method:'POST',body:{name:'Foreign room'}});assert.equal(other.status,201);const foreign=(await other.json()).room;
  r=await save(classes.entries.map(e=>e.id===classId?{...e,defaultRoomId:foreign.id}:e));assert.equal(r.status,422);
  r=await save([...classes.entries,{name:'New class default',frequency:1,defaultRoomId:room1}]);assert.equal(r.status,200);classes=await r.json();
  const reloaded=await (await request(classPath)).json();assert.equal(reloaded.entries.find(e=>e.name==='New class default').defaultRoomId,room1);
  assert.equal(sql('select json_agg(json_build_array(id,room_id)) from public.plannix_timetable_sessions;').stdout,sessionBefore);
  if(authMode==='server'){
    const mismatch=await request(`/api/rooms/${added.id}?organisationId=${org}`,{method:'DELETE',override:{'X-Plannix-Expected-Session':'__Host-plannix-s-99'}});
    assert.equal(mismatch.status,409,'genuine session mismatch is not converted to room validation');
    const intact=await (await request(path)).json();assert.ok(intact.rooms.some(room=>room.id===added.id),'mismatched request cannot delete the room');
  }
  for(const n of [2,3,4,5])assert.equal((await request(`/api/rooms/${added.id}?organisationId=${org}`,{n,method:'DELETE'})).status,403);
  for(const id of [room2]){const denied=await request(`/api/rooms/${id}?organisationId=${org}`,{method:'DELETE'});assert.equal(denied.status,422);assert.match((await denied.json()).message,/Remove those assignments/);}
  assert.equal(sql('select json_agg(json_build_array(id,room_id)) from public.plannix_timetable_sessions;').stdout,sessionBefore,'rejected deletion never clears lessons');
  assert.equal((await request(`/api/rooms/${foreign.id}?organisationId=${org}`,{method:'DELETE'})).status,404,'foreign room cannot be deleted through another organisation scope');
  let deleted=await request(`/api/rooms/${added.id}?organisationId=${org}`,{method:'DELETE'});assert.equal(deleted.status,200);assert.deepEqual(await deleted.json(),{deletedRoomId:added.id});
  assert.equal((await request(`/api/rooms/${added.id}?organisationId=${org}`,{method:'DELETE'})).status,404);
  const unused=await (await request(`/api/rooms?organisationId=${org}`,{method:'POST',body:{name:'Archived unused room'}})).json();
  assert.equal((await request(`/api/rooms/${unused.room.id}?organisationId=${org}`,{method:'PATCH',body:{isActive:false}})).status,200);
  assert.equal((await request(`/api/rooms/${unused.room.id}?organisationId=${org}`,{method:'PATCH',body:{name:'Renamed archived unused room'}})).status,200);
  const archivedReload=await (await request(`/api/rooms?organisationId=${org}`)).json();assert.equal(archivedReload.rooms.find(r=>r.id===unused.room.id).isActive,false);
  assert.equal((await request(`/api/rooms/${unused.room.id}?organisationId=${org}`,{method:'DELETE'})).status,200);
  const defaultsDeleted=await request(`/api/rooms/${room1}?organisationId=${org}`,{method:'DELETE'});assert.equal(defaultsDeleted.status,200);
  const cleared=await (await request(classPath)).json();assert.equal(cleared.entries.find(e=>e.name==='New class default').defaultRoomId,null);assert.ok(cleared.revision>classes.revision);
  assert.equal(sql('select json_agg(json_build_array(id,room_id)) from public.plannix_timetable_sessions;').stdout,sessionBefore);
  if(authMode==='bearer'){
  const classApi=createClassApi({getSession:async()=>({access_token:'synthetic.1'}),fetchImpl:(path,options)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,options)});
  const clientLoaded=await classApi.load(org,year);assert.equal(clientLoaded.entries.find(e=>e.name==='New class default').defaultRoomId,null);
  const clientSaved=await classApi.save(org,year,clientLoaded.revision,clientLoaded.entries);assert.equal(clientSaved.entries.find(e=>e.name==='New class default').defaultRoomId,undefined);
  assert.equal(sql('select json_agg(json_build_array(id,room_id)) from public.plannix_timetable_sessions;').stdout,sessionBefore);
  }
});
