begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(25);

create function pg_temp.call_batch(
  fixture_user_id uuid,
  fixture_revision bigint,
  fixture_mutations jsonb
)
returns table (revision bigint, collections jsonb)
language plpgsql set search_path='' as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(fixture_user_id::text,''),true);
  execute 'set local role authenticated';
  return query select * from public.plannix_apply_timetable_session_batch(
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    fixture_revision,fixture_mutations
  );
  execute 'reset role';
exception when others then execute 'reset role'; raise;
end;
$$;

create function pg_temp.call_dated(
  fixture_user_id uuid, fixture_date date, fixture_revision bigint, fixture_sessions jsonb
)
returns table (revision bigint, collection_id uuid, repeating_week_id uuid, sessions jsonb)
language plpgsql set search_path='' as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(fixture_user_id::text,''),true);
  execute 'set local role authenticated';
  return query select * from public.plannix_save_dated_timetable_sessions(
    '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',fixture_date,fixture_revision,fixture_sessions
  );
  execute 'reset role';
exception when others then execute 'reset role'; raise;
end;
$$;

create function pg_temp.call_effective(fixture_user_id uuid, fixture_date date)
returns table (revision bigint, week_start_date date, repeating_week_id uuid, source text,
  override_exists boolean, collection_id uuid, sessions jsonb)
language plpgsql set search_path='' as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(fixture_user_id::text,''),true);
  execute 'set local role authenticated';
  return query select * from public.plannix_get_dated_timetable_sessions(
    '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',fixture_date
  );
  execute 'reset role';
exception when others then execute 'reset role'; raise;
end;
$$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',fixture.id,'authenticated','authenticated',
  fixture.email,'',case when fixture.confirmed then now() else null end,
  '{"provider":"email","providers":["email"]}',
  pg_catalog.jsonb_build_object('first_name',fixture.given_name,'last_name','Sessions'),now(),now()
from (values
  ('01000000-0000-4000-8000-000000000001'::uuid,'session-admin@example.test','Admin',true),
  ('01000000-0000-4000-8000-000000000002'::uuid,'session-staff@example.test','Staff',true),
  ('01000000-0000-4000-8000-000000000003'::uuid,'session-read@example.test','Read',true),
  ('01000000-0000-4000-8000-000000000004'::uuid,'session-student@example.test','Student',true),
  ('01000000-0000-4000-8000-000000000005'::uuid,'session-other@example.test','Other',true),
  ('01000000-0000-4000-8000-000000000006'::uuid,'session-unconfirmed@example.test','Unconfirmed',false)
) as fixture(id,email,given_name,confirmed);

insert into public.plannix_organisations(id,name,organisation_type) values
  ('11000000-0000-4000-8000-000000000001','Session school','school'),
  ('11000000-0000-4000-8000-000000000002','Other school','school');
insert into public.plannix_organisation_users(id,organisation_id,user_id) values
  ('12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001'),
  ('12000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000002'),
  ('12000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000003'),
  ('12000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000004'),
  ('12000000-0000-4000-8000-000000000006','11000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000006'),
  ('12000000-0000-4000-8000-000000000005','11000000-0000-4000-8000-000000000002','01000000-0000-4000-8000-000000000005');
insert into public.plannix_organisation_user_access_roles(organisation_user_id,access_role_id)
select assignment.member_id,access_role.id from (values
  ('12000000-0000-4000-8000-000000000001'::uuid,'Organisation Admin'),
  ('12000000-0000-4000-8000-000000000002'::uuid,'Staff'),
  ('12000000-0000-4000-8000-000000000003'::uuid,'Read Only'),
  ('12000000-0000-4000-8000-000000000004'::uuid,'Student'),
  ('12000000-0000-4000-8000-000000000005'::uuid,'Organisation Admin'),
  ('12000000-0000-4000-8000-000000000006'::uuid,'Organisation Admin')
) as assignment(member_id,role_name)
join public.plannix_access_roles as access_role on access_role.name=assignment.role_name;

insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date) values
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Boundary year','2026-12-30','2027-02-28'),
 ('21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','Other year','2026-12-30','2027-02-28');
insert into public.plannix_holidays(id,academic_year_id,name,start_date,end_date) values
 ('22000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Full closure','2027-01-04','2027-01-08'),
 ('22000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','Overlap','2027-01-06','2027-01-08'),
 ('22000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000001','Partial','2027-01-11','2027-01-11');
