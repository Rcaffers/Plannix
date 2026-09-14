begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(50);

create function pg_temp.onboard(target_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', target_user_id::text, true);
  execute 'set local role authenticated';
  perform public.plannix_ensure_personal_organisation();
  execute 'reset role';
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create temporary table account_deletion_fixture (
  key text primary key,
  id uuid not null
);

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
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('first_name', fixture.first_name, 'last_name', 'User'),
  now(),
  now()
from (
  values
    ('11000000-0000-0000-0000-000000000001'::uuid, 'delete@example.test', 'Delete'),
    ('11000000-0000-0000-0000-000000000002'::uuid, 'other@example.test', 'Other'),
    ('11000000-0000-0000-0000-000000000003'::uuid, 'incomplete@example.test', 'Incomplete'),
    ('11000000-0000-0000-0000-000000000004'::uuid, 'unmarked@example.test', 'Unmarked'),
    ('11000000-0000-0000-0000-000000000005'::uuid, 'sole-admin@example.test', 'Sole'),
    ('11000000-0000-0000-0000-000000000006'::uuid, 'co-admin@example.test', 'Co'),
    ('11000000-0000-0000-0000-000000000007'::uuid, 'rollback@example.test', 'Rollback'),
    ('11000000-0000-0000-0000-000000000008'::uuid, 'same-name@example.test', 'SameName')
) as fixture(id, email, first_name);

select pg_temp.onboard('11000000-0000-0000-0000-000000000001');
select pg_temp.onboard('11000000-0000-0000-0000-000000000002');
select pg_temp.onboard('11000000-0000-0000-0000-000000000007');

insert into account_deletion_fixture (key, id)
select 'delete_personal_org', organisation_id
from private.plannix_personal_organisations
where user_id = '11000000-0000-0000-0000-000000000001';

insert into account_deletion_fixture (key, id)
select 'other_personal_org', organisation_id
from private.plannix_personal_organisations
where user_id = '11000000-0000-0000-0000-000000000002';

insert into account_deletion_fixture (key, id)
select 'rollback_personal_org', organisation_id
from private.plannix_personal_organisations
where user_id = '11000000-0000-0000-0000-000000000007';

select extensions.is(
  (
    select action_timing
    from information_schema.triggers
    where event_object_schema = 'auth'
      and event_object_table = 'users'
      and trigger_name = 'plannix_cleanup_deleted_auth_user'
  ),
  'BEFORE',
  'account cleanup is a BEFORE trigger on auth.users'
);

select extensions.is(
  (
    select event_manipulation
    from information_schema.triggers
    where event_object_schema = 'auth'
      and event_object_table = 'users'
      and trigger_name = 'plannix_cleanup_deleted_auth_user'
  ),
  'DELETE',
  'account cleanup runs for DELETE operations'
);

select extensions.is(
  (
    select routine.security_type
    from information_schema.routines as routine
    where routine.specific_schema = 'private'
      and routine.routine_name = 'plannix_cleanup_deleted_auth_user'
  ),
  'DEFINER',
  'account cleanup is SECURITY DEFINER'
);

select extensions.is(
  (
    select function_definition.proconfig[1]
    from pg_catalog.pg_proc as function_definition
    join pg_catalog.pg_namespace as function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'private'
      and function_definition.proname = 'plannix_cleanup_deleted_auth_user'
  ),
  'search_path=""',
  'account cleanup has an empty search_path'
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
    where function_schema.nspname = 'private'
      and function_definition.proname = 'plannix_cleanup_deleted_auth_user'
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute account cleanup'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon', 'private.plannix_cleanup_deleted_auth_user()', 'EXECUTE'
  ),
  'anon cannot execute account cleanup'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'private.plannix_cleanup_deleted_auth_user()', 'EXECUTE'
  ),
  'authenticated cannot execute account cleanup'
);

select extensions.is(
  (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'plannix_events'
      and column_name = 'created_by_organisation_user_id'
  ),
  'YES',
  'event creator is nullable'
);

select extensions.is(
  (
    select pg_catalog.pg_get_constraintdef(constraint_definition.oid)
    from pg_catalog.pg_constraint as constraint_definition
    where constraint_definition.conname = 'fk_plannix_students_org_user'
      and constraint_definition.conrelid = 'public.plannix_students'::regclass
  ),
  'FOREIGN KEY (organisation_user_id, organisation_id) REFERENCES plannix_organisation_users(id, organisation_id) ON DELETE SET NULL (organisation_user_id)',
  'student membership FK clears only organisation_user_id'
);

