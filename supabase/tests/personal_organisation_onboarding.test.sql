begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(40);

-- Keep pgTAP itself under the test owner while making the RPC call as anon.
-- This avoids depending on application roles having USAGE or EXECUTE access to
-- the extensions schema. RESET ROLE runs on both paths before any error is
-- rethrown to throws_ok().
create function pg_temp.call_personal_organisation_onboarding_as_anon()
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute 'set local role anon';
  perform public.plannix_ensure_personal_organisation();
  execute 'reset role';
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create function pg_temp.call_personal_organisation_onboarding_as_authenticated(
  target_user_id uuid
)
returns table (
  organisation_id uuid,
  organisation_user_id uuid
)
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    coalesce(target_user_id::text, ''),
    true
  );
  execute 'set local role authenticated';
  return query
  select * from public.plannix_ensure_personal_organisation();
  execute 'reset role';
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

-- Stable fixture identifiers make failures easier to diagnose. Inserting into
-- auth.users exercises the real on_plannix_auth_user_created profile trigger.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'confirmed-one@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Confirmed","last_name":"One"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'confirmed-two@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Confirmed","last_name":"Two"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'unconfirmed@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Unconfirmed","last_name":"User"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000004',
    'authenticated',
    'authenticated',
    'missing-profile@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Missing","last_name":"Profile"}'::jsonb,
    now(),
    now()
  );

select extensions.ok(
  exists (
    select 1
    from public.plannix_users
    where id = '10000000-0000-0000-0000-000000000001'
      and first_name = 'Confirmed'
      and last_name = 'One'
  ),
  'the real auth.users trigger creates the first confirmed profile'
);

select extensions.ok(
  exists (
    select 1
    from public.plannix_users
    where id = '10000000-0000-0000-0000-000000000002'
  ),
  'the real auth.users trigger creates the second confirmed profile'
);

select extensions.is(
  (
    select routine.security_type
    from information_schema.routines as routine
    where routine.specific_schema = 'public'
      and routine.routine_name = 'plannix_ensure_personal_organisation'
  ),
  'DEFINER',
  'the onboarding function is SECURITY DEFINER'
);

select extensions.is(
  (
    select function_definition.proconfig[1]
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname = 'plannix_ensure_personal_organisation'
      and function_definition.pronargs = 0
  ),
  'search_path=""',
  'the onboarding function has an empty search_path'
);

select extensions.is(
  (
    select function_definition.pronargs::integer
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'public'
      and function_definition.proname = 'plannix_ensure_personal_organisation'
  ),
  0,
  'the RPC has no target-user or authority-bearing arguments'
);

select extensions.is(
  pg_catalog.pg_get_function_result(
    'public.plannix_ensure_personal_organisation()'::regprocedure
  ),
  'TABLE(organisation_id uuid, organisation_user_id uuid)',
  'the RPC returns exactly the two intended UUID columns'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.plannix_ensure_personal_organisation()',
    'EXECUTE'
  ),
  'anon has no execute privilege on the RPC'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_definition.proacl,
        pg_catalog.acldefault('f', function_definition.proowner)
      )
    ) as function_acl
    where function_schema.nspname = 'public'
      and function_definition.proname = 'plannix_ensure_personal_organisation'
      and function_definition.pronargs = 0
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no execute privilege on the RPC'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.plannix_ensure_personal_organisation()',
    'EXECUTE'
  ),
  'authenticated has execute privilege on the RPC'
);

select extensions.throws_ok(
  $$select pg_temp.call_personal_organisation_onboarding_as_anon()$$,
  '42501',
  null,
  'calling the RPC with SET LOCAL ROLE anon fails with insufficient privilege'
);

select extensions.throws_ok(
  $$select * from pg_temp.call_personal_organisation_onboarding_as_authenticated(null)$$,
  '42501',
  'Authentication is required.',
  'a null auth.uid() is rejected'
);

select extensions.throws_ok(
  $$
    select *
    from pg_temp.call_personal_organisation_onboarding_as_authenticated(
      '10000000-0000-0000-0000-000000000003'
    )
  $$,
  '42501',
  'Email confirmation is required.',
  'an unconfirmed user is rejected'
);

