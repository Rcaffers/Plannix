begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(58);

create function pg_temp.save_classes_as(
  fixture_user_id uuid,
  fixture_organisation_id uuid,
  fixture_academic_year_id uuid,
  fixture_revision bigint,
  fixture_classes jsonb
)
returns table (revision bigint, classes jsonb)
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(fixture_user_id::text, ''), true);
  execute 'set local role authenticated';
  return query
  select * from public.plannix_save_classes(
    fixture_organisation_id,
    fixture_academic_year_id,
    fixture_revision,
    fixture_classes
  );
  execute 'reset role';
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create function pg_temp.save_classes_as_anon()
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute 'set local role anon';
  perform public.plannix_save_classes(
    '51000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000001',
    0,
    '[]'::jsonb
  );
  execute 'reset role';
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000'::uuid, fixture.id,
  'authenticated', 'authenticated', fixture.email, '',
  case when fixture.confirmed then now() else null end,
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('first_name', fixture.first_name, 'last_name', 'Fixture'),
  now(), now()
from (
  values
    ('41000000-0000-0000-0000-000000000001'::uuid, 'class-admin@example.test', 'Admin', true),
    ('41000000-0000-0000-0000-000000000002'::uuid, 'class-staff@example.test', 'Staff', true),
    ('41000000-0000-0000-0000-000000000003'::uuid, 'class-readonly@example.test', 'ReadOnly', true),
    ('41000000-0000-0000-0000-000000000004'::uuid, 'class-student@example.test', 'Student', true),
    ('41000000-0000-0000-0000-000000000005'::uuid, 'class-other@example.test', 'Other', true),
    ('41000000-0000-0000-0000-000000000006'::uuid, 'class-unconfirmed@example.test', 'Unconfirmed', false)
) as fixture(id, email, first_name, confirmed);

insert into public.plannix_organisations (id, name, organisation_type)
values
  ('51000000-0000-0000-0000-000000000001', 'Class organisation one', 'school'),
  ('51000000-0000-0000-0000-000000000002', 'Class organisation two', 'school');

insert into public.plannix_organisation_users (id, organisation_id, user_id)
values
  ('61000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001'),
  ('61000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000002'),
  ('61000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000003'),
  ('61000000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000004'),
  ('61000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000005'),
  ('61000000-0000-0000-0000-000000000006', '51000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000006');

insert into public.plannix_organisation_user_access_roles (organisation_user_id, access_role_id)
select fixture.membership_id, access_role.id
from (
  values
    ('61000000-0000-0000-0000-000000000001'::uuid, 'Organisation Admin'),
    ('61000000-0000-0000-0000-000000000002'::uuid, 'Staff'),
    ('61000000-0000-0000-0000-000000000003'::uuid, 'Read Only'),
    ('61000000-0000-0000-0000-000000000004'::uuid, 'Student'),
    ('61000000-0000-0000-0000-000000000005'::uuid, 'Organisation Admin'),
    ('61000000-0000-0000-0000-000000000006'::uuid, 'Organisation Admin')
) as fixture(membership_id, role_name)
join public.plannix_access_roles as access_role on access_role.name = fixture.role_name;

insert into public.plannix_academic_years (id, organisation_id, name, start_date, end_date)
values
  ('71000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'Primary year', '2026-09-01', '2027-08-31'),
  ('71000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000001', 'Unrelated year', '2027-09-01', '2028-08-31'),
  ('71000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000002', 'Other organisation year', '2026-09-01', '2027-08-31');

select extensions.is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'plannix_classes' and column_name = 'frequency'), 'smallint', 'frequency is SMALLINT');
select extensions.is((select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'plannix_classes' and column_name = 'frequency'), 'NO', 'frequency is NOT NULL');
select extensions.is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'plannix_classes' and column_name = 'frequency'), '1', 'frequency defaults to one');
select extensions.ok(exists (select 1 from pg_constraint where conname = 'chk_plannix_classes_frequency'), 'frequency constraint exists');
select extensions.ok(exists (select 1 from pg_constraint where conname = 'chk_plannix_classes_sort_order'), 'sort-order constraint exists');
select extensions.is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'plannix_academic_years' and column_name = 'classes_revision'), 'bigint', 'revision is BIGINT');
select extensions.is((select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'plannix_academic_years' and column_name = 'classes_revision'), 'NO', 'revision is NOT NULL');
select extensions.is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'plannix_academic_years' and column_name = 'classes_revision'), '0', 'revision defaults to zero');
select extensions.ok(exists (select 1 from pg_constraint where conname = 'chk_plannix_academic_years_classes_revision'), 'revision constraint exists');
select extensions.is(pg_get_function_arguments('public.plannix_save_classes(uuid,uuid,bigint,jsonb)'::regprocedure), 'target_organisation_id uuid, target_academic_year_id uuid, expected_revision bigint, target_classes jsonb', 'RPC has the exact four arguments');
select extensions.is(pg_get_function_result('public.plannix_save_classes(uuid,uuid,bigint,jsonb)'::regprocedure), 'TABLE(revision bigint, classes jsonb)', 'RPC returns revision and classes only');
select extensions.is((select security_type from information_schema.routines where routine_schema = 'public' and routine_name = 'plannix_save_classes'), 'INVOKER', 'RPC is SECURITY INVOKER');
select extensions.is((select proconfig[1] from pg_proc where oid = 'public.plannix_save_classes(uuid,uuid,bigint,jsonb)'::regprocedure), 'search_path=""', 'RPC has an empty search path');
select extensions.ok(not exists (select 1 from pg_proc cross join lateral aclexplode(coalesce(proacl, acldefault('f', proowner))) acl where oid = 'public.plannix_save_classes(uuid,uuid,bigint,jsonb)'::regprocedure and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), 'PUBLIC cannot execute the RPC');
select extensions.ok(not has_function_privilege('anon', 'public.plannix_save_classes(uuid,uuid,bigint,jsonb)', 'EXECUTE'), 'anon cannot execute the RPC');
select extensions.ok(has_function_privilege('authenticated', 'public.plannix_save_classes(uuid,uuid,bigint,jsonb)', 'EXECUTE'), 'authenticated can execute the RPC');
select extensions.throws_ok($$select pg_temp.save_classes_as_anon()$$, '42501', null, 'anon execution is rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as(null, '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 0, '[]')$$, '42501', 'Authentication is required.', 'missing authentication is rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000006', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 0, '[]')$$, '42501', 'Email confirmation is required.', 'unconfirmed authentication is rejected');

