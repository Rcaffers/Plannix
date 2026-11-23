// Opt-in, network-isolated disposable database only. No environment-file loading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
const container=process.env.PLANNIX_ROOMS_TEST_CONTAINER;
test('room deletion serializes concurrent default/session assignments in both orders',{skip:!container},async t=>{
  const info=JSON.parse(spawnSync('docker',['inspect',container],{encoding:'utf8'}).stdout)[0];
  assert.equal(info.Config.Labels?.['plannix.rooms.test'],'true');assert.equal(info.HostConfig.NetworkMode,'none');
  const base=['exec','-i',container,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
  const sql=s=>{const r=spawnSync('docker',base,{input:s,encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  const org='11000000-0000-4000-8000-000000000001',user='01000000-0000-4000-8000-000000000001',classId='41000000-0000-4000-8000-000000000001';
  const auth=`set local request.jwt.claim.sub='${user}';set local role authenticated;`;
  const seed=readFileSync(new URL('../../supabase/tests/rooms_foundation.test.sql',import.meta.url),'utf8').split('select extensions.ok((select relrowsecurity')[0].replace(/select extensions.plan\(\d+\);/,'');
  sql(seed+`select * from pg_temp.call_batch('${user}',0,'[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"${classId}","title":"Synthetic","notes":"","roomId":null}]}]');COMMIT;`);
  t.after(()=>sql(`begin;delete from public.plannix_organisations where id in('${org}','11000000-0000-4000-8000-000000000002');delete from auth.users where id::text like '01000000-0000-4000-8000-%';commit;`));
  const children=[];t.after(()=>{for(const c of children)c.kill();});
  async function connection(label,statement){
    const child=spawn('docker',base,{stdio:['pipe','pipe','pipe']});children.push(child);let out='',err='';
    child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
    const done=new Promise(resolve=>child.on('close',code=>resolve({code,out,err})));
    child.stdin.write(`set application_name='${label}';begin;${auth}${statement}\n\\echo completed\n`);
    const wait=async predicate=>{const deadline=Date.now()+6000;while(!predicate()){assert.equal(child.exitCode,null,err);assert.ok(Date.now()<deadline,'explicit SQL completion barrier timed out');await new Promise(r=>setTimeout(r,20));}};
    return {child,done,completed:()=>wait(()=>out.includes('completed')),finish:()=>{child.stdin.end('commit;\n');return done;}};
  }
  async function blocked(label){const deadline=Date.now()+6000;while(sql(`select count(*) from pg_stat_activity where application_name='${label}' and wait_event_type='Lock'`) !== '1'){assert.ok(Date.now()<deadline,'expected database lock wait: '+label);await new Promise(r=>setTimeout(r,20));}}
  for(const kind of ['default','session','session-insert'])for(const first of ['assignment','deletion']){
    const room=sql(`insert into public.plannix_rooms(organisation_id,name) values('${org}','${kind}-${first}') returning id`);
    const assign=kind==='default'?`update public.plannix_classes set default_room_id='${room}' where id='${classId}';`:kind==='session'?`update public.plannix_timetable_sessions set room_id='${room}';`:`insert into public.plannix_timetable_sessions(organisation_id,academic_year_id,timetable_id,collection_id,timetable_week_id,day_number,period_id,class_id,title,notes,room_id) select organisation_id,academic_year_id,timetable_id,collection_id,timetable_week_id,2,period_id,class_id,title,notes,'${room}' from public.plannix_timetable_sessions order by day_number,id limit 1;`;
    const remove=`select public.plannix_delete_room('${org}','${room}');`;
    const holder=await connection(`room-delete-holder-${kind}-${first}`,first==='assignment'?assign:remove);await holder.completed();
    const label=`room-delete-waiter-${kind}-${first}`;
    const waiter=await connection(label,first==='assignment'?remove:assign);await blocked(label);
    assert.equal((await holder.finish()).code,0);
    if(first==='assignment'&&kind==='default') {await waiter.completed();assert.equal((await waiter.finish()).code,0);}
    else {waiter.child.stdin.end();const result=await waiter.done;assert.notEqual(result.code,0);assert.match(result.err,/23503/);}
    if(first==='assignment'&&kind!=='default'){
      assert.equal(sql(`select count(*) from public.plannix_rooms where id='${room}'`),'1');
      assert.equal(sql(`select count(*) from public.plannix_timetable_sessions where room_id='${room}'`),'1');
      sql('update public.plannix_timetable_sessions set room_id=null;');if(kind==='session-insert')sql('delete from public.plannix_timetable_sessions where day_number=2;');sql(`begin;${auth}${remove}commit;`);
    }else assert.equal(sql(`select count(*) from public.plannix_rooms where id='${room}'`),'0');
    assert.equal(sql('select count(*) from public.plannix_classes where default_room_id is not null'),'0');
  }
  const timedRoom=sql(`insert into public.plannix_rooms(organisation_id,name) values('${org}','Contended deletion') returning id`);
  sql(`update public.plannix_classes set default_room_id='${timedRoom}' where id='${classId}';`);
  const holder=await connection('room-delete-timeout-holder',`select id from public.plannix_academic_years where organisation_id='${org}' for update;`);await holder.completed();
  const waiter=await connection('room-delete-timeout-waiter',`select public.plannix_delete_room('${org}','${timedRoom}');`);await blocked('room-delete-timeout-waiter');
  waiter.child.stdin.end();const timed=await waiter.done;assert.notEqual(timed.code,0);assert.match(timed.err,/55P03/,'two-second function lock timeout aborts contention');
  assert.equal((await holder.finish()).code,0);
  assert.equal(sql(`select count(*) from public.plannix_classes where default_room_id='${timedRoom}'`),'1','timeout preserves default');
  assert.equal(sql(`select count(*) from public.plannix_rooms where id='${timedRoom}'`),'1','timeout preserves room');
  // Revoke Admin after defaults are cleared but before the final DELETE. RLS
  // can suppress a DELETE without raising; the RPC must reject zero rows.
  sql(`create function public.plannix_room_delete_test_pause() returns trigger language plpgsql as $$begin if new.classes_revision<>old.classes_revision then perform pg_advisory_xact_lock(773111);end if;return new;end$$;
    create trigger room_delete_test_pause before update on public.plannix_academic_years for each row execute function public.plannix_room_delete_test_pause();`);
  t.after(()=>sql('drop trigger if exists room_delete_test_pause on public.plannix_academic_years;drop function if exists public.plannix_room_delete_test_pause();'));
  const revokeRevision=sql(`select classes_revision from public.plannix_academic_years where organisation_id='${org}' order by id`);
  const gate=await connection('room-delete-revoke-holder','select pg_advisory_xact_lock(773111);');await gate.completed();
  const deletion=await connection('room-delete-revoke-waiter',`select public.plannix_delete_room('${org}','${timedRoom}');`);await blocked('room-delete-revoke-waiter');
  sql(`delete from public.plannix_organisation_user_access_roles where organisation_user_id='12000000-0000-4000-8000-000000000001' and access_role_id in(select id from public.plannix_access_roles where name='Organisation Admin');`);
  assert.equal((await gate.finish()).code,0);deletion.child.stdin.end();const revoked=await deletion.done;
  assert.notEqual(revoked.code,0,'lost delete permission must roll back default clearing');assert.match(revoked.err,/42501/);
  assert.equal(sql(`select count(*) from public.plannix_classes where default_room_id='${timedRoom}'`),'1','RLS-suppressed deletion preserves default');
  assert.equal(sql(`select count(*) from public.plannix_rooms where id='${timedRoom}'`),'1','RLS-suppressed deletion preserves room');
  assert.equal(sql(`select classes_revision from public.plannix_academic_years where organisation_id='${org}' order by id`),revokeRevision,'RLS-suppressed deletion rolls back class revisions');

});
