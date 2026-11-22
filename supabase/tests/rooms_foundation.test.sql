begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(172);

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

select extensions.ok((select relrowsecurity from pg_class where oid='public.plannix_rooms'::regclass),'rooms RLS enabled');
select extensions.ok(not has_table_privilege('anon','public.plannix_rooms','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),'anon has no direct room access');
select extensions.ok(not has_table_privilege('service_role','public.plannix_rooms','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),'service_role has no direct room access');
select extensions.ok(not exists(select 1 from pg_class c,lateral aclexplode(c.relacl) a where c.oid='public.plannix_rooms'::regclass and a.grantee=0),'PUBLIC has no room grant');
select extensions.ok(not has_table_privilege('authenticated','public.plannix_rooms','TRUNCATE,TRIGGER,REFERENCES,MAINTAIN'),'authenticated cannot bypass RLS with maintenance privileges');
select extensions.is((select count(*) from public.plannix_classes where default_room_id is not null),0::bigint,'pre-existing classes have no room');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','insert into public.plannix_rooms(id,organisation_id,name) values(''91000000-0000-4000-8000-000000000001'',''11000000-0000-4000-8000-000000000001'',''Room 1'')')$$,'admin creates room 1');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','insert into public.plannix_rooms(id,organisation_id,name) values(''91000000-0000-4000-8000-000000000002'',''11000000-0000-4000-8000-000000000001'',''Room 2'')')$$,'admin creates room 2');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','insert into public.plannix_rooms(id,organisation_id,name) values(''91000000-0000-4000-8000-000000000003'',''11000000-0000-4000-8000-000000000001'',''Room 3'')')$$,'admin creates room 3');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','insert into public.plannix_rooms(id,organisation_id,name) values(''91000000-0000-4000-8000-000000000004'',''11000000-0000-4000-8000-000000000001'',''Room 4'')')$$,'admin creates room 4');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000005','insert into public.plannix_rooms(id,organisation_id,name) values(''91000000-0000-4000-8000-000000000005'',''11000000-0000-4000-8000-000000000002'',''Other room'')')$$,'other organisation creates its own room');
select extensions.ok((select bool_and(is_active) from public.plannix_rooms),'new rooms default active');
-- A genuine second-organisation placement verifies both allowed and denied scope reads.
insert into public.plannix_timetable_session_collections(id,organisation_id,academic_year_id,timetable_id,collection_type,timetable_week_id)
values('93000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002',
'31000000-0000-4000-8000-000000000002','recurring','32000000-0000-4000-8000-000000000003');
insert into public.plannix_timetable_sessions(id,collection_id,timetable_id,timetable_week_id,class_id,period_id,academic_year_id,organisation_id,day_number,title,room_id)
values('94000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002',
'32000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000003','33000000-0000-4000-8000-000000000004',
'21000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002',1,'Other synthetic lesson','91000000-0000-4000-8000-000000000005');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000005',
'update public.plannix_rooms set name=''Forbidden'' where id=''91000000-0000-4000-8000-000000000001''')$$,'other current admin cannot update this organisation room');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000005',
'delete from public.plannix_rooms where id=''91000000-0000-4000-8000-000000000001''')$$,'other current admin cannot delete this organisation room');
select extensions.is((select name from public.plannix_rooms where id='91000000-0000-4000-8000-000000000001'),'Room 1','wrong-organisation mutations leave room intact');