select extensions.is(
  (
    select pg_catalog.pg_get_constraintdef(constraint_definition.oid)
    from pg_catalog.pg_constraint as constraint_definition
    where constraint_definition.conname = 'fk_plannix_events_creator'
      and constraint_definition.conrelid = 'public.plannix_events'::regclass
  ),
  'FOREIGN KEY (created_by_organisation_user_id, organisation_id) REFERENCES plannix_organisation_users(id, organisation_id) ON DELETE SET NULL (created_by_organisation_user_id)',
  'event creator FK clears only created_by_organisation_user_id'
);

-- Personal planner graph for the user that will be deleted.
insert into public.plannix_academic_years (id, organisation_id, name, start_date, end_date)
select
  '21000000-0000-0000-0000-000000000001', id, 'Personal year', '2026-09-01', '2027-08-31'
from account_deletion_fixture where key = 'delete_personal_org';

insert into public.plannix_classes (id, organisation_id, academic_year_id, name)
select
  '22000000-0000-0000-0000-000000000001', id,
  '21000000-0000-0000-0000-000000000001', 'Personal class'
from account_deletion_fixture where key = 'delete_personal_org';

insert into public.plannix_timetables (
  id, organisation_id, academic_year_id, name, active_from, active_to
)
select
  '23000000-0000-0000-0000-000000000001', id,
  '21000000-0000-0000-0000-000000000001', 'Personal timetable',
  '2026-09-01', '2027-08-31'
from account_deletion_fixture where key = 'delete_personal_org';

insert into public.plannix_timetable_weeks (id, timetable_id, code, name)
values (
  '24000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001', 'A', 'Week A'
);

insert into public.plannix_timetable_periods (
  id, timetable_id, period_number, label, start_time, end_time
)
values (
  '25000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001', 1, 'Period 1', '09:00', '10:00'
);

insert into public.plannix_timetable_sessions (
  id, timetable_id, timetable_week_id, class_id, period_id,
  academic_year_id, organisation_id, day_number
)
select
  '26000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000001',
  '22000000-0000-0000-0000-000000000001',
  '25000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001', id, 1
from account_deletion_fixture where key = 'delete_personal_org';

-- A Vault-backed AI connection proves the existing cascade cleanup trigger runs.
insert into account_deletion_fixture (key, id)
select 'vault_secret', vault.create_secret(
  'account-deletion-test-placeholder',
  'account-deletion-test-secret',
  'Local rollback-only account deletion test'
);

insert into public.plannix_ai_connections (
  organisation_user_id, vault_secret_id, api_key_last_four
)
select membership.id, secret.id, 'test'
from public.plannix_organisation_users as membership
join private.plannix_personal_organisations as personal
  on personal.organisation_id = membership.organisation_id
join account_deletion_fixture as secret on secret.key = 'vault_secret'
where personal.user_id = '11000000-0000-0000-0000-000000000001';

-- Shared school records. User one may be deleted because user two is also an admin.
insert into public.plannix_organisations (id, name, organisation_type)
values ('31000000-0000-0000-0000-000000000001', 'Shared School', 'school');

insert into public.plannix_organisation_users (id, organisation_id, user_id)
values
  (
    '32000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001'
  ),
  (
    '32000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000002'
  );

insert into public.plannix_organisation_user_access_roles (
  organisation_user_id, access_role_id
)
select membership.id, access_role.id
from public.plannix_organisation_users as membership
cross join public.plannix_access_roles as access_role
where membership.id in (
    '32000000-0000-0000-0000-000000000001',
    '32000000-0000-0000-0000-000000000002'
  )
  and access_role.name = 'Organisation Admin';

insert into public.plannix_departments (id, organisation_id, name)
values (
  '33000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001', 'Shared Department'
);

insert into public.plannix_department_users (
  id, department_id, organisation_user_id, organisation_id
)
values (
  '34000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001'
);

insert into public.plannix_students (
  id, organisation_id, organisation_user_id, first_name, last_name
)
values (
  '35000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001', 'Shared', 'Student'
);

insert into public.plannix_events (
  id, organisation_id, created_by_organisation_user_id, title,
  start_datetime, end_datetime
)
values (
  '36000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001', 'Shared event', now(), now()
);

delete from auth.users
where id = '11000000-0000-0000-0000-000000000001';