select extensions.is(
  (
    select count(*)::integer
    from private.plannix_personal_organisations
    where user_id = '10000000-0000-0000-0000-000000000003'
  ),
  0,
  'unconfirmed onboarding creates no marker'
);

-- Preserve an unrelated school membership and role while onboarding user one.
insert into public.plannix_organisations (
  id,
  name,
  organisation_type
)
values (
  '20000000-0000-0000-0000-000000000001',
  'Fixture School',
  'school'
);

insert into public.plannix_organisation_users (
  id,
  organisation_id,
  user_id
)
values (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001'
);

insert into public.plannix_organisation_user_access_roles (
  organisation_user_id,
  access_role_id
)
select
  '30000000-0000-0000-0000-000000000001',
  access_role.id
from public.plannix_access_roles as access_role
where access_role.name = 'Staff';

select extensions.lives_ok(
  $$
    select *
    from pg_temp.call_personal_organisation_onboarding_as_authenticated(
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  'a confirmed user can bootstrap a personal organisation'
);

select extensions.is(
  (
    select count(*)::integer
    from private.plannix_personal_organisations
    where user_id = '10000000-0000-0000-0000-000000000001'
  ),
  1,
  'the confirmed user receives exactly one personal marker'
);

select extensions.is(
  (
    select count(*)::integer
    from public.plannix_organisations as organisation
    join private.plannix_personal_organisations as personal
      on personal.organisation_id = organisation.id
    where personal.user_id = '10000000-0000-0000-0000-000000000001'
      and organisation.organisation_type = 'personal'
  ),
  1,
  'the marked organisation is personal'
);

select extensions.is(
  (
    select count(*)::integer
    from public.plannix_organisation_users as membership
    join private.plannix_personal_organisations as personal
      on personal.organisation_id = membership.organisation_id
    where personal.user_id = '10000000-0000-0000-0000-000000000001'
      and membership.user_id = personal.user_id
  ),
  1,
  'the caller receives the correct personal membership'
);

select extensions.is(
  (
    select count(*)::integer
    from private.plannix_personal_organisations as personal
    join public.plannix_organisation_users as membership
      on membership.organisation_id = personal.organisation_id
     and membership.user_id = personal.user_id
    join public.plannix_organisation_user_access_roles as assignment
      on assignment.organisation_user_id = membership.id
    join public.plannix_access_roles as access_role
      on access_role.id = assignment.access_role_id
    where personal.user_id = '10000000-0000-0000-0000-000000000001'
      and access_role.name = 'Organisation Admin'
  ),
  1,
  'the exact Organisation Admin role is assigned once'
);

select extensions.is(
  (
    select count(*)::integer
    from public.plannix_organisation_users
    where id = '30000000-0000-0000-0000-000000000001'
      and organisation_id = '20000000-0000-0000-0000-000000000001'
      and user_id = '10000000-0000-0000-0000-000000000001'
  ),
  1,
  'the unrelated school membership is preserved'
);

select extensions.is(
  (
    select count(*)::integer
    from public.plannix_organisation_user_access_roles as assignment
    join public.plannix_access_roles as access_role
      on access_role.id = assignment.access_role_id
    where assignment.organisation_user_id = '30000000-0000-0000-0000-000000000001'
      and access_role.name = 'Staff'
  ),
  1,
  'the unrelated school role is preserved'
);

select extensions.results_eq(
  $$
    select *
    from pg_temp.call_personal_organisation_onboarding_as_authenticated(
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  $$
    select organisation.id, membership.id
    from public.plannix_organisations as organisation
    join public.plannix_organisation_users as membership
      on membership.organisation_id = organisation.id
    where membership.user_id = '10000000-0000-0000-0000-000000000001'
      and organisation.organisation_type = 'personal'
  $$,
  'a repeated call returns the same identifiers'
);

select extensions.is(
  (
    select count(*)::integer
    from private.plannix_personal_organisations
    where user_id = '10000000-0000-0000-0000-000000000001'
  ),
  1,
  'a repeated call does not duplicate the marker'
);

select extensions.is(
  (
    select count(*)::integer
    from public.plannix_organisation_users as membership
    join private.plannix_personal_organisations as personal
      on personal.organisation_id = membership.organisation_id
    where personal.user_id = '10000000-0000-0000-0000-000000000001'
      and membership.user_id = personal.user_id
  ),
  1,
  'a repeated call does not duplicate the membership'
);

select extensions.lives_ok(
  $$
    select *
    from pg_temp.call_personal_organisation_onboarding_as_authenticated(
      '10000000-0000-0000-0000-000000000002'
    )
  $$,
  'a different confirmed user can onboard independently'
);

select extensions.is(
  (
    select count(distinct organisation_id)::integer
    from private.plannix_personal_organisations
    where user_id in (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    )
  ),
  2,
  'different users receive different personal organisations'
);

select extensions.is(
  (
    select count(*)::integer
    from private.plannix_personal_organisations
    where user_id = '10000000-0000-0000-0000-000000000002'
  ),
  1,
  'the second user receives exactly one marker'
);

select extensions.is(
  (
    select count(*)::integer
    from private.plannix_personal_organisations
    where user_id not in (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    )
  ),
  0,
  'the no-argument RPC cannot bootstrap another target user'
);

-- Deliberately create the one inconsistent fixture required to test the
-- missing-profile failure path: let the real trigger run, then remove its row.
delete from public.plannix_users
where id = '10000000-0000-0000-0000-000000000004';

select extensions.throws_ok(
  $$
    select *
    from pg_temp.call_personal_organisation_onboarding_as_authenticated(
      '10000000-0000-0000-0000-000000000004'
    )
  $$,
  'P0001',
  'The user profile is not ready.',
  'a missing profile fails cleanly'
);

select extensions.is(
  (
    select count(*)::integer
    from private.plannix_personal_organisations
    where user_id = '10000000-0000-0000-0000-000000000004'
  ),
  0,
  'a missing profile failure creates no marker'
);

select extensions.ok(
  not pg_catalog.has_table_privilege(
    'anon',
    'private.plannix_personal_organisations',
    'SELECT'
  ),
  'anon has no SELECT privilege on the private marker table'
);

select extensions.ok(
  not pg_catalog.has_table_privilege(
    'anon',
    'private.plannix_personal_organisations',
    'INSERT'
  ),
  'anon has no INSERT privilege on the private marker table'
);

select extensions.ok(
  not pg_catalog.has_table_privilege(
    'anon',
    'private.plannix_personal_organisations',
    'UPDATE'
  ),
  'anon has no UPDATE privilege on the private marker table'
);

select extensions.ok(
  not pg_catalog.has_table_privilege(
    'anon',
    'private.plannix_personal_organisations',
    'DELETE'
  ),
  'anon has no DELETE privilege on the private marker table'
);

select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'private.plannix_personal_organisations',
    'SELECT'
  ),
  'authenticated has no SELECT privilege on the private marker table'
);

