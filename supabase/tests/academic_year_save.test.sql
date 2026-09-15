begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(43);

create function pg_temp.save_academic_year_as(
  fixture_user_id uuid,
  fixture_organisation_id uuid,
  fixture_academic_year_id uuid,
  fixture_name text,
  fixture_start_date date,
  fixture_end_date date,
  fixture_holidays jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  result_id uuid;
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    coalesce(fixture_user_id::text, ''),
    true
  );
  execute 'set local role authenticated';
  select public.plannix_save_academic_year(
    fixture_organisation_id,
    fixture_academic_year_id,
    fixture_name,
    fixture_start_date,
    fixture_end_date,
    fixture_holidays
  ) into result_id;
  execute 'reset role';
  return result_id;
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create function pg_temp.save_academic_year_as_anon()
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute 'set local role anon';
  perform public.plannix_save_academic_year(
    '50000000-0000-0000-0000-000000000001',
    null,
    'Blocked',
    '2026-09-01',
    '2027-08-31',
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
  '00000000-0000-0000-0000-000000000000'::uuid,
  fixture.id,
  'authenticated',
  'authenticated',
  fixture.email,
  '',
  case when fixture.confirmed then now() else null end,
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('first_name', fixture.first_name, 'last_name', 'Fixture'),
  now(),
  now()
from (
  values
    ('40000000-0000-0000-0000-000000000001'::uuid, 'admin@example.test', 'Admin', true),
    ('40000000-0000-0000-0000-000000000002'::uuid, 'staff@example.test', 'Staff', true),
    ('40000000-0000-0000-0000-000000000003'::uuid, 'readonly@example.test', 'ReadOnly', true),
    ('40000000-0000-0000-0000-000000000004'::uuid, 'student@example.test', 'Student', true),
    ('40000000-0000-0000-0000-000000000005'::uuid, 'otheradmin@example.test', 'OtherAdmin', true),
    ('40000000-0000-0000-0000-000000000006'::uuid, 'unconfirmed@example.test', 'Unconfirmed', false)
) as fixture(id, email, first_name, confirmed);

insert into public.plannix_organisations (id, name, organisation_type)
values
  ('50000000-0000-0000-0000-000000000001', 'First organisation', 'school'),
  ('50000000-0000-0000-0000-000000000002', 'Second organisation', 'school');

insert into public.plannix_organisation_users (id, organisation_id, user_id)
values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003'),
  ('60000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000005'),
  ('60000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000006');

insert into public.plannix_organisation_user_access_roles (
  organisation_user_id,
  access_role_id
)
select fixture.membership_id, access_role.id
from (
  values
    ('60000000-0000-0000-0000-000000000001'::uuid, 'Organisation Admin'),
    ('60000000-0000-0000-0000-000000000002'::uuid, 'Staff'),
    ('60000000-0000-0000-0000-000000000003'::uuid, 'Read Only'),
    ('60000000-0000-0000-0000-000000000004'::uuid, 'Student'),
    ('60000000-0000-0000-0000-000000000005'::uuid, 'Organisation Admin'),
    ('60000000-0000-0000-0000-000000000006'::uuid, 'Organisation Admin')
) as fixture(membership_id, role_name)
join public.plannix_access_roles as access_role
  on access_role.name = fixture.role_name;

select extensions.is(
  pg_catalog.pg_get_function_arguments(
    'public.plannix_save_academic_year(uuid,uuid,text,date,date,jsonb)'::regprocedure
  ),
  'target_organisation_id uuid, target_academic_year_id uuid, target_name text, target_start_date date, target_end_date date, target_holidays jsonb',
  'the RPC has exactly the intended six arguments'
);

select extensions.is(
  pg_catalog.pg_get_function_result(
    'public.plannix_save_academic_year(uuid,uuid,text,date,date,jsonb)'::regprocedure
  ),
  'uuid',
  'the RPC returns only the authoritative academic-year UUID'
);

select extensions.is(
  (
    select routine.security_type
    from information_schema.routines as routine
    where routine.specific_schema = 'public'
      and routine.routine_name = 'plannix_save_academic_year'
  ),
  'INVOKER',
  'the data-writing RPC is SECURITY INVOKER'
);

select extensions.is(
  (
    select function_definition.proconfig[1]
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname = 'plannix_save_academic_year'
  ),
  'search_path=""',
  'the RPC has an empty search path'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    cross join lateral pg_catalog.aclexplode(function_definition.proacl) as function_acl
    where function_schema.nspname = 'public'
      and function_definition.proname = 'plannix_save_academic_year'
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the RPC'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.plannix_save_academic_year(uuid,uuid,text,date,date,jsonb)',
    'EXECUTE'
  ),
  'anon cannot execute the RPC'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.plannix_save_academic_year(uuid,uuid,text,date,date,jsonb)',
    'EXECUTE'
  ),
  'authenticated may execute the RPC subject to its checks and RLS'
);

