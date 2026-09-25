begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(84);

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

select extensions.has_column('public','plannix_timetables','sessions_revision','sessions revision exists');
select extensions.col_type_is('public','plannix_timetables','sessions_revision','bigint','sessions revision is bigint');
select extensions.col_not_null('public','plannix_timetables','sessions_revision','sessions revision is required');
select extensions.col_default_is('public','plannix_timetables','sessions_revision','0','sessions revision defaults zero');
select extensions.has_table('public','plannix_timetable_session_collections','collection table exists');
select extensions.has_pk('public','plannix_timetable_session_collections','collection table has stable primary key');
select extensions.has_column('public','plannix_timetable_sessions','collection_id','sessions reference collections');
select extensions.col_not_null('public','plannix_timetable_sessions','collection_id','collection reference is required');
select extensions.has_column('public','plannix_timetable_sessions','timetable_week_id','sessions retain authoritative week identity for layout compatibility');
select extensions.is((select delete_rule from information_schema.referential_constraints where constraint_name='fk_plannix_timetable_sessions_week'),'RESTRICT','session week references remain restrictive');
select extensions.ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='plannix_timetable_sessions' and column_name in ('layout_key','week_key','meta','teacher','time','class_name')),'legacy identity and free-text fields are absent');
select extensions.is((select routine.security_type from information_schema.routines as routine where routine.specific_schema='public' and routine.routine_name='plannix_apply_timetable_session_batch'),'INVOKER','batch is security invoker');
select extensions.is(pg_catalog.pg_get_function_result('public.plannix_get_dated_timetable_sessions(uuid,uuid,uuid,date)'::regprocedure),'TABLE(revision bigint, week_start_date date, repeating_week_id uuid, source text, override_exists boolean, collection_id uuid, sessions jsonb)','dated read shape is exact');
select extensions.ok(not pg_catalog.has_function_privilege('anon','public.plannix_apply_timetable_session_batch(uuid,uuid,uuid,bigint,jsonb)','EXECUTE'),'anon cannot mutate');
select extensions.ok(pg_catalog.has_function_privilege('authenticated','public.plannix_apply_timetable_session_batch(uuid,uuid,uuid,bigint,jsonb)','EXECUTE'),'authenticated may invoke under RLS');

select extensions.throws_ok($$select * from pg_temp.call_batch(null,0,'[]')$$,'42501','Authentication is required.','missing authentication rejected');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000006',0,'[]')$$,'42501','Email confirmation is required.','unconfirmed rejected');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000002',0,'[]')$$,'42501','Organisation Admin access is required.','Staff write denied');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000003',0,'[]')$$,'42501','Organisation Admin access is required.','Read Only write denied');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000004',0,'[]')$$,'42501','Organisation Admin access is required.','Student write denied');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000005',0,'[]')$$,'42501','Organisation Admin access is required.','unrelated admin denied');

select extensions.is(private.plannix_resolve_timetable_week('31000000-0000-4000-8000-000000000001','2026-12-28'), '32000000-0000-4000-8000-000000000001'::uuid,'first teaching week is A across ISO boundary');
select extensions.is(private.plannix_resolve_timetable_week('31000000-0000-4000-8000-000000000001','2027-01-04'), '32000000-0000-4000-8000-000000000001'::uuid,'full overlapping holiday week pauses cycle');
select extensions.is(private.plannix_resolve_timetable_week('31000000-0000-4000-8000-000000000001','2027-01-11'), '32000000-0000-4000-8000-000000000002'::uuid,'week after full closure is B and partial closure advances');
select extensions.is(private.plannix_resolve_timetable_week('31000000-0000-4000-8000-000000000001','2027-01-18'), '32000000-0000-4000-8000-000000000001'::uuid,'following teaching week returns to A');

create temporary table first_save as select * from pg_temp.call_batch(
 '01000000-0000-4000-8000-000000000001',0,
 '[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Algebra","notes":"Intro"}]}]'::jsonb);
select extensions.is((select revision from first_save),1::bigint,'first mutation increments once');
select extensions.is((select count(*)::integer from public.plannix_timetable_session_collections where collection_type='recurring'),1,'Week A collection created');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions),1,'Week A session created');
create temporary table stable_session as select id,collection_id from public.plannix_timetable_sessions;
select extensions.throws_ok(
  $$
    update public.plannix_timetable_sessions
    set timetable_week_id = '32000000-0000-4000-8000-000000000002'
    where id = (select id from stable_session)
  $$,
  '23514',
  'Timetable session collection and week do not match.',
  'the compatibility week mirror cannot diverge from its authoritative collection'
);