insert into public.plannix_timetables(id,organisation_id,academic_year_id,name,days_per_week,
 active_from,active_to,cadence,is_default) values
 ('31000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Main','5','2026-12-30','2027-02-28','two-week',true),
 ('31000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','Other','5','2026-12-30','2027-02-28','one-week',true);
insert into public.plannix_timetable_weeks(id,timetable_id,code,name,sort_order) values
 ('32000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','A','Week A',0),
 ('32000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','B','Week B',1),
 ('32000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000002','A','Week A',0);
insert into public.plannix_timetable_periods(id,timetable_id,period_number,label,start_time,end_time,
 period_type,sort_order,is_enabled,is_visible) values
 ('33000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001',1,'Period 1','09:00','10:00','teaching',0,true,true),
 ('33000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001',2,'Period 2','10:00','11:00','teaching',1,true,true),
 ('33000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000001',null,'Break','11:00','11:15','break',2,true,true),
 ('33000000-0000-4000-8000-000000000004','31000000-0000-4000-8000-000000000002',1,'Other period','09:00','10:00','teaching',0,true,true);
insert into public.plannix_classes(id,organisation_id,academic_year_id,name,sort_order,frequency) values
 ('41000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Maths',0,2),
 ('41000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Science',1,4),
 ('41000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','Other',0,4);


create function pg_temp.run_as(u uuid, command text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',coalesce(u::text,''),true);
 execute 'set local role authenticated'; execute command; execute 'reset role';
exception when others then execute 'reset role';raise;end $$;
create function pg_temp.rooms_as(u uuid) returns setof uuid language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',coalesce(u::text,''),true);
 execute 'set local role authenticated'; return query select id from public.plannix_rooms; execute 'reset role';
exception when others then execute 'reset role';raise;end $$;
create function pg_temp.save_classes(payload jsonb, expected bigint default null) returns jsonb language plpgsql as $$
declare result jsonb; v bigint;
begin
 select classes_revision into v from public.plannix_academic_years where id='21000000-0000-4000-8000-000000000001';
 perform set_config('request.jwt.claim.sub','01000000-0000-4000-8000-000000000001',true);
 execute 'set local role authenticated';
 select to_jsonb(saved) into result from public.plannix_save_classes(
 '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',coalesce(expected,v),payload) saved;
 execute 'reset role';return result;
exception when others then execute 'reset role';raise;end $$;
create function pg_temp.save_sessions(payload jsonb) returns jsonb language sql as $$
 select to_jsonb(saved) from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',
 (select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),
 jsonb_build_array(jsonb_build_object('type','recurring','weekId','32000000-0000-4000-8000-000000000001','sessions',payload))) saved;
$$;
insert into public.plannix_students(id,organisation_id,organisation_user_id,first_name,last_name)
values('92000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000004','Synthetic','Student');
insert into public.plannix_class_students(class_id,student_id,organisation_id)
values('41000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001');


insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date) values
('21000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001','Another saved year','2027-09-01','2028-08-31');
insert into public.plannix_classes(id,organisation_id,academic_year_id,name,sort_order,frequency) values
('41000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000003','Next year class',0,2);
insert into public.plannix_rooms(id,organisation_id,name) values
('91000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Delete defaults'),
('91000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','Protected lessons');
update public.plannix_classes set default_room_id='91000000-0000-4000-8000-000000000001' where organisation_id='11000000-0000-4000-8000-000000000001';
update public.plannix_rooms set is_active=false where id='91000000-0000-4000-8000-000000000001';
select extensions.ok(has_function_privilege('authenticated','public.plannix_delete_room(uuid,uuid)','EXECUTE'),'authenticated can enter role-checked RPC');
select extensions.ok((select not prosecdef from pg_proc where oid='public.plannix_delete_room(uuid,uuid)'::regprocedure),'invoker security preserves RLS');
select extensions.ok((select proconfig @> array['search_path=""','lock_timeout=2s'] from pg_proc where oid='public.plannix_delete_room(uuid,uuid)'::regprocedure),'empty search path and bounded lock wait');
select extensions.is(pg_get_function_result('public.plannix_delete_room(uuid,uuid)'::regprocedure),'uuid','exact deleted UUID result');
select extensions.ok(not has_function_privilege('anon','public.plannix_delete_room(uuid,uuid)','EXECUTE'),'anon denied');
select extensions.ok(not has_function_privilege('service_role','public.plannix_delete_room(uuid,uuid)','EXECUTE'),'service role denied');
select extensions.ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='public.plannix_delete_room(uuid,uuid)'::regprocedure and a.grantee=0),'PUBLIC denied');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000002','select public.plannix_delete_room(''11000000-0000-4000-8000-000000000001'',''91000000-0000-4000-8000-000000000001'')')$$,'42501','Confirmed Organisation Admin access is required.','Staff denied');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000003','select public.plannix_delete_room(''11000000-0000-4000-8000-000000000001'',''91000000-0000-4000-8000-000000000001'')')$$,'42501','Confirmed Organisation Admin access is required.','Read Only denied');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000004','select public.plannix_delete_room(''11000000-0000-4000-8000-000000000001'',''91000000-0000-4000-8000-000000000001'')')$$,'42501','Confirmed Organisation Admin access is required.','Student denied');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000005','select public.plannix_delete_room(''11000000-0000-4000-8000-000000000001'',''91000000-0000-4000-8000-000000000001'')')$$,'42501','Confirmed Organisation Admin access is required.','other organisation Admin denied');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000006','select public.plannix_delete_room(''11000000-0000-4000-8000-000000000001'',''91000000-0000-4000-8000-000000000001'')')$$,'42501','Confirmed Organisation Admin access is required.','unconfirmed Admin denied');
select extensions.is((select count(*)::integer from public.plannix_classes where default_room_id='91000000-0000-4000-8000-000000000001'),3,'denied requests preserve all defaults');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','select public.plannix_delete_room(''11000000-0000-4000-8000-000000000001'',''91000000-0000-4000-8000-000000000001'')')$$,'Admin deletes archived room with multiple defaults');
select extensions.is((select count(*)::integer from public.plannix_classes where default_room_id is not null),0,'all defaults cleared');
select extensions.is((select classes_revision from public.plannix_academic_years where id='21000000-0000-4000-8000-000000000001'),1::bigint,'affected class revision advanced once');
select extensions.ok(not exists(select 1 from public.plannix_rooms where id='91000000-0000-4000-8000-000000000001'),'room deleted');
select extensions.is((select classes_revision from public.plannix_academic_years where id='21000000-0000-4000-8000-000000000003'),1::bigint,'other affected year revision advanced');
select extensions.is((select classes_revision from public.plannix_academic_years where id='21000000-0000-4000-8000-000000000002'),0::bigint,'other organisation revision unchanged');

-- Repeating reference prevents deletion; class defaults remain unchanged.
update public.plannix_classes set default_room_id='91000000-0000-4000-8000-000000000002' where organisation_id='11000000-0000-4000-8000-000000000001';
select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',0,'[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Synthetic","notes":"","roomId":"91000000-0000-4000-8000-000000000002"}]}]');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','select public.plannix_delete_room(''11000000-0000-4000-8000-000000000001'',''91000000-0000-4000-8000-000000000002'')')$$,'23503','Room has timetable lesson assignments.','repeating reference rejects deletion');
select extensions.is((select count(*)::integer from public.plannix_classes where default_room_id='91000000-0000-4000-8000-000000000002'),3,'rejection preserves all defaults');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions where room_id='91000000-0000-4000-8000-000000000002'),1,'rejection preserves lesson');
select extensions.is((select classes_revision from public.plannix_academic_years where id='21000000-0000-4000-8000-000000000001'),1::bigint,'rejection preserves revision');
select * from pg_temp.call_dated('01000000-0000-4000-8000-000000000001','2027-01-18',1,'[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Synthetic","notes":"","roomId":"91000000-0000-4000-8000-000000000002"}]');
delete from public.plannix_timetable_sessions where collection_id in(select id from public.plannix_timetable_session_collections where collection_type='recurring');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','select public.plannix_delete_room(''11000000-0000-4000-8000-000000000001'',''91000000-0000-4000-8000-000000000002'')')$$,'23503','Room has timetable lesson assignments.','dated-only reference rejects deletion');
select extensions.is((select count(*)::integer from public.plannix_classes where default_room_id='91000000-0000-4000-8000-000000000002'),3,'dated rejection preserves defaults');
set constraints all immediate;
select * from extensions.finish();
rollback;