select extensions.is((select count(*) from pg_temp.rooms_as('01000000-0000-4000-8000-000000000001')),4::bigint,'scoped room read for 1');
select extensions.is((select count(*) from pg_temp.rooms_as('01000000-0000-4000-8000-000000000002')),4::bigint,'scoped room read for 2');
select extensions.is((select count(*) from pg_temp.rooms_as('01000000-0000-4000-8000-000000000003')),4::bigint,'scoped room read for 3');
select extensions.is((select count(*) from pg_temp.rooms_as('01000000-0000-4000-8000-000000000004')),0::bigint,'scoped room read for 4');
select extensions.is((select count(*) from pg_temp.rooms_as('01000000-0000-4000-8000-000000000005')),1::bigint,'scoped room read for 5');
select extensions.is((select count(*) from pg_temp.rooms_as(null)),0::bigint,'scoped room read for None');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000002','insert into public.plannix_rooms(organisation_id,name) values(''11000000-0000-4000-8000-000000000001'',''Forbidden'')')$$,'42501',null,'non-admin or wrong-organisation insert denied 2');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000003','insert into public.plannix_rooms(organisation_id,name) values(''11000000-0000-4000-8000-000000000001'',''Forbidden'')')$$,'42501',null,'non-admin or wrong-organisation insert denied 3');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000004','insert into public.plannix_rooms(organisation_id,name) values(''11000000-0000-4000-8000-000000000001'',''Forbidden'')')$$,'42501',null,'non-admin or wrong-organisation insert denied 4');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000005','insert into public.plannix_rooms(organisation_id,name) values(''11000000-0000-4000-8000-000000000001'',''Forbidden'')')$$,'42501',null,'non-admin or wrong-organisation insert denied 5');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000002','update public.plannix_rooms set name=''Forbidden'' where id=''91000000-0000-4000-8000-000000000001''')$$,'staff update affects no visible writable row');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000003','delete from public.plannix_rooms where id=''91000000-0000-4000-8000-000000000001''')$$,'read-only deletion affects no row');
select extensions.is((select name from public.plannix_rooms where id='91000000-0000-4000-8000-000000000001'),'Room 1','denied writes leave room unchanged');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','update public.plannix_rooms set organisation_id=''11000000-0000-4000-8000-000000000002'' where id=''91000000-0000-4000-8000-000000000001''')$$,'42501',null,'room update checks destination organisation');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','insert into public.plannix_rooms(organisation_id,name) values(''11000000-0000-4000-8000-000000000001'',''   '')')$$,'23514',null,'invalid room name rejected');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','insert into public.plannix_rooms(organisation_id,name) values(''11000000-0000-4000-8000-000000000001'',''xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'')')$$,'23514',null,'invalid room name rejected');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','update public.plannix_classes set default_room_id=''91000000-0000-4000-8000-000000000005'' where id=''41000000-0000-4000-8000-000000000001''; set constraints public.fk_plannix_classes_default_room immediate')$$,'23503',null,'class FK rejects cross-organisation room');
select extensions.throws_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":"91000000-0000-4000-8000-000000000005"},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'23503',null,'class RPC rejects cross-organisation room atomically');
select extensions.is((select classes_revision from public.plannix_academic_years where id='21000000-0000-4000-8000-000000000001'),0::bigint,'failed class room save leaves revision unchanged');
select extensions.throws_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":true},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'22023',null,'class room rejects malformed True');
select extensions.throws_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":[]},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'22023',null,'class room rejects malformed []');
select extensions.throws_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":{}},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'22023',null,'class room rejects malformed {}');
select extensions.throws_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":"invalid"},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'22023',null,'class room rejects malformed invalid');
select extensions.throws_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":""},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'22023',null,'class room rejects malformed ');
create temporary table room_class_result as select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":"91000000-0000-4000-8000-000000000001"},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]');
select extensions.is((select pg_temp_result->'classes'->0->>'defaultRoomId' from (select * from room_class_result) r(pg_temp_result)),'91000000-0000-4000-8000-000000000001','class RPC returns saved defaultRoomId');
select extensions.lives_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'legacy class payload remains accepted');
select extensions.is((select default_room_id::text from public.plannix_classes where id='41000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000001','legacy class save preserves room default');
select extensions.throws_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]',0)$$,'40001',null,'room changes preserve class revision conflicts');
update public.plannix_classes set default_room_id='91000000-0000-4000-8000-000000000004'
where id='41000000-0000-4000-8000-000000000002';
select extensions.is((select count(*) from pg_temp.rooms_as('01000000-0000-4000-8000-000000000004')),1::bigint,'student sees own class default room only');
select extensions.ok(not exists(select 1 from pg_temp.rooms_as('01000000-0000-4000-8000-000000000004') r
where r='91000000-0000-4000-8000-000000000004'),'student cannot read another class room');
update public.plannix_classes set default_room_id=null where id='41000000-0000-4000-8000-000000000002';
select extensions.throws_ok($$delete from public.plannix_rooms where id='91000000-0000-4000-8000-000000000001'; set constraints public.fk_plannix_classes_default_room immediate$$,'23503',null,'class-only room reference blocks deletion');
select extensions.lives_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'legacy new placement uses class default');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000001','new placement stores snapshot of class default');
select extensions.is((select room_id::text from public.plannix_get_timetable_room_assignments(
 '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001')),
 '91000000-0000-4000-8000-000000000001','separate room read returns assigned room');
select extensions.ok(not (private.plannix_session_json((select id from public.plannix_timetable_session_collections
where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001'),false)->0 ? 'roomId'),
'legacy session JSON retains its exact validator-compatible fields with rooms assigned');
create function pg_temp.assignments_as(u uuid, org uuid default '11000000-0000-4000-8000-000000000001',
 yr uuid default '21000000-0000-4000-8000-000000000001', tt uuid default '31000000-0000-4000-8000-000000000001')
returns jsonb language plpgsql as $$ declare result jsonb; begin
 perform set_config('request.jwt.claim.sub',coalesce(u::text,''),true);execute 'set local role authenticated';
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from public.plannix_get_timetable_room_assignments(
 org,yr,tt) r;
 execute 'reset role';return result;
exception when others then execute 'reset role';raise;end $$;
select extensions.ok(not has_function_privilege('anon','public.plannix_get_timetable_room_assignments(uuid,uuid,uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.plannix_get_timetable_room_assignments(uuid,uuid,uuid)','EXECUTE'),
'room read has no anonymous or service-role execution');
select extensions.is(jsonb_array_length(pg_temp.assignments_as('01000000-0000-4000-8000-000000000002')),1,'staff can read room assignment');
select extensions.is(jsonb_array_length(pg_temp.assignments_as('01000000-0000-4000-8000-000000000003')),1,'read-only member can read room assignment');
select extensions.is(jsonb_array_length(pg_temp.assignments_as('01000000-0000-4000-8000-000000000004')),1,'enrolled student can read own room assignment');
select extensions.is(jsonb_array_length(pg_temp.assignments_as('01000000-0000-4000-8000-000000000005')),0,'another organisation cannot read room assignment');
select extensions.is(jsonb_array_length(pg_temp.assignments_as('01000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002')),0,'room read cannot mix organisation and year scope');
select extensions.is(jsonb_array_length(pg_temp.assignments_as('01000000-0000-4000-8000-000000000001',
'11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000002')),0,'room read rejects a different academic year');
select extensions.is(jsonb_array_length(pg_temp.assignments_as('01000000-0000-4000-8000-000000000001',
'11000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002')),0,'matching foreign scope cannot bypass RLS');
select extensions.is(jsonb_array_length(pg_temp.assignments_as('01000000-0000-4000-8000-000000000005',
'11000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002')),1,'other admin can read own real assignment');

select extensions.throws_ok($$select pg_temp.assignments_as(null)$$,'42501','Authentication is required.','room read requires signed-in identity');
select extensions.throws_ok($$select pg_temp.assignments_as('01000000-0000-4000-8000-000000000006')$$,'42501','Email confirmation is required.','room read denies unconfirmed identity');
select set_config('request.jwt.claim.sub','01000000-0000-4000-8000-000000000001',true);
select extensions.lives_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":"91000000-0000-4000-8000-000000000002"},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'class default can change');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000001','changing class default preserves existing session assignment');
select extensions.lives_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'legacy slot-matched session edit accepted');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000001','legacy slot-matched edit preserves assignment');
select extensions.lives_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":"91000000-0000-4000-8000-000000000003"}]')$$,'explicit session room can differ from class default');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000003','explicit session room saved');
create temporary table room_saved_session as select id from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001');
select extensions.lives_ok($$select pg_temp.save_sessions(jsonb_set('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]'::jsonb,'{0,id}',to_jsonb((select id::text from room_saved_session))))$$,'legacy ID-matched update accepted');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000003','legacy ID-matched edit preserves assigned room');
select extensions.lives_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'adding another placement preserves old and snapshots default for new');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000003','first room survives collection replacement');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000002'),'91000000-0000-4000-8000-000000000002','new second slot uses new class default');
select extensions.throws_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":true},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'22023',null,'session room rejects malformed True');
select extensions.throws_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":[]},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'22023',null,'session room rejects malformed []');
select extensions.throws_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":{}},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'22023',null,'session room rejects malformed {}');
select extensions.throws_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":"invalid"},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'22023',null,'session room rejects malformed invalid');
select extensions.throws_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":""},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'22023',null,'session room rejects malformed ');
select extensions.throws_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":"91000000-0000-4000-8000-000000000005"},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'23503',null,'session RPC rejects cross-organisation room');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000003','failed room mutation leaves previous session intact');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','update public.plannix_timetable_sessions set room_id=''91000000-0000-4000-8000-000000000005'' where collection_id=(select id from public.plannix_timetable_session_collections where collection_type=''recurring'' and timetable_id=''31000000-0000-4000-8000-000000000001''); set constraints public.fk_plannix_timetable_sessions_room immediate')$$,'23503',null,'direct session writes also enforce organisation FK');
select extensions.lives_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":null},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'explicit null clears session room');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),null::text,'session room explicitly cleared');
select extensions.lives_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":"91000000-0000-4000-8000-000000000001"},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'default changed again');
select extensions.throws_ok($$delete from public.plannix_rooms where id='91000000-0000-4000-8000-000000000002'; set constraints public.fk_plannix_timetable_sessions_room immediate$$,'23503',null,'session-only room reference blocks deletion');
select extensions.lives_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'legacy edit of cleared assignment accepted');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),null::text,'legacy omission does not refill explicitly cleared room');
select extensions.lives_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":"91000000-0000-4000-8000-000000000003"},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'restore explicit first room for inheritance tests');
select extensions.lives_ok($$select * from pg_temp.call_dated('01000000-0000-4000-8000-000000000001','2027-01-18',(select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),'[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'old dated client materializes override without room fields or IDs');
select extensions.is((select room_id::text from public.plannix_timetable_sessions s join public.plannix_timetable_session_collections c on c.id=s.collection_id where c.week_start_date='2027-01-18' and s.period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000003','dated override keeps explicit recurring room rather than changed class default');
select extensions.lives_ok($$select * from pg_temp.call_dated('01000000-0000-4000-8000-000000000001','2027-01-18',(select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),'[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":null},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'dated explicit null clears its own room');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000003','dated clear leaves recurring assignment unchanged');
select extensions.lives_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":null},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'clear recurring first room before another dated copy');
select extensions.lives_ok($$select * from pg_temp.call_dated('01000000-0000-4000-8000-000000000001','2027-02-01',(select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),'[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'another old-client dated copy accepted');
select extensions.is((select room_id::text from public.plannix_timetable_sessions s join public.plannix_timetable_session_collections c on c.id=s.collection_id where c.week_start_date='2027-02-01' and s.period_id='33000000-0000-4000-8000-000000000001'),null::text,'dated inheritance preserves null rather than filling from class default');
select extensions.lives_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes","roomId":"91000000-0000-4000-8000-000000000003"},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'restore room before archive');
select extensions.lives_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":"91000000-0000-4000-8000-000000000003"},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'set default before archive');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','update public.plannix_rooms set is_active=false where id=''91000000-0000-4000-8000-000000000003''')$$,'admin archives room without deleting it');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000003','archiving preserves session reference');
select extensions.is((select default_room_id::text from public.plannix_classes where id='41000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000003','archiving preserves class reference');
select extensions.lives_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'legacy save preserves archived class default');
select extensions.lives_ok($$select pg_temp.save_sessions('[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"},{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"Lesson","notes":"Notes"}]')$$,'legacy save preserves archived session references');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000003','archived session assignment remains saved');
select extensions.ok(exists(select 1 from pg_temp.rooms_as('01000000-0000-4000-8000-000000000004') r where r='91000000-0000-4000-8000-000000000003'),'student can still read archived referenced room');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','delete from public.plannix_rooms where id=''91000000-0000-4000-8000-000000000003''; set constraints public.fk_plannix_classes_default_room, public.fk_plannix_timetable_sessions_room immediate')$$,'23503',null,'referenced archived room deletion blocked');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','insert into public.plannix_rooms(organisation_id,name) values(''11000000-0000-4000-8000-000000000001'',''Room 3'')')$$,'23505',null,'archival does not free an existing saved room name');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','delete from public.plannix_rooms where id=''91000000-0000-4000-8000-000000000004''')$$,'unreferenced room may be deleted');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001','update public.plannix_rooms set is_active=true where id=''91000000-0000-4000-8000-000000000003''')$$,'room may be reactivated');
update public.plannix_classes set default_room_id='91000000-0000-4000-8000-000000000005' where id='41000000-0000-4000-8000-000000000003';
select extensions.lives_ok($$delete from public.plannix_organisations where id='11000000-0000-4000-8000-000000000002'$$,'organisation deletion cascades without dangling room references');
select extensions.is((select count(*) from public.plannix_rooms where organisation_id='11000000-0000-4000-8000-000000000002'),0::bigint,'organisation cascade removes its room');
select extensions.lives_ok($$set constraints public.fk_plannix_classes_default_room, public.fk_plannix_timetable_sessions_room immediate;
set constraints public.fk_plannix_classes_default_room, public.fk_plannix_timetable_sessions_room deferred$$,
'organisation cascade passes deferred room validation after removing real room-bearing sessions');
select extensions.ok((select count(*)=2 and bool_and(condeferrable and condeferred) from pg_constraint
where conname in ('fk_plannix_classes_default_room','fk_plannix_timetable_sessions_room')),'room FKs are explicitly commit-validated');