select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'private.plannix_personal_organisations',
    'INSERT'
  ),
  'authenticated has no INSERT privilege on the private marker table'
);

select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'private.plannix_personal_organisations',
    'UPDATE'
  ),
  'authenticated has no UPDATE privilege on the private marker table'
);

select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'private.plannix_personal_organisations',
    'DELETE'
  ),
  'authenticated has no DELETE privilege on the private marker table'
);

-- Test atomic failure when the required seeded role is unavailable. This is
-- last because the existing FK intentionally cascades its fixture assignments.
delete from public.plannix_access_roles
where name = 'Organisation Admin';

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000005',
  'authenticated',
  'authenticated',
  'missing-role@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Missing","last_name":"Role"}'::jsonb,
  now(),
  now()
);

select extensions.throws_ok(
  $$
    select *
    from pg_temp.call_personal_organisation_onboarding_as_authenticated(
      '10000000-0000-0000-0000-000000000005'
    )
  $$,
  'P0001',
  'The Organisation Admin role is unavailable.',
  'a missing Organisation Admin role fails cleanly'
);

select extensions.is(
  (
    select count(*)::integer
    from private.plannix_personal_organisations
    where user_id = '10000000-0000-0000-0000-000000000005'
  ),
  0,
  'a missing-role failure creates no marker'
);

select extensions.is(
  (
    select count(*)::integer
    from public.plannix_organisation_users
    where user_id = '10000000-0000-0000-0000-000000000005'
  ),
  0,
  'a missing-role failure creates no membership'
);

select * from extensions.finish();

rollback;