select extensions.ok(
  position(
    'service_role' in pg_catalog.pg_get_functiondef(
      'public.plannix_save_academic_year(uuid,uuid,text,date,date,jsonb)'::regprocedure
    )
  ) = 0,
  'the RPC has no service-role dependency'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as_anon()$$,
  '42501',
  null,
  'anon execution is rejected by privileges'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as(null, '50000000-0000-0000-0000-000000000001', null, 'Missing auth', '2026-09-01', '2027-08-31', '[]')$$,
  '42501',
  'Authentication is required.',
  'a missing auth.uid() is rejected'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000001', null, 'Unconfirmed', '2026-09-01', '2027-08-31', '[]')$$,
  '42501',
  'Email confirmation is required.',
  'an unconfirmed caller is rejected'
);

create temporary table academic_year_result (key text primary key, id uuid not null);

insert into academic_year_result
values (
  'first',
  pg_temp.save_academic_year_as(
    '40000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    null,
    '2026 / 2027',
    '2026-09-01',
    '2027-08-31',
    '[
      {"id":"70000000-0000-0000-0000-000000000001","name":"Autumn break","start_date":"2026-10-26","end_date":"2026-10-30"},
      {"id":"70000000-0000-0000-0000-000000000002","name":"Winter break","start_date":"2026-12-21","end_date":"2027-01-01"}
    ]'
  )
);

select extensions.ok(
  (select id is not null from academic_year_result where key = 'first'),
  'an Organisation Admin creates an academic year'
);

select extensions.is(
  (
    select name
    from public.plannix_academic_years
    where id = (select id from academic_year_result where key = 'first')
  ),
  '2026 / 2027',
  'the academic-year values are stored'
);

select extensions.is(
  (
    select count(*)::integer
    from public.plannix_holidays
    where academic_year_id = (select id from academic_year_result where key = 'first')
  ),
  2,
  'the complete initial holiday collection is inserted'
);

select extensions.is(
  (
    select count(*)::integer
    from public.plannix_holidays
    where id in (
      '70000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000002'
    )
  ),
  2,
  'caller-supplied holiday UUIDs remain stable'
);

select extensions.is(
  pg_temp.save_academic_year_as(
    '40000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    (select id from academic_year_result where key = 'first'),
    '2026-2027 updated',
    '2026-09-01',
    '2027-08-31',
    '[
      {"id":"70000000-0000-0000-0000-000000000001","name":"Updated autumn break","start_date":"2026-10-27","end_date":"2026-10-30"},
      {"id":"70000000-0000-0000-0000-000000000003","name":"Spring break","start_date":"2027-04-05","end_date":"2027-04-16"}
    ]'
  ),
  (select id from academic_year_result where key = 'first'),
  'updating returns the stable academic-year UUID'
);

select extensions.is(
  (select name from public.plannix_academic_years where id = (select id from academic_year_result where key = 'first')),
  '2026-2027 updated',
  'an Organisation Admin updates the existing academic year'
);

select extensions.is(
  (select name from public.plannix_holidays where id = '70000000-0000-0000-0000-000000000001'),
  'Updated autumn break',
  'an existing holiday is updated in place'
);

select extensions.ok(
  not exists (select 1 from public.plannix_holidays where id = '70000000-0000-0000-0000-000000000002'),
  'a holiday omitted from the complete collection is removed'
);

select extensions.ok(
  exists (select 1 from public.plannix_holidays where id = '70000000-0000-0000-0000-000000000003'),
  'a new holiday is inserted with its stable UUID'
);

insert into academic_year_result
values (
  'second',
  pg_temp.save_academic_year_as(
    '40000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    null,
    '2027-2028',
    '2027-09-01',
    '2028-08-31',
    '[{"id":"70000000-0000-0000-0000-000000000004","name":"Second-year holiday","start_date":"2027-12-20","end_date":"2027-12-31"}]'
  )
);

select extensions.isnt(
  (select id from academic_year_result where key = 'second'),
  (select id from academic_year_result where key = 'first'),
  'multiple years in one organisation have different stable UUIDs'
);

select extensions.is(
  (select count(*)::integer from public.plannix_academic_years where organisation_id = '50000000-0000-0000-0000-000000000001'),
  2,
  'one organisation may contain multiple academic years'
);

insert into academic_year_result
values (
  'other',
  pg_temp.save_academic_year_as(
    '40000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000002',
    null,
    'Other organisation year',
    '2026-09-01',
    '2027-08-31',
    '[{"id":"70000000-0000-0000-0000-000000000005","name":"Other holiday","start_date":"2026-12-21","end_date":"2027-01-01"}]'
  )
);