select extensions.lives_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":null},{"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'class default explicitly cleared');
select extensions.is((select default_room_id::text from public.plannix_classes where id='41000000-0000-4000-8000-000000000001'),null::text,'cleared default remains null');
select extensions.is((select room_id::text from public.plannix_timetable_sessions where collection_id=(select id from public.plannix_timetable_session_collections where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001') and period_id='33000000-0000-4000-8000-000000000001'),'91000000-0000-4000-8000-000000000003','clearing default never rewrites prior session assignment');

-- Real legacy move/swap payloads retain IDs and omit all room fields.
create temporary table room_swap_before as
select id,room_id,period_id,day_number,class_id,title,notes from public.plannix_timetable_sessions
where collection_id=(select id from public.plannix_timetable_session_collections
 where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001');
select extensions.lives_ok($$select pg_temp.save_sessions((select jsonb_agg(jsonb_build_object(
 'id',id,'day',day_number-1,'periodId',case when period_id='33000000-0000-4000-8000-000000000001'
 then '33000000-0000-4000-8000-000000000002'::uuid else '33000000-0000-4000-8000-000000000001'::uuid end,
 'classId',class_id,'title',coalesce(title,''),'notes',coalesce(notes,'')) order by id) from room_swap_before))$$,
'ID-preserving swap accepts a legacy payload without room fields');
select extensions.ok(not exists(select 1 from room_swap_before b join public.plannix_timetable_sessions s using(id)
 where s.room_id is distinct from b.room_id or s.period_id=b.period_id),'swapped rooms follow their lesson IDs rather than destination slots');
select extensions.lives_ok($$select pg_temp.save_sessions((select jsonb_agg(jsonb_build_object(
 'id',s.id,'day',case when b.period_id='33000000-0000-4000-8000-000000000001' then 1 else 0 end,
 'periodId',s.period_id,'classId',s.class_id,'title',coalesce(s.title,''),'notes',coalesce(s.notes,'')) order by s.id)
 from public.plannix_timetable_sessions s join room_swap_before b using(id)))$$,'ID-preserving move accepts omitted rooms');
select extensions.ok(not exists(select 1 from room_swap_before b join public.plannix_timetable_sessions s using(id)
 where s.room_id is distinct from b.room_id),'moving a lesson preserves its assigned room');
select extensions.lives_ok($$select pg_temp.save_sessions((select jsonb_agg(jsonb_build_object(
 'id',id,'day',day_number-1,'periodId',period_id,'classId',class_id,
 'title',coalesce(title,''),'notes',coalesce(notes,'')) order by id) from room_swap_before))$$,'restoring coordinates leaves assignments intact');
-- Existing push/pull operations copy lesson text, not room/location, across dated collections.
create temporary table room_copy_before as select id,room_id from public.plannix_timetable_sessions;
select extensions.lives_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',
 (select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),
 (select jsonb_agg(jsonb_build_object('type','date_override','weekStartDate',c.week_start_date,'sessions',
  (select jsonb_agg(jsonb_build_object('id',s.id,'day',s.day_number-1,'periodId',s.period_id,'classId',s.class_id,
   'title','Copied lesson text','notes','Copied notes') order by s.day_number,s.period_id)
   from public.plannix_timetable_sessions s where s.collection_id=c.id)) order by c.week_start_date)
 from public.plannix_timetable_session_collections c where c.collection_type='date_override'))$$,
'multi-collection text-copy payload omitting rooms is accepted');
select extensions.ok(not exists(select 1 from room_copy_before b join public.plannix_timetable_sessions s using(id)
 where s.room_id is distinct from b.room_id),'copying lesson text preserves each dated location including null');
select extensions.is((select count(*) from public.plannix_timetable_sessions s join public.plannix_timetable_session_collections c
 on c.id=s.collection_id where c.collection_type='date_override' and s.title='Copied lesson text'),4::bigint,'both dated collections actually received copied text');
select extensions.ok(not exists(select 1 from public.plannix_timetable_session_collections c,
 lateral jsonb_array_elements(private.plannix_session_json(c.id,false)) x where x ? 'roomId'),
'legacy read JSON still contains no new keys after swaps and copies');
-- Establish valid active assignments, then archive: retain, never newly assign.
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001',
 'insert into public.plannix_rooms(id,organisation_id,name) values(''91000000-0000-4000-8000-000000000006'',
 ''11000000-0000-4000-8000-000000000001'',''Archived new assignments'')')$$,'create active room for archival tests');
select extensions.lives_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2},
 {"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4,"defaultRoomId":"91000000-0000-4000-8000-000000000006"}]')$$,'active room becomes class default');
select extensions.lives_ok($$select pg_temp.save_sessions(
 private.plannix_session_json((select id from public.plannix_timetable_session_collections where collection_type='recurring'
 and timetable_id='31000000-0000-4000-8000-000000000001'),false)
 || '[{"day":2,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000002","title":"Science","notes":""},
 {"day":3,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000002","title":"Science 2","notes":""}]'::jsonb)$$,'new placements use active default');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001',
 'update public.plannix_rooms set is_active=false where id=''91000000-0000-4000-8000-000000000006''')$$,'archive assigned room');
select extensions.lives_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2},
 {"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4,"defaultRoomId":"91000000-0000-4000-8000-000000000006"}]')$$,'explicit unchanged archived default is retained');
select extensions.lives_ok($$select pg_temp.save_sessions(private.plannix_session_json((select id from public.plannix_timetable_session_collections
 where collection_type='recurring' and timetable_id='31000000-0000-4000-8000-000000000001'),false))$$,'ordinary legacy save retains archived assignments');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001',
 'update public.plannix_timetable_sessions set room_id=''91000000-0000-4000-8000-000000000006''
 where class_id=''41000000-0000-4000-8000-000000000002''')$$,'explicit unchanged archived session room is retained');
select extensions.throws_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2,"defaultRoomId":"91000000-0000-4000-8000-000000000006"},
 {"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4}]')$$,'23514','Archived rooms cannot be newly assigned.','cannot change class default to archived room');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001',
 'insert into public.plannix_classes(organisation_id,academic_year_id,name,frequency,sort_order,default_room_id)
 values(''11000000-0000-4000-8000-000000000001'',''21000000-0000-4000-8000-000000000001'',''Forbidden archived class'',1,2,''91000000-0000-4000-8000-000000000006'')')$$,
'23514','Archived rooms cannot be newly assigned.','new class cannot take archived default through direct SQL');
select extensions.throws_ok($$select pg_temp.save_sessions(
 private.plannix_session_json((select id from public.plannix_timetable_session_collections where collection_type='recurring'
 and timetable_id='31000000-0000-4000-8000-000000000001'),false)
 || '[{"day":4,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000002","title":"New","notes":""}]'::jsonb)$$,
'23514','Archived rooms cannot be newly assigned.','new lesson cannot inherit an archived class default');
select extensions.throws_ok($$select pg_temp.save_sessions(
 private.plannix_session_json((select id from public.plannix_timetable_session_collections where collection_type='recurring'
 and timetable_id='31000000-0000-4000-8000-000000000001'),false)
 || '[{"day":4,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000002","title":"New","notes":"","roomId":"91000000-0000-4000-8000-000000000006"}]'::jsonb)$$,
'23514','Archived rooms cannot be newly assigned.','new lesson cannot explicitly choose archived room');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001',
 'insert into public.plannix_timetable_sessions(collection_id,timetable_id,timetable_week_id,class_id,period_id,academic_year_id,organisation_id,day_number,room_id)
 select id,''31000000-0000-4000-8000-000000000001'',''32000000-0000-4000-8000-000000000001'',
 ''41000000-0000-4000-8000-000000000002'',''33000000-0000-4000-8000-000000000002'',
 ''21000000-0000-4000-8000-000000000001'',''11000000-0000-4000-8000-000000000001'',5,''91000000-0000-4000-8000-000000000006''
 from public.plannix_timetable_session_collections where collection_type=''recurring'' and timetable_id=''31000000-0000-4000-8000-000000000001''')$$,
'23514','Archived rooms cannot be newly assigned.','direct new session cannot bypass archived-room rule');