select extensions.lives_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 0, '[{"name":"Alpha","frequency":1},{"id":"81000000-0000-0000-0000-000000000002","name":"Beta","frequency":50}]')$$, 'admin can create classes at both frequency boundaries');
select extensions.is((select classes_revision from public.plannix_academic_years where id = '71000000-0000-0000-0000-000000000001'), 1::bigint, 'successful creation increments revision once');
select extensions.is((select count(*)::integer from public.plannix_classes where academic_year_id = '71000000-0000-0000-0000-000000000001'), 2, 'two classes are created');
select extensions.ok((select id is not null from public.plannix_classes where name = 'Alpha'), 'a missing ID receives an authoritative UUID');
select extensions.results_eq($$select name from public.plannix_classes where academic_year_id = '71000000-0000-0000-0000-000000000001' order by sort_order$$, $$values ('Alpha'::text), ('Beta'::text)$$, 'class ordering follows array position');
select extensions.results_eq($$select frequency from public.plannix_classes where academic_year_id = '71000000-0000-0000-0000-000000000001' order by sort_order$$, $$values (1::smallint), (50::smallint)$$, 'frequency boundaries are persisted');

create temporary table saved_class_ids as
select name, id from public.plannix_classes where academic_year_id = '71000000-0000-0000-0000-000000000001';

select extensions.lives_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 1, jsonb_build_array(jsonb_build_object('id',(select id from saved_class_ids where name='Beta'),'name','Beta renamed','frequency',4),jsonb_build_object('id',(select id from saved_class_ids where name='Alpha'),'name','Alpha renamed','frequency',3)))$$, 'admin can rename, reorder and update frequency');
select extensions.is((select classes_revision from public.plannix_academic_years where id = '71000000-0000-0000-0000-000000000001'), 2::bigint, 'update increments revision once');
select extensions.results_eq($$select id from public.plannix_classes where academic_year_id = '71000000-0000-0000-0000-000000000001' order by sort_order$$, $$select id from saved_class_ids order by case name when 'Beta' then 0 else 1 end$$, 'rename and reorder preserve stable IDs');
select extensions.results_eq($$select name from public.plannix_classes where academic_year_id = '71000000-0000-0000-0000-000000000001' order by sort_order$$, $$values ('Beta renamed'::text), ('Alpha renamed'::text)$$, 'renamed classes remain deterministically ordered');
select extensions.is((select frequency from public.plannix_classes where name = 'Beta renamed'), 4::smallint, 'frequency updates in place');

select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[]')$$, '42501', 'Organisation Admin access is required.', 'Staff cannot save');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[]')$$, '42501', 'Organisation Admin access is required.', 'Read Only cannot save');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[]')$$, '42501', 'Organisation Admin access is required.', 'Student cannot save');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[]')$$, '42501', 'Organisation Admin access is required.', 'an unrelated admin cannot save');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001', 2, '[]')$$, '42501', 'Organisation Admin access is required.', 'organisation mismatch is rejected');