create temporary table second_save as select * from pg_temp.call_batch(
 '01000000-0000-4000-8000-000000000001',1,
 pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('type','recurring','weekId','32000000-0000-4000-8000-000000000001','sessions',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',(select id from stable_session),'day',0,'periodId','33000000-0000-4000-8000-000000000001','classId','41000000-0000-4000-8000-000000000001','title','Changed','notes','Changed')))));
select extensions.is((select revision from second_save),2::bigint,'update increments exactly once');
select extensions.is((select id from public.plannix_timetable_sessions),(select id from stable_session),'session UUID is stable');
select extensions.is((select collection_id from public.plannix_timetable_sessions),(select collection_id from stable_session),'collection UUID is stable');

create temporary table boundary_save as select * from pg_temp.call_batch(
 '01000000-0000-4000-8000-000000000001',2,
 '[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000002","sessions":[{"day":1,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"","notes":""}]}]'::jsonb);
select extensions.is((select revision from boundary_save),3::bigint,'Week B save reaches exact frequency boundary');
select extensions.is((select count(*)::integer from public.plannix_timetable_session_collections where collection_type='recurring'),2,'both recurring weeks exist');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',3,
 '[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000002","sessions":[{"day":1,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000001","title":"","notes":""},{"day":2,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"","notes":""}]}]')$$,'23514','TIMETABLE_CLASS_FREQUENCY_EXCEEDED','frequency excess across A and B rejected');
select extensions.is((select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),3::bigint,'failed frequency mutation leaves revision unchanged');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions),2,'failed frequency mutation rolls back sessions');

create temporary table dated_save as select * from pg_temp.call_dated(
 '01000000-0000-4000-8000-000000000001','2027-01-11',3,
 '[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Override","notes":"Dated"}]');
select extensions.is((select revision from dated_save),4::bigint,'dated override increments revision');
select extensions.is((select repeating_week_id from dated_save),'32000000-0000-4000-8000-000000000002'::uuid,'database derives dated repeating week');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions),3,'dated override is excluded from frequency limit');
create temporary table dated_ids as select collection_id,(sessions->0->>'id')::uuid as session_id from dated_save;
create temporary table dated_update as select * from pg_temp.call_dated(
 '01000000-0000-4000-8000-000000000001','2027-01-11',4,
 pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',(select session_id from dated_ids),'day',0,'periodId','33000000-0000-4000-8000-000000000001','classId','41000000-0000-4000-8000-000000000001','title','Updated','notes','')));
select extensions.is((select collection_id from dated_update),(select collection_id from dated_ids),'dated collection UUID stable');
select extensions.is(((select sessions from dated_update)->0->>'id')::uuid,(select session_id from dated_ids),'dated session UUID stable');

create temporary table empty_override as select * from pg_temp.call_dated(
 '01000000-0000-4000-8000-000000000001','2027-01-11',5,'[]');
select extensions.is((select sessions from empty_override),'[]'::jsonb,'empty override persists empty');
select extensions.ok((select override_exists and source='override' and sessions='[]'::jsonb from pg_temp.call_effective('01000000-0000-4000-8000-000000000001','2027-01-11')),'effective read distinguishes empty override');

select extensions.ok((select source='recurring' and not override_exists and collection_id is null
  from pg_temp.call_effective('01000000-0000-4000-8000-000000000001','2027-01-18')),'missing override inherits recurring');
select extensions.ok((select sessions @> '[{"title":"","notes":""}]'::jsonb
  from pg_temp.call_effective('01000000-0000-4000-8000-000000000001','2027-01-18')),'inherited title and notes are blank');
select extensions.ok((select not (sessions->0 ? 'id')
  from pg_temp.call_effective('01000000-0000-4000-8000-000000000001','2027-01-18')),'inherited entries have no fake session ID');

select pg_catalog.set_config('request.jwt.claim.sub','01000000-0000-4000-8000-000000000001',true);
set local role authenticated;
create temporary table removed_override as select * from public.plannix_remove_dated_timetable_override(
 '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
 '31000000-0000-4000-8000-000000000001','2027-01-11',6);
reset role;
select extensions.ok((select source='recurring' and not override_exists from removed_override),'override deletion restores inheritance');
select extensions.is((select count(*)::integer from public.plannix_timetable_session_collections where collection_type='recurring'),2,'override deletion preserves recurring collections');
select extensions.is((select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),7::bigint,'override removal increments once');

select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',6,'[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[]}]')$$,'40001','TIMETABLE_SESSIONS_REVISION_CONFLICT','stale revision rejected');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',7,'[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000003","classId":"41000000-0000-4000-8000-000000000002","title":"","notes":""}]}]')$$,'22023','Session period must be an enabled teaching period.','non-teaching period rejected');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',7,'[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":5,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000002","title":"","notes":""}]}]')$$,'22023','Session day must be an integer from 0 to 4.','invalid day rejected');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',7,'[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000003","title":"","notes":""}]}]')$$,'22023','Session class is unavailable for this academic year.','foreign class rejected');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',7,'[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000004","classId":"41000000-0000-4000-8000-000000000002","title":"","notes":""}]}]')$$,'22023','Session period must be an enabled teaching period.','foreign period rejected');
select extensions.throws_ok($$select * from pg_temp.call_dated('01000000-0000-4000-8000-000000000001','2027-01-12',7,'[]')$$,'22023','Week start date is outside the timetable.','non-Monday date rejected');

create temporary table batch_success as select * from pg_temp.call_batch(
 '01000000-0000-4000-8000-000000000001',7,
 '[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000002","title":"A","notes":""}]},{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000002","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000002","title":"B","notes":""}]}]');
select extensions.is((select revision from batch_success),8::bigint,'multi-collection batch increments once');
select extensions.is(pg_catalog.jsonb_array_length((select collections from batch_success)),2,'batch returns both authoritative collections');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions where class_id='41000000-0000-4000-8000-000000000002'),2,'batch applies all replacements');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',8,'[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[]},{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000002","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000004","classId":"41000000-0000-4000-8000-000000000002","title":"","notes":""}]}]')$$,'22023','Session period must be an enabled teaching period.','failed multi-collection batch rolls back everything');
select extensions.is((select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),8::bigint,'failed batch leaves revision unchanged');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions where class_id='41000000-0000-4000-8000-000000000002'),2,'failed batch preserves all sessions');
select extensions.is((select count(*)::integer from public.plannix_timetables where id='31000000-0000-4000-8000-000000000002'),1,'unrelated timetable preserved');