select extensions.ok(
  not exists (select 1 from auth.users where id = '11000000-0000-0000-0000-000000000001'),
  'normal deletion removes auth.users'
);
select extensions.ok(
  not exists (select 1 from public.plannix_users where id = '11000000-0000-0000-0000-000000000001'),
  'normal deletion removes the profile'
);
select extensions.ok(
  not exists (
    select 1 from public.plannix_organisations
    where id = (select id from account_deletion_fixture where key = 'delete_personal_org')
  ),
  'normal deletion removes the marked personal organisation'
);
select extensions.ok(
  not exists (select 1 from public.plannix_academic_years where id = '21000000-0000-0000-0000-000000000001'),
  'personal academic years cascade'
);
select extensions.ok(
  not exists (select 1 from public.plannix_classes where id = '22000000-0000-0000-0000-000000000001'),
  'personal classes cascade'
);
select extensions.ok(
  not exists (select 1 from public.plannix_timetables where id = '23000000-0000-0000-0000-000000000001'),
  'personal timetables cascade'
);
select extensions.ok(
  not exists (select 1 from public.plannix_timetable_weeks where id = '24000000-0000-0000-0000-000000000001'),
  'personal timetable weeks cascade'
);
select extensions.ok(
  not exists (select 1 from public.plannix_timetable_periods where id = '25000000-0000-0000-0000-000000000001'),
  'personal timetable periods cascade'
);
select extensions.ok(
  not exists (select 1 from public.plannix_timetable_sessions where id = '26000000-0000-0000-0000-000000000001'),
  'personal timetable sessions cascade'
);
select extensions.ok(
  not exists (
    select 1 from public.plannix_organisation_users
    where user_id = '11000000-0000-0000-0000-000000000001'
  ),
  'all departing memberships disappear'
);
select extensions.ok(
  not exists (
    select 1 from public.plannix_organisation_user_access_roles
    where organisation_user_id in (
      '32000000-0000-0000-0000-000000000001'
    )
  ),
  'departing membership role assignments disappear'
);
select extensions.ok(
  not exists (
    select 1 from public.plannix_department_users
    where id = '34000000-0000-0000-0000-000000000001'
  ),
  'departing membership link records disappear'
);
select extensions.ok(
  not exists (
    select 1 from vault.secrets
    where id = (select id from account_deletion_fixture where key = 'vault_secret')
  ),
  'AI connection cascade invokes Vault secret cleanup'
);
select extensions.ok(
  exists (
    select 1 from public.plannix_organisations
    where id = (select id from account_deletion_fixture where key = 'other_personal_org')
  ),
  'another user personal organisation remains'
);
select extensions.ok(
  exists (select 1 from auth.users where id = '11000000-0000-0000-0000-000000000002'),
  'another user remains isolated'
);
select extensions.ok(
  exists (
    select 1 from public.plannix_organisations
    where id = '31000000-0000-0000-0000-000000000001'
      and name = 'Shared School'
  ),
  'the school organisation remains'
);
select extensions.ok(
  exists (
    select 1 from public.plannix_departments
    where id = '33000000-0000-0000-0000-000000000001'
  ),
  'shared school data remains'
);
select extensions.is(
  (select organisation_user_id from public.plannix_students where id = '35000000-0000-0000-0000-000000000001'),
  null::uuid,
  'deleting a linked membership clears only the student membership reference'
);
select extensions.is(
  (select organisation_id from public.plannix_students where id = '35000000-0000-0000-0000-000000000001'),
  '31000000-0000-0000-0000-000000000001'::uuid,
  'the retained student preserves organisation_id'
);
select extensions.ok(
  exists (select 1 from public.plannix_students where id = '35000000-0000-0000-0000-000000000001'),
  'the linked student row is preserved'
);
select extensions.is(
  (select created_by_organisation_user_id from public.plannix_events where id = '36000000-0000-0000-0000-000000000001'),
  null::uuid,
  'deleting a creator membership clears only the event creator reference'
);
select extensions.is(
  (select organisation_id from public.plannix_events where id = '36000000-0000-0000-0000-000000000001'),
  '31000000-0000-0000-0000-000000000001'::uuid,
  'the retained event preserves organisation_id'
);
select extensions.ok(
  exists (select 1 from public.plannix_events where id = '36000000-0000-0000-0000-000000000001'),
  'the school event is preserved'
);

-- Onboarding may not have completed: no marker and no personal membership is safe.
select extensions.lives_ok(
  $$delete from auth.users where id = '11000000-0000-0000-0000-000000000003'$$,
  'a user with no marker and no personal membership can be deleted'
);
select extensions.ok(
  not exists (select 1 from auth.users where id = '11000000-0000-0000-0000-000000000003'),
  'incomplete onboarding deletion removes the Auth user'
);

-- An unmarked personal membership is an anomaly; ownership must not be guessed.
insert into public.plannix_organisations (id, name, organisation_type)
values ('41000000-0000-0000-0000-000000000001', 'Unmarked personal', 'personal');
insert into public.plannix_organisation_users (organisation_id, user_id)
values (
  '41000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000004'
);