select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[{"name":"Zero","frequency":0}]')$$, '22023', 'Class frequency must be an integer from 1 to 50.', 'frequency zero is rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[{"name":"High","frequency":51}]')$$, '22023', 'Class frequency must be an integer from 1 to 50.', 'frequency 51 is rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[{"name":"Fraction","frequency":1.5}]')$$, '22023', 'Class frequency must be an integer from 1 to 50.', 'noninteger frequency is rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, null)$$, '22023', 'Classes must be supplied as an array.', 'missing class array is rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '{}')$$, '22023', 'Classes must be supplied as an array.', 'malformed class collection is rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, (select jsonb_agg(jsonb_build_object('name','Class '||n,'frequency',1)) from generate_series(1,61)n))$$, '22023', 'No more than 60 classes are allowed.', 'excessive class count is rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[{"name":"Unknown","frequency":1,"cadence":"week"}]')$$, '22023', 'A class contains unexpected fields.', 'unknown and cadence fields are rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[{"id":"81000000-0000-0000-0000-000000000009","name":"One","frequency":1},{"id":"81000000-0000-0000-0000-000000000009","name":"Two","frequency":1}]')$$, '22023', 'Class IDs must be unique.', 'duplicate IDs are rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[{"name":"Duplicate","frequency":1},{"name":"Duplicate","frequency":2}]')$$, '23505', 'Class names must be unique within an academic year.', 'duplicate names are rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, jsonb_build_array(jsonb_build_object('name',repeat('x',201),'frequency',1)))$$, '22023', 'Class names must contain between 1 and 200 characters.', 'oversized names are rejected');

insert into public.plannix_classes (id, organisation_id, academic_year_id, name, frequency, sort_order)
values
  ('81000000-0000-0000-0000-000000000010', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'Foreign year class', 1, 0),
  ('81000000-0000-0000-0000-000000000011', '51000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000003', 'Other organisation class', 1, 0);

select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[{"id":"81000000-0000-0000-0000-000000000010","name":"Foreign","frequency":1}]')$$, '42501', 'A class ID belongs to another academic year.', 'foreign academic-year class ID is rejected');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, '[{"id":"81000000-0000-0000-0000-000000000011","name":"Foreign","frequency":1}]')$$, '42501', 'A class ID belongs to another academic year.', 'foreign organisation class ID is rejected');

select extensions.lives_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 2, jsonb_build_array(jsonb_build_object('id',(select id from saved_class_ids where name='Beta'),'name','Beta renamed','frequency',4),jsonb_build_object('id',(select id from saved_class_ids where name='Alpha'),'name','Alpha renamed','frequency',3),jsonb_build_object('id','81000000-0000-0000-0000-000000000012','name','Unused','frequency',2)))$$, 'an unused class can be added');
select extensions.lives_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 3, jsonb_build_array(jsonb_build_object('id',(select id from saved_class_ids where name='Beta'),'name','Beta renamed','frequency',4),jsonb_build_object('id',(select id from saved_class_ids where name='Alpha'),'name','Alpha renamed','frequency',3)))$$, 'an omitted unused class can be removed');
select extensions.is((select count(*)::integer from public.plannix_classes where id = '81000000-0000-0000-0000-000000000012'), 0, 'the omitted unused class is deleted');

insert into public.plannix_timetables (id, organisation_id, academic_year_id, name, days_per_week, active_from, active_to)
values ('91000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'Fixture timetable', 5, '2026-09-01', '2027-08-31');
insert into public.plannix_timetable_weeks (id, timetable_id, code, name, sort_order)
values ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'A', 'Week A', 0);
insert into public.plannix_timetable_periods (id, timetable_id, period_number, label, start_time, end_time)
values ('93000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 1, 'Period 1', '09:00', '10:00');
insert into public.plannix_timetable_sessions (id, timetable_id, timetable_week_id, class_id, period_id, academic_year_id, organisation_id, day_number)
select '94000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', id, '93000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 1 from saved_class_ids where name = 'Alpha';

select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 4, jsonb_build_array(jsonb_build_object('id',(select id from saved_class_ids where name='Beta'),'name','Beta changed','frequency',5)))$$, '23503', 'A class with timetable placements cannot be removed.', 'a referenced omitted class is rejected');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions where id = '94000000-0000-0000-0000-000000000001'), 1, 'the referenced timetable session is preserved');
select extensions.is((select classes_revision from public.plannix_academic_years where id = '71000000-0000-0000-0000-000000000001'), 4::bigint, 'failed removal preserves revision');
select extensions.is((select name from public.plannix_classes where id = (select id from saved_class_ids where name='Beta')), 'Beta renamed', 'failed reconciliation rolls back earlier class changes');
select extensions.throws_ok($$select * from pg_temp.save_classes_as('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 3, '[]')$$, '40001', 'Class collection revision conflict.', 'stale revision is rejected');
select extensions.is((select count(*)::integer from public.plannix_classes where academic_year_id in ('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000003')), 2, 'unrelated years and organisations remain unchanged');
select extensions.ok(not exists (select 1 from information_schema.columns where table_schema='public' and table_name='plannix_classes' and column_name='cadence'), 'cadence is absent from the class schema');
select extensions.ok(position('cadence' in pg_get_function_arguments('public.plannix_save_classes(uuid,uuid,bigint,jsonb)'::regprocedure)) = 0, 'cadence is absent from the RPC signature');

select * from extensions.finish();
rollback;