select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',8,
 '[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[]},{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[]}]')$$,
 '22023','Session mutation targets must be unique.','one batch cannot replace the same collection twice');
select extensions.is((select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),8::bigint,'duplicate mutation targets roll back without a revision change');
select extensions.throws_ok($$select * from pg_temp.call_batch('01000000-0000-4000-8000-000000000001',8,
 '[{"type":"recurring","weekId":"32000000-0000-4000-8000-000000000001","sessions":[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000002","title":"","notes":""},{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000002","title":"","notes":""}]}]')$$,
 '22023','Timetable session slots must be unique.','identical duplicate slot entries are rejected explicitly');

select pg_catalog.set_config('request.jwt.claim.sub','01000000-0000-4000-8000-000000000001',true);
set local role authenticated;
create temporary table absent_override_removal as select * from public.plannix_remove_dated_timetable_override(
 '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',
 '31000000-0000-4000-8000-000000000001','2027-01-11',8);
reset role;
select extensions.is((select revision from absent_override_removal),9::bigint,'an accepted override-removal mutation increments exactly once when already absent');
select extensions.ok((select source='recurring' and not override_exists from absent_override_removal),'removing an absent override remains idempotent in resulting state');

select extensions.ok((select count(*)=2 from public.plannix_timetable_session_collections where timetable_id='31000000-0000-4000-8000-000000000001'),'collection uniqueness prevents duplicates');
select extensions.is((select delete_rule from information_schema.referential_constraints where constraint_name='fk_plannix_timetable_sessions_collection'),'CASCADE','collection owns its sessions');
select extensions.is((select delete_rule from information_schema.referential_constraints where constraint_name='fk_plannix_session_teachers_session'),'CASCADE','teacher assignments remain attached to stable sessions');

-- Exercise the public save RPC against the real constraint/reconciler installed by
-- 20260924130000_allow_atomic_timetable_session_swaps.sql. The outer transaction
-- rolls back all fixtures; no migration is applied by this test.
create function pg_temp.call_swap_save(
  caller uuid, payload jsonb, expected bigint,
  organisation uuid default '11000000-0000-4000-8000-000000000001',
  academic_year uuid default '21000000-0000-4000-8000-000000000001'
) returns table (revision bigint, collection_id uuid, sessions jsonb)
language plpgsql set search_path='' as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(caller::text,''),true);
  execute 'set local role authenticated';
  return query select * from public.plannix_save_recurring_timetable_sessions(
    organisation,academic_year,'31000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001',expected,payload);
  execute 'reset role';