select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001',
 'update public.plannix_timetable_sessions set room_id=''91000000-0000-4000-8000-000000000006''
 where class_id=''41000000-0000-4000-8000-000000000001''')$$,'23514','Archived rooms cannot be newly assigned.','existing other lessons cannot switch to archived room');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001',
 'update public.plannix_timetable_sessions set room_id=null where class_id=''41000000-0000-4000-8000-000000000002'' and day_number=3')$$,'archived session assignment may be cleared');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001',
 'update public.plannix_timetable_sessions set room_id=''91000000-0000-4000-8000-000000000006''
 where class_id=''41000000-0000-4000-8000-000000000002'' and day_number=3')$$,'23514','Archived rooms cannot be newly assigned.','cleared archived assignment cannot be restored as a new choice');
select extensions.is((select count(*) from public.plannix_timetable_sessions where room_id='91000000-0000-4000-8000-000000000006'),1::bigint,
'only the retained archived assignment remains');
select extensions.lives_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2},
 {"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4,"defaultRoomId":null}]')$$,'archived class default may be cleared');
select extensions.throws_ok($$select pg_temp.save_classes('[{"id":"41000000-0000-4000-8000-000000000001","name":"Maths","frequency":2},
 {"id":"41000000-0000-4000-8000-000000000002","name":"Science","frequency":4,"defaultRoomId":"91000000-0000-4000-8000-000000000006"}]')$$,
'23514','Archived rooms cannot be newly assigned.','cleared default cannot be restored to archived room');
select extensions.ok(exists(select 1 from jsonb_array_elements(pg_temp.assignments_as('01000000-0000-4000-8000-000000000002')) x
 where x->>'room_id'='91000000-0000-4000-8000-000000000006'),'staff room RPC reads archived assignments');
select extensions.ok(exists(select 1 from jsonb_array_elements(pg_temp.assignments_as('01000000-0000-4000-8000-000000000003')) x
 where x->>'room_id'='91000000-0000-4000-8000-000000000006'),'read-only room RPC reads archived assignments');
select extensions.ok(not exists(select 1 from jsonb_array_elements(pg_temp.assignments_as('01000000-0000-4000-8000-000000000004')) x
 where x->>'room_id'='91000000-0000-4000-8000-000000000006'),'student room RPC omits another class despite mixed visible collections');
select extensions.ok(not exists(select 1 from pg_temp.rooms_as('01000000-0000-4000-8000-000000000004') r
 where r='91000000-0000-4000-8000-000000000006'),'student room-table read omits another class archived room');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001',
 'update public.plannix_rooms set is_active=false where id=''91000000-0000-4000-8000-000000000003''')$$,'archive own referenced room again');