select extensions.throws_ok(
  $$delete from auth.users where id = '11000000-0000-0000-0000-000000000004'$$,
  'P0001',
  'PLANNIX_ACCOUNT_DELETE_PERSONAL_MARKER_MISSING',
  'an unmarked personal membership blocks deletion with a stable identifier'
);
select extensions.ok(
  exists (select 1 from auth.users where id = '11000000-0000-0000-0000-000000000004'),
  'marker anomaly failure leaves the Auth user unchanged'
);
select extensions.ok(
  exists (select 1 from public.plannix_organisations where id = '41000000-0000-0000-0000-000000000001'),
  'marker anomaly failure leaves the unmarked organisation unchanged'
);

-- Organisation names never establish ownership.
insert into public.plannix_organisations (id, name, organisation_type)
values (
  '41000000-0000-0000-0000-000000000002',
  'SameName User''s organisation',
  'personal'
);
select extensions.lives_ok(
  $$delete from auth.users where id = '11000000-0000-0000-0000-000000000008'$$,
  'an unrelated same-name organisation is not inferred to be owned'
);
select extensions.ok(
  exists (select 1 from public.plannix_organisations where id = '41000000-0000-0000-0000-000000000002'),
  'same-name personal organisation remains untouched'
);

-- Last-school-admin protection is transactional and stable.
insert into public.plannix_organisations (id, name, organisation_type)
values ('51000000-0000-0000-0000-000000000001', 'Protected School', 'school');
insert into public.plannix_organisation_users (id, organisation_id, user_id)
values (
  '52000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000005'
);
insert into public.plannix_organisation_user_access_roles (organisation_user_id, access_role_id)
select '52000000-0000-0000-0000-000000000001', id
from public.plannix_access_roles where name = 'Organisation Admin';

select extensions.throws_ok(
  $$delete from auth.users where id = '11000000-0000-0000-0000-000000000005'$$,
  'P0001',
  'PLANNIX_ACCOUNT_DELETE_LAST_SCHOOL_ADMIN',
  'the last school administrator is blocked with a stable identifier'
);
select extensions.ok(
  exists (select 1 from auth.users where id = '11000000-0000-0000-0000-000000000005'),
  'last-admin failure leaves the Auth user unchanged'
);
select extensions.ok(
  exists (select 1 from public.plannix_organisation_users where id = '52000000-0000-0000-0000-000000000001'),
  'last-admin failure leaves membership unchanged'
);

insert into public.plannix_organisation_users (id, organisation_id, user_id)
values (
  '52000000-0000-0000-0000-000000000002',
  '51000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000006'
);
insert into public.plannix_organisation_user_access_roles (organisation_user_id, access_role_id)
select '52000000-0000-0000-0000-000000000002', id
from public.plannix_access_roles where name = 'Organisation Admin';

select extensions.lives_ok(
  $$delete from auth.users where id = '11000000-0000-0000-0000-000000000005'$$,
  'deletion succeeds after another school administrator exists'
);
select extensions.ok(
  not exists (select 1 from auth.users where id = '11000000-0000-0000-0000-000000000005'),
  'former sole administrator Auth user is deleted'
);
select extensions.ok(
  exists (select 1 from public.plannix_organisations where id = '51000000-0000-0000-0000-000000000001'),
  'protected school remains after safe administrator deletion'
);

-- A failure after BEFORE-trigger cleanup rolls the entire delete statement back.
create function pg_temp.force_auth_delete_failure()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.id = '11000000-0000-0000-0000-000000000007' then
    raise exception using errcode = 'P0001', message = 'FORCED_LATER_DELETE_FAILURE';
  end if;
  return old;
end;
$$;

create trigger zz_force_auth_delete_failure
after delete on auth.users
for each row execute function pg_temp.force_auth_delete_failure();

select extensions.throws_ok(
  $$delete from auth.users where id = '11000000-0000-0000-0000-000000000007'$$,
  'P0001',
  'FORCED_LATER_DELETE_FAILURE',
  'a forced later failure aborts Auth deletion'
);
select extensions.ok(
  exists (select 1 from auth.users where id = '11000000-0000-0000-0000-000000000007'),
  'a later failure restores the Auth user'
);
select extensions.ok(
  exists (
    select 1 from public.plannix_organisations
    where id = (select id from account_deletion_fixture where key = 'rollback_personal_org')
  ),
  'a later failure rolls back personal organisation deletion'
);
select extensions.ok(
  exists (
    select 1 from private.plannix_personal_organisations
    where user_id = '11000000-0000-0000-0000-000000000007'
  ),
  'a later failure restores the personal marker'
);

select * from extensions.finish();

rollback;