exception when others then execute 'reset role'; raise;
end;
$$;
create temporary table swap_before as select * from pg_temp.call_swap_save(
 '01000000-0000-4000-8000-000000000001',
 '[{"day":0,"periodId":"33000000-0000-4000-8000-000000000001","classId":"41000000-0000-4000-8000-000000000001","title":"Fractions","notes":"Rulers"},
   {"day":1,"periodId":"33000000-0000-4000-8000-000000000002","classId":"41000000-0000-4000-8000-000000000002","title":"Atoms","notes":"Models"}]',9);
create temporary table swap_payload as
select jsonb_agg(entry || jsonb_build_object(
  'day',case when entry->>'day'='0' then 1 else 0 end,
  'periodId',case when entry->>'day'='0' then '33000000-0000-4000-8000-000000000002' else '33000000-0000-4000-8000-000000000001' end
) order by entry->>'day') as sessions
from swap_before, jsonb_array_elements(sessions) as entry;
select extensions.lives_ok($$create temporary table swap_after as select * from pg_temp.call_swap_save(
 '01000000-0000-4000-8000-000000000001',(select sessions from swap_payload),10)$$,
 'public RPC atomically swaps two occupied slots');
select extensions.is((select revision from swap_after),11::bigint,'swap advances revision once');
select extensions.results_eq(
 $$select id from public.plannix_timetable_sessions where collection_id=(select collection_id from swap_after) order by id$$,
 $$select (entry->>'id')::uuid from swap_before,jsonb_array_elements(sessions) as entry order by 1$$,
 'both original session IDs survive');
select extensions.results_eq(
 $$select id,class_id,title,notes from public.plannix_timetable_sessions where collection_id=(select collection_id from swap_after) order by id$$,
 $$select (entry->>'id')::uuid,(entry->>'classId')::uuid,entry->>'title',entry->>'notes' from swap_before,jsonb_array_elements(sessions) as entry order by 1$$,
 'class IDs, titles and notes stay attached to each original session');
select extensions.results_eq(
 $$select id,day_number,period_id from public.plannix_timetable_sessions where collection_id=(select collection_id from swap_after) order by id$$,
 $$select (entry->>'id')::uuid,(entry->>'day')::integer + 1,(entry->>'periodId')::uuid from swap_payload,jsonb_array_elements(sessions) as entry order by 1$$,
 'both slot coordinates are exchanged');
select extensions.throws_ok($$select * from pg_temp.call_swap_save(
 '01000000-0000-4000-8000-000000000001',
 (select jsonb_agg(entry || '{"day":0,"periodId":"33000000-0000-4000-8000-000000000001"}'::jsonb)
  from swap_after,jsonb_array_elements(sessions) as entry),11)$$,
 '22023','Timetable session slots must be unique.','duplicate final coordinates remain rejected');
select extensions.is((select sessions_revision from public.plannix_timetables where id='31000000-0000-4000-8000-000000000001'),11::bigint,
 'rejected duplicate collection does not advance revision');
select extensions.results_eq(
 $$select id,day_number,period_id from public.plannix_timetable_sessions where collection_id=(select collection_id from swap_after) order by id$$,
 $$select (entry->>'id')::uuid,(entry->>'day')::integer + 1,(entry->>'periodId')::uuid from swap_payload,jsonb_array_elements(sessions) as entry order by 1$$,
 'rejected save leaves the swapped collection intact');
select extensions.throws_ok($$select * from pg_temp.call_swap_save(null,'[]',11)$$,
 '42501','Authentication is required.','public save denies unauthenticated callers');
select extensions.throws_ok($$select * from pg_temp.call_swap_save('01000000-0000-4000-8000-000000000002','[]',11)$$,
 '42501','Organisation Admin access is required.','public save denies non-admin members');
select extensions.throws_ok($$select * from pg_temp.call_swap_save('01000000-0000-4000-8000-000000000005','[]',11)$$,
 '42501','Organisation Admin access is required.','another organisation admin cannot save this timetable');
select extensions.throws_ok($$select * from pg_temp.call_swap_save('01000000-0000-4000-8000-000000000001','[]',11,
 '11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000002')$$,
 'P0002','Timetable was not found.','public save enforces academic-year scope');
select extensions.throws_ok($$select * from pg_temp.call_swap_save('01000000-0000-4000-8000-000000000005','[]',11,
 '11000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002')$$,
 'P0002','Timetable was not found.','public save enforces timetable organisation scope');

select * from extensions.finish();
rollback;