select extensions.ok(
  (select id is not null from academic_year_result where key = 'other'),
  'another Organisation Admin creates a year in their organisation'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', null, 'Attack', '2026-09-01', '2027-08-31', '[]')$$,
  '42501',
  'Organisation Admin access is required.',
  'an admin cannot write another organisation'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', (select id from academic_year_result where key = 'other'), 'Foreign year', '2026-09-01', '2027-08-31', '[]')$$,
  '22023',
  'The academic year does not belong to the selected organisation.',
  'an academic-year UUID from another organisation is rejected'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', null, 'Staff year', '2026-09-01', '2027-08-31', '[]')$$,
  '42501', 'Organisation Admin access is required.', 'Staff cannot save academic years'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', null, 'Read Only year', '2026-09-01', '2027-08-31', '[]')$$,
  '42501', 'Organisation Admin access is required.', 'Read Only cannot save academic years'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001', null, 'Student year', '2026-09-01', '2027-08-31', '[]')$$,
  '42501', 'Organisation Admin access is required.', 'Student cannot save academic years'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', (select id from academic_year_result where key = 'first'), 'Duplicate holidays', '2026-09-01', '2027-08-31', '[{"id":"70000000-0000-0000-0000-000000000001","name":"A","start_date":"2026-10-01","end_date":"2026-10-02"},{"id":"70000000-0000-0000-0000-000000000001","name":"B","start_date":"2026-11-01","end_date":"2026-11-02"}]')$$,
  '22023', 'Holiday IDs must be unique.', 'duplicate holiday UUIDs are rejected'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', (select id from academic_year_result where key = 'first'), 'Foreign holiday', '2026-09-01', '2027-08-31', '[{"id":"70000000-0000-0000-0000-000000000004","name":"Foreign","start_date":"2026-10-01","end_date":"2026-10-02"}]')$$,
  '22023', 'A holiday ID belongs to another academic year.', 'a holiday UUID from another academic year is rejected'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null, 'Invalid dates', '2027-08-31', '2026-09-01', '[]')$$,
  '22023', 'Academic-year dates are invalid.', 'reversed academic-year dates are rejected'
);

select extensions.throws_ok(
  $$select public.plannix_save_academic_year('50000000-0000-0000-0000-000000000001', null, 'Invalid date', 'not-a-date', '2027-08-31', '[]')$$,
  '22007',
  null,
  'syntactically invalid dates are rejected by the typed RPC boundary'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null, 'Invalid holiday', '2026-09-01', '2027-08-31', '[{"name":"Invalid","start_date":"2026-10-02","end_date":"2026-10-01"}]')$$,
  '22023', 'Holiday dates must fall within the academic year.', 'reversed holiday dates are rejected'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null, 'Outside holiday', '2026-09-01', '2027-08-31', '[{"name":"Outside","start_date":"2027-08-30","end_date":"2027-09-01"}]')$$,
  '22023', 'Holiday dates must fall within the academic year.', 'holidays outside year boundaries are rejected'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null, 'Too many', '2026-09-01', '2027-08-31', (select jsonb_agg(jsonb_build_object('name', 'Holiday ' || value, 'start_date', '2026-10-01', 'end_date', '2026-10-01')) from generate_series(1, 101) as value))$$,
  '22023', 'No more than 100 holidays may be saved.', 'excessive holiday counts are rejected'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null, repeat('Y', 201), '2026-09-01', '2027-08-31', '[]')$$,
  '22023', 'Academic-year name must contain between 1 and 200 characters.', 'oversized academic-year names are rejected'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', null, 'Holiday name', '2026-09-01', '2027-08-31', jsonb_build_array(jsonb_build_object('name', repeat('H', 201), 'start_date', '2026-10-01', 'end_date', '2026-10-01')))$$,
  '22023', 'Holiday names must contain between 1 and 200 characters.', 'oversized holiday names are rejected'
);

select extensions.is(
  (select name from public.plannix_academic_years where id = (select id from academic_year_result where key = 'second')),
  '2027-2028',
  'an unrelated academic year remains unchanged'
);

select extensions.is(
  (select name from public.plannix_holidays where id = '70000000-0000-0000-0000-000000000004'),
  'Second-year holiday',
  'an unrelated holiday remains unchanged'
);

select extensions.throws_ok(
  $$select pg_temp.save_academic_year_as('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', (select id from academic_year_result where key = 'first'), 'Should roll back', '2026-09-01', '2027-08-31', '[{"id":"70000000-0000-0000-0000-000000000005","name":"Collision","start_date":"2026-10-01","end_date":"2026-10-02"}]')$$,
  '23505',
  null,
  'a reconciliation collision fails the complete RPC statement'
);

select extensions.is(
  (select name from public.plannix_academic_years where id = (select id from academic_year_result where key = 'first')),
  '2026-2027 updated',
  'the parent update rolls back after reconciliation failure'
);

select extensions.ok(
  exists (select 1 from public.plannix_holidays where id = '70000000-0000-0000-0000-000000000001'),
  'the prior holiday collection survives reconciliation rollback'
);

select extensions.is(
  (select count(*)::integer from public.plannix_academic_years where organisation_id = '50000000-0000-0000-0000-000000000002'),
  1,
  'organisation isolation preserves the other organisation year'
);

select * from extensions.finish();

rollback;