select extensions.ok(exists(select 1 from jsonb_array_elements(pg_temp.assignments_as('01000000-0000-4000-8000-000000000004')) x
 where x->>'room_id'='91000000-0000-4000-8000-000000000003'),'student room RPC retains archived own-class assignments');
select extensions.lives_ok($$select * from pg_temp.call_dated('01000000-0000-4000-8000-000000000001','2027-02-15',
 (select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),
 private.plannix_session_json((select id from public.plannix_timetable_session_collections where collection_type='recurring'
 and timetable_id='31000000-0000-4000-8000-000000000001'),true))$$,'dated materialisation retains archived repeating assignments');
select extensions.is((select room_id::text from public.plannix_timetable_sessions s join public.plannix_timetable_session_collections c on c.id=s.collection_id
 where c.week_start_date='2027-02-15' and s.period_id='33000000-0000-4000-8000-000000000001' and s.day_number=1),
 '91000000-0000-4000-8000-000000000003','materialised dated row retains exact archived source room');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000001',
 'update public.plannix_timetable_sessions set room_id=''91000000-0000-4000-8000-000000000003'' where collection_id in
 (select id from public.plannix_timetable_session_collections where week_start_date=''2027-01-18'') and day_number=1
 and period_id=''33000000-0000-4000-8000-000000000001''')$$,'23514','Archived rooms cannot be newly assigned.',
'existing dated null cannot be changed to archived room even if it matches repeating source');
select extensions.ok(not has_function_privilege('authenticated','private.plannix_validate_class_room()','EXECUTE')
 and not has_function_privilege('authenticated','private.plannix_validate_session_room()','EXECUTE'),'validation functions are trigger-only');

-- Validate final values even if another BEFORE trigger normalises the input.
create function pg_temp.room_before_rewrite() returns trigger language plpgsql as $$
begin new.default_room_id := '91000000-0000-4000-8000-000000000006';return new;end $$;
create trigger zzz_room_before_rewrite before insert on public.plannix_classes
for each row when (new.name='Before trigger test') execute function pg_temp.room_before_rewrite();
select extensions.throws_ok($$insert into public.plannix_classes(organisation_id,academic_year_id,name,sort_order,frequency,default_room_id)
values('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Before trigger test',2,1,
'91000000-0000-4000-8000-000000000001')$$,'23514','Archived rooms cannot be newly assigned.','final stored value cannot bypass archive validation through a BEFORE rewrite');
drop trigger zzz_room_before_rewrite on public.plannix_classes;
-- An authenticated identity with no organisation membership has no room access.
insert into auth.users(id,email,email_confirmed_at) values('01000000-0000-4000-8000-000000000007','rooms-no-membership@example.test',now());
select extensions.is((select count(*) from pg_temp.rooms_as('01000000-0000-4000-8000-000000000007')),0::bigint,'non-member cannot read room table');
select extensions.is(jsonb_array_length(pg_temp.assignments_as('01000000-0000-4000-8000-000000000007')),0,'non-member cannot read room RPC');
select extensions.throws_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000007',
 'insert into public.plannix_rooms(organisation_id,name) values(''11000000-0000-4000-8000-000000000001'',''Forbidden'')')$$,
'42501',null,'non-member cannot create a room');
select extensions.ok((select NOT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']
 from pg_proc where oid='public.plannix_get_timetable_room_assignments(uuid,uuid,uuid)'::regprocedure),'room RPC is stable invoker with empty search path');
select extensions.ok(not exists(select 1 from pg_proc p,lateral aclexplode(p.proacl) a
 where p.oid='public.plannix_get_timetable_room_assignments(uuid,uuid,uuid)'::regprocedure and a.grantee<>'postgres'::regrole
 and (a.grantee<>'authenticated'::regrole or a.is_grantable)),'room RPC has only non-delegable authenticated execution outside owner');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000002','update public.plannix_rooms set name=''Forbidden'' where id=''91000000-0000-4000-8000-000000000006''')$$,'role 2 update is filtered by RLS');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000002','delete from public.plannix_rooms where id=''91000000-0000-4000-8000-000000000006''')$$,'role 2 delete is filtered by RLS');
select extensions.is((select name from public.plannix_rooms where id='91000000-0000-4000-8000-000000000006'),'Archived new assignments','role 2 cannot alter archived room');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000003','update public.plannix_rooms set name=''Forbidden'' where id=''91000000-0000-4000-8000-000000000006''')$$,'role 3 update is filtered by RLS');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000003','delete from public.plannix_rooms where id=''91000000-0000-4000-8000-000000000006''')$$,'role 3 delete is filtered by RLS');
select extensions.is((select name from public.plannix_rooms where id='91000000-0000-4000-8000-000000000006'),'Archived new assignments','role 3 cannot alter archived room');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000004','update public.plannix_rooms set name=''Forbidden'' where id=''91000000-0000-4000-8000-000000000006''')$$,'role 4 update is filtered by RLS');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000004','delete from public.plannix_rooms where id=''91000000-0000-4000-8000-000000000006''')$$,'role 4 delete is filtered by RLS');
select extensions.is((select name from public.plannix_rooms where id='91000000-0000-4000-8000-000000000006'),'Archived new assignments','role 4 cannot alter archived room');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000005','update public.plannix_rooms set name=''Forbidden'' where id=''91000000-0000-4000-8000-000000000006''')$$,'role 5 update is filtered by RLS');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000005','delete from public.plannix_rooms where id=''91000000-0000-4000-8000-000000000006''')$$,'role 5 delete is filtered by RLS');
select extensions.is((select name from public.plannix_rooms where id='91000000-0000-4000-8000-000000000006'),'Archived new assignments','role 5 cannot alter archived room');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000007','update public.plannix_rooms set name=''Forbidden'' where id=''91000000-0000-4000-8000-000000000006''')$$,'role 7 update is filtered by RLS');
select extensions.lives_ok($$select pg_temp.run_as('01000000-0000-4000-8000-000000000007','delete from public.plannix_rooms where id=''91000000-0000-4000-8000-000000000006''')$$,'role 7 delete is filtered by RLS');
select extensions.is((select name from public.plannix_rooms where id='91000000-0000-4000-8000-000000000006'),'Archived new assignments','role 7 cannot alter archived room');

select * from extensions.finish();
rollback;
