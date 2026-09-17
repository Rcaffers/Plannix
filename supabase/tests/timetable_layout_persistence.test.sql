begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(77);

create function pg_temp.base_timetable_layout()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{
    "name":"Main timetable",
    "cadence":"one-week",
    "schoolStartTime":"09:00",
    "teachingPeriodMinutes":60,
    "periods":[
      {"type":"registration","label":"Registration","startTime":"08:40","endTime":"08:55","enabled":false,"visible":false},
      {"type":"teaching","label":"Period 1","startTime":"09:00","endTime":"10:00","enabled":true,"visible":true,"periodNumber":1},
      {"type":"break","label":"Break 1","startTime":"10:00","endTime":"10:15","enabled":true,"visible":false},
      {"type":"teaching","label":"Period 2","startTime":"10:15","endTime":"11:15","enabled":true,"visible":true,"periodNumber":2},
      {"type":"lunch","label":"Lunch","startTime":"12:30","endTime":"12:30","enabled":false,"visible":true}
    ]
  }'::jsonb;
$$;

create function pg_temp.save_layout_as(
  fixture_user_id uuid,
  fixture_organisation_id uuid,
  fixture_academic_year_id uuid,
  fixture_timetable_id uuid,
  fixture_revision bigint,
  fixture_layout jsonb
)
returns table (timetable_id uuid, revision bigint, weeks jsonb, periods jsonb)
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(fixture_user_id::text, ''), true);
  execute 'set local role authenticated';
  return query
  select * from public.plannix_save_timetable_layout(
    fixture_organisation_id,
    fixture_academic_year_id,
    fixture_timetable_id,
    fixture_revision,
    fixture_layout
  );
  execute 'reset role';
exception
  when others then
    execute 'reset role';
    raise;
end;
$$;

create function pg_temp.save_layout_as_anon()
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute 'set local role anon';
  perform public.plannix_save_timetable_layout(
    '52000000-0000-0000-0000-000000000001',
    '72000000-0000-0000-0000-000000000001',
    null,
    0,
    pg_temp.base_timetable_layout()
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
  pg_catalog.jsonb_build_object('first_name', fixture.first_name, 'last_name', 'Layout'),
  now(),
  now()
from (
  values
    ('42000000-0000-0000-0000-000000000001'::uuid, 'layout-admin@example.test', 'Admin', true),
    ('42000000-0000-0000-0000-000000000002'::uuid, 'layout-staff@example.test', 'Staff', true),
    ('42000000-0000-0000-0000-000000000003'::uuid, 'layout-readonly@example.test', 'ReadOnly', true),
    ('42000000-0000-0000-0000-000000000004'::uuid, 'layout-student@example.test', 'Student', true),
    ('42000000-0000-0000-0000-000000000005'::uuid, 'layout-other@example.test', 'Other', true),
    ('42000000-0000-0000-0000-000000000006'::uuid, 'layout-unconfirmed@example.test', 'Unconfirmed', false)
) as fixture(id, email, first_name, confirmed);

insert into public.plannix_organisations (id, name, organisation_type)
values
  ('52000000-0000-0000-0000-000000000001', 'Layout organisation one', 'school'),
  ('52000000-0000-0000-0000-000000000002', 'Layout organisation two', 'school');

insert into public.plannix_organisation_users (id, organisation_id, user_id)
values
  ('62000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001'),
  ('62000000-0000-0000-0000-000000000002', '52000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000002'),
  ('62000000-0000-0000-0000-000000000003', '52000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000003'),
  ('62000000-0000-0000-0000-000000000004', '52000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000004'),
  ('62000000-0000-0000-0000-000000000006', '52000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000006'),
  ('62000000-0000-0000-0000-000000000005', '52000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000005');

insert into public.plannix_organisation_user_access_roles (organisation_user_id, access_role_id)
select membership.id, access_role.id
from (
  values
    ('62000000-0000-0000-0000-000000000001'::uuid, 'Organisation Admin'),
    ('62000000-0000-0000-0000-000000000002'::uuid, 'Staff'),
    ('62000000-0000-0000-0000-000000000003'::uuid, 'Read Only'),
    ('62000000-0000-0000-0000-000000000004'::uuid, 'Student'),
    ('62000000-0000-0000-0000-000000000005'::uuid, 'Organisation Admin'),
    ('62000000-0000-0000-0000-000000000006'::uuid, 'Organisation Admin')
) as assignment(membership_id, role_name)
join public.plannix_organisation_users as membership on membership.id = assignment.membership_id
join public.plannix_access_roles as access_role on access_role.name = assignment.role_name;

insert into public.plannix_academic_years (id, organisation_id, name, start_date, end_date)
values
  ('72000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', '2026/27', '2026-09-01', '2027-08-31'),
  ('72000000-0000-0000-0000-000000000002', '52000000-0000-0000-0000-000000000001', '2027/28', '2027-09-01', '2028-08-31'),
  ('72000000-0000-0000-0000-000000000004', '52000000-0000-0000-0000-000000000001', 'Identity test year', '2028-09-01', '2029-08-31'),
  ('72000000-0000-0000-0000-000000000003', '52000000-0000-0000-0000-000000000002', 'Other year', '2026-09-01', '2027-08-31');

select extensions.is((select data_type from information_schema.columns where table_schema='public' and table_name='plannix_timetables' and column_name='cadence'), 'text', 'cadence is text');
select extensions.is((select data_type from information_schema.columns where table_schema='public' and table_name='plannix_timetables' and column_name='layout_revision'), 'bigint', 'layout revision is bigint');
select extensions.is((select column_default from information_schema.columns where table_schema='public' and table_name='plannix_timetables' and column_name='layout_revision'), '0', 'layout revision defaults to zero');
select extensions.is((select column_default from information_schema.columns where table_schema='public' and table_name='plannix_timetables' and column_name='is_default'), 'false', 'default marker defaults false');
select extensions.ok(not exists (select 1 from information_schema.columns where table_schema='public' and table_name='plannix_timetable_periods' and column_name='is_break'), 'legacy is_break column was removed');
select extensions.is((select delete_rule from information_schema.referential_constraints where constraint_schema='public' and constraint_name='fk_plannix_timetable_sessions_week'), 'RESTRICT', 'session week deletion is restrictive');
select extensions.is((select delete_rule from information_schema.referential_constraints where constraint_schema='public' and constraint_name='fk_plannix_timetable_sessions_period'), 'RESTRICT', 'session period deletion is restrictive');
select extensions.is((select routine.security_type from information_schema.routines as routine where routine.specific_schema='public' and routine.routine_name='plannix_save_timetable_layout'), 'INVOKER', 'RPC is SECURITY INVOKER');
select extensions.is(pg_catalog.pg_get_function_arguments('public.plannix_save_timetable_layout(uuid,uuid,uuid,bigint,jsonb)'::regprocedure), 'target_organisation_id uuid, target_academic_year_id uuid, target_timetable_id uuid, expected_revision bigint, target_layout jsonb', 'RPC signature is exact');
select extensions.is(pg_catalog.pg_get_function_result('public.plannix_save_timetable_layout(uuid,uuid,uuid,bigint,jsonb)'::regprocedure), 'TABLE(timetable_id uuid, revision bigint, weeks jsonb, periods jsonb)', 'RPC return shape is exact');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.plannix_save_timetable_layout(uuid,uuid,uuid,bigint,jsonb)', 'EXECUTE'), 'anon lacks RPC execution');
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.plannix_save_timetable_layout(uuid,uuid,uuid,bigint,jsonb)', 'EXECUTE'), 'authenticated can execute RPC');
select extensions.ok(not exists (select 1 from pg_catalog.pg_proc as procedure join pg_catalog.pg_namespace as namespace on namespace.oid=procedure.pronamespace cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) as acl where namespace.nspname='public' and procedure.proname='plannix_save_timetable_layout' and acl.grantee=0 and acl.privilege_type='EXECUTE'), 'PUBLIC lacks RPC execution');

select extensions.throws_ok($$select pg_temp.save_layout_as_anon()$$, '42501', null, 'anon execution fails');
select extensions.throws_ok($$select * from pg_temp.save_layout_as(null,'52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',null,0,pg_temp.base_timetable_layout())$$, '42501', 'Authentication is required.', 'missing authentication is rejected');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000006','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',null,0,pg_temp.base_timetable_layout())$$, '42501', 'Email confirmation is required.', 'unconfirmed authentication is rejected');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',null,0,pg_temp.base_timetable_layout())$$, '42501', 'Organisation Admin access is required.', 'Staff cannot save');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000003','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',null,0,pg_temp.base_timetable_layout())$$, '42501', 'Organisation Admin access is required.', 'Read Only cannot save');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000004','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',null,0,pg_temp.base_timetable_layout())$$, '42501', 'Organisation Admin access is required.', 'Student cannot save');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000005','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',null,0,pg_temp.base_timetable_layout())$$, '42501', 'Organisation Admin access is required.', 'unrelated administrator cannot save');

create temporary table saved_layout as
select * from pg_temp.save_layout_as(
  '42000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000001',
  null,
  0,
  pg_temp.base_timetable_layout()
);

select extensions.is((select revision from saved_layout), 1::bigint, 'initial save increments revision once');
select extensions.is((select count(*)::integer from public.plannix_timetables where academic_year_id='72000000-0000-0000-0000-000000000001' and is_default), 1, 'one default timetable is created');
select extensions.is((select active_from from public.plannix_timetables where id=(select timetable_id from saved_layout)), '2026-09-01'::date, 'active_from comes from academic year');
select extensions.is((select active_to from public.plannix_timetables where id=(select timetable_id from saved_layout)), '2027-08-31'::date, 'active_to comes from academic year');
select extensions.results_eq($$select code from public.plannix_timetable_weeks where timetable_id=(select timetable_id from saved_layout) order by sort_order$$, $$values ('A'::text)$$, 'one-week cadence creates only Week A');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods where timetable_id=(select timetable_id from saved_layout)), 5, 'all normalized period rows are created');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods where timetable_id=(select timetable_id from saved_layout) and period_type='teaching' and is_enabled and is_visible), 2, 'teaching rows are enabled and visible');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods where timetable_id=(select timetable_id from saved_layout) and period_type='break' and is_enabled and not is_visible), 1, 'hidden enabled break is retained');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods where timetable_id=(select timetable_id from saved_layout) and period_type in ('registration','lunch') and not is_enabled), 2, 'disabled blocks retain configuration');
select extensions.ok((select periods @> '[{"type":"break","enabled":true,"visible":false}]'::jsonb from saved_layout), 'authoritative periods preserve hidden blocking state');
select extensions.ok((select pg_catalog.jsonb_array_length(periods) = 5 and not exists (select 1 from pg_catalog.jsonb_array_elements(periods) as returned_period where not (returned_period ? 'id')) from saved_layout), 'authoritative output supplies an ID for every period');

create temporary table stable_ids as
select period_type, period_number, id
from public.plannix_timetable_periods
where timetable_id=(select timetable_id from saved_layout);

create temporary table two_week_result as
select * from pg_temp.save_layout_as(
  '42000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000001',
  (select timetable_id from saved_layout),
  1,
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_temp.base_timetable_layout(),
      '{cadence}',
      '"two-week"'::jsonb
    ),
    '{periods}',
    (
      select pg_catalog.jsonb_agg(period_value || pg_catalog.jsonb_build_object('id', stable.id) order by ordinal)
      from pg_catalog.jsonb_array_elements(pg_temp.base_timetable_layout() -> 'periods') with ordinality as supplied(period_value, ordinal)
      join stable_ids as stable
        on stable.period_type = period_value ->> 'type'
       and (stable.period_number is not distinct from nullif(period_value ->> 'periodNumber','')::integer)
    )
  )
);

select extensions.is((select timetable_id from two_week_result), (select timetable_id from saved_layout), 'timetable UUID remains stable');
select extensions.is((select revision from two_week_result), 2::bigint, 'successful update increments revision once');
select extensions.results_eq($$select code from public.plannix_timetable_weeks where timetable_id=(select timetable_id from saved_layout) order by sort_order$$, $$values ('A'::text),('B'::text)$$, 'two-week cadence creates stable A and B weeks');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods as current_period join stable_ids as stable using(id) where current_period.timetable_id=(select timetable_id from saved_layout)), 5, 'all supplied period UUIDs remain stable');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods as current_period join stable_ids as stable on stable.period_number=current_period.period_number where current_period.period_type='teaching' and current_period.id=stable.id), 2, 'teaching UUIDs remain stable by number');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods as current_period join stable_ids as stable on stable.period_type=current_period.period_type and stable.id=current_period.id where current_period.period_type in ('registration','break','lunch')), 3, 'registration, break and lunch UUIDs remain stable');

select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',(select timetable_id from saved_layout),1,pg_temp.base_timetable_layout())$$, '40001', 'TIMETABLE_LAYOUT_REVISION_CONFLICT', 'stale revision is rejected');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000002',(select timetable_id from saved_layout),2,pg_temp.base_timetable_layout())$$, 'P0002', 'Default timetable was not found.', 'cross-year timetable ID is rejected');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000003',(select timetable_id from saved_layout),2,pg_temp.base_timetable_layout())$$, 'P0002', 'Academic year was not found.', 'cross-organisation academic year is rejected');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',(select timetable_id from saved_layout),2,pg_catalog.jsonb_set(pg_temp.base_timetable_layout(),'{periods,1,endTime}','"10:30"'))$$, '22023', 'Teaching periods cannot overlap teaching or enabled blocking periods.', 'overlapping teaching and enabled hidden break is rejected');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',(select timetable_id from saved_layout),2,pg_catalog.jsonb_set(pg_temp.base_timetable_layout(),'{periods,1,endTime}','"08:59"'))$$, '22023', 'Period times are invalid.', 'reversed teaching time is rejected');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',(select timetable_id from saved_layout),2,pg_catalog.jsonb_set(pg_temp.base_timetable_layout(),'{periods,1,visible}','false'))$$, '22023', 'Teaching periods must be enabled, visible and uniquely numbered from 1 to 12.', 'hidden teaching period is rejected');

insert into public.plannix_classes (id, organisation_id, academic_year_id, name, frequency, sort_order)
values ('82000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','Layout class',1,0);

insert into public.plannix_timetable_sessions (
  id, timetable_id, timetable_week_id, class_id, period_id,
  academic_year_id, organisation_id, day_number, title
)
select
  '94000000-0000-0000-0000-000000000011',
  saved_layout.timetable_id,
  timetable_week.id,
  '82000000-0000-0000-0000-000000000001',
  timetable_period.id,
  '72000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  1,
  'Referenced session'
from saved_layout
join public.plannix_timetable_weeks as timetable_week on timetable_week.timetable_id=saved_layout.timetable_id and timetable_week.code='B'
join public.plannix_timetable_periods as timetable_period on timetable_period.timetable_id=saved_layout.timetable_id and timetable_period.period_type='teaching' and timetable_period.period_number=1;

select extensions.throws_ok($$delete from public.plannix_timetable_weeks where timetable_id=(select timetable_id from saved_layout) and code='B'$$, '23503', null, 'direct referenced week deletion is restricted');
select extensions.throws_ok($$delete from public.plannix_timetable_periods where timetable_id=(select timetable_id from saved_layout) and period_type='teaching' and period_number=1$$, '23503', null, 'direct referenced period deletion is restricted');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions where id='94000000-0000-0000-0000-000000000011'), 1, 'direct deletion attempts preserve the session');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',(select timetable_id from saved_layout),2,pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_temp.base_timetable_layout(),'{cadence}','"two-week"'::jsonb),'{periods}',(select pg_catalog.jsonb_agg(period_value) from pg_catalog.jsonb_array_elements((select periods from two_week_result)) as supplied(period_value) where period_value ->> 'periodNumber' is distinct from '1')))$$, '23503', 'TIMETABLE_LAYOUT_PERIOD_IN_USE', 'explicitly omitting a referenced teaching period is rejected');
select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',(select timetable_id from saved_layout),2,pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_temp.base_timetable_layout(),'{cadence}','"one-week"'::jsonb),'{periods}',(select periods from two_week_result)))$$, '23503', 'TIMETABLE_LAYOUT_WEEK_IN_USE', 'removing referenced Week B is rejected when all periods are retained');
select extensions.is((select layout_revision from public.plannix_timetables where id=(select timetable_id from saved_layout)), 2::bigint, 'failed reconciliation preserves revision');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions where id='94000000-0000-0000-0000-000000000011'), 1, 'failed reconciliation preserves sessions');

create temporary table non_destructive_result as
select * from pg_temp.save_layout_as(
  '42000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000001',
  (select timetable_id from saved_layout),
  2,
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(pg_temp.base_timetable_layout(),'{cadence}','"two-week"'::jsonb),
      '{periods}',
      (select periods from two_week_result)
    ),
    '{periods,0,label}',
    '"Morning registration"'::jsonb
  )
);

select extensions.is((select revision from non_destructive_result), 3::bigint, 'non-destructive edits increment the revision');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions where id='94000000-0000-0000-0000-000000000011'), 1, 'non-destructive edits preserve existing sessions');

select extensions.lives_ok($$delete from public.plannix_timetable_periods where timetable_id=(select timetable_id from saved_layout) and period_type='lunch'$$, 'unreferenced period deletion succeeds');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods where timetable_id=(select timetable_id from saved_layout) and period_type='lunch'), 0, 'unreferenced period is removed');

-- Teaching rows deliberately omit IDs throughout this sequence. Non-teaching
-- rows retain the authoritative IDs returned by the first save.
create temporary table identity_first as
select * from pg_temp.save_layout_as(
  '42000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000004',
  null,
  0,
  pg_temp.base_timetable_layout()
);

create temporary table identity_teaching_ids as
select period_number, id
from public.plannix_timetable_periods
where timetable_id = (select timetable_id from identity_first)
  and period_type = 'teaching';

create temporary table identity_non_teaching_ids as
select period_type, id
from public.plannix_timetable_periods
where timetable_id = (select timetable_id from identity_first)
  and period_type <> 'teaching';

select extensions.is((select count(*)::integer from identity_teaching_ids), 2, 'first save without teaching IDs generates authoritative teaching UUIDs');

insert into public.plannix_classes (id, organisation_id, academic_year_id, name, frequency, sort_order)
values ('82000000-0000-0000-0000-000000000004','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000004','Identity class',1,0);

insert into public.plannix_timetable_sessions (
  id, timetable_id, timetable_week_id, class_id, period_id,
  academic_year_id, organisation_id, day_number, title
)
select
  '94000000-0000-0000-0000-000000000014',
  identity_first.timetable_id,
  timetable_week.id,
  '82000000-0000-0000-0000-000000000004',
  timetable_period.id,
  '72000000-0000-0000-0000-000000000004',
  '52000000-0000-0000-0000-000000000001',
  1,
  'Identity session'
from identity_first
join public.plannix_timetable_weeks as timetable_week
  on timetable_week.timetable_id = identity_first.timetable_id and timetable_week.code = 'A'
join public.plannix_timetable_periods as timetable_period
  on timetable_period.timetable_id = identity_first.timetable_id
 and timetable_period.period_type = 'teaching'
 and timetable_period.period_number = 2;

create temporary table identity_layout as
select pg_catalog.jsonb_set(
  pg_temp.base_timetable_layout(),
  '{periods}',
  (
    select pg_catalog.jsonb_agg(
      case
        when period_value ->> 'type' = 'teaching' then period_value
        else period_value || pg_catalog.jsonb_build_object('id', stable.id)
      end
      order by ordinal
    )
    from pg_catalog.jsonb_array_elements(pg_temp.base_timetable_layout() -> 'periods')
      with ordinality as supplied(period_value, ordinal)
    left join identity_non_teaching_ids as stable
      on stable.period_type = period_value ->> 'type'
  )
) as value;

create temporary table identity_repeat as
select * from pg_temp.save_layout_as(
  '42000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000004',
  (select timetable_id from identity_first),
  1,
  (select value from identity_layout)
);

select extensions.is((select revision from identity_repeat), 2::bigint, 'identical save without teaching IDs increments revision once');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods as period join identity_teaching_ids as stable using(id) where period.timetable_id=(select timetable_id from identity_first)), 2, 'identical save without teaching IDs preserves every teaching UUID');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions where id='94000000-0000-0000-0000-000000000014'), 1, 'session remains attached after repeated save without teaching IDs');

create temporary table identity_time_change as
select * from pg_temp.save_layout_as(
  '42000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000004',
  (select timetable_id from identity_first),
  2,
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set((select value from identity_layout),'{teachingPeriodMinutes}','55'::jsonb),
    '{periods,1,endTime}',
    '"09:55"'::jsonb
  )
);

select extensions.is((select revision from identity_time_change), 3::bigint, 'teaching time and duration update increments revision');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods as period join identity_teaching_ids as stable using(id) where period.timetable_id=(select timetable_id from identity_first)), 2, 'changing teaching times without teaching IDs preserves UUIDs');

create temporary table identity_reordered as
select * from pg_temp.save_layout_as(
  '42000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000004',
  (select timetable_id from identity_first),
  3,
  pg_catalog.jsonb_set(
    (select value from identity_layout),
    '{periods}',
    (
      select pg_catalog.jsonb_agg(period_value order by
        case period_value ->> 'type' when 'lunch' then 0 when 'break' then 1 when 'registration' then 2 else 3 end,
        period_value ->> 'periodNumber')
      from pg_catalog.jsonb_array_elements((select value from identity_layout) -> 'periods') as supplied(period_value)
    )
  )
);

select extensions.is((select revision from identity_reordered), 4::bigint, 'non-teaching reorder increments revision');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods as period join identity_teaching_ids as stable using(id) where period.timetable_id=(select timetable_id from identity_first)), 2, 'reordering non-teaching rows does not change teaching UUIDs');

create temporary table identity_increased as
select * from pg_temp.save_layout_as(
  '42000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000004',
  (select timetable_id from identity_first),
  4,
  pg_catalog.jsonb_set(
    (select value from identity_layout),
    '{periods}',
    ((select value from identity_layout) -> 'periods') || '[{"type":"teaching","label":"Period 3","startTime":"11:15","endTime":"12:15","enabled":true,"visible":true,"periodNumber":3}]'::jsonb
  )
);

select extensions.is((select revision from identity_increased), 5::bigint, 'increasing periods increments revision');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods where timetable_id=(select timetable_id from identity_first) and period_type='teaching'), 3, 'increasing periods generates exactly one additional teaching row');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods as period join identity_teaching_ids as stable using(id) where period.timetable_id=(select timetable_id from identity_first)), 2, 'increasing periods preserves existing teaching UUIDs');

create temporary table identity_reduced as
select * from pg_temp.save_layout_as(
  '42000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000004',
  (select timetable_id from identity_first),
  5,
  (select value from identity_layout)
);

select extensions.is((select revision from identity_reduced), 6::bigint, 'reducing unreferenced periods increments revision');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods as period join identity_teaching_ids as stable using(id) where period.timetable_id=(select timetable_id from identity_first)), 2, 'reducing periods preserves retained teaching UUIDs');

select extensions.throws_ok(
  $$select * from pg_temp.save_layout_as(
    '42000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000001',
    '72000000-0000-0000-0000-000000000004',
    (select timetable_id from identity_first),
    6,
    pg_catalog.jsonb_set(
      (select value from identity_layout),
      '{periods}',
      (select pg_catalog.jsonb_agg(period_value) from pg_catalog.jsonb_array_elements((select value from identity_layout) -> 'periods') as supplied(period_value) where period_value ->> 'periodNumber' is distinct from '2')
    )
  )$$,
  '23503',
  'TIMETABLE_LAYOUT_PERIOD_IN_USE',
  'removing a referenced teaching period without IDs remains rejected'
);
select extensions.is((select layout_revision from public.plannix_timetables where id=(select timetable_id from identity_first)), 6::bigint, 'referenced-removal rollback preserves revision');
select extensions.is((select count(*)::integer from public.plannix_timetable_sessions where id='94000000-0000-0000-0000-000000000014'), 1, 'referenced-removal rollback preserves the attached session');

select extensions.throws_ok(
  $$select * from pg_temp.save_layout_as(
    '42000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000001',
    '72000000-0000-0000-0000-000000000004',
    (select timetable_id from identity_first),
    6,
    pg_catalog.jsonb_set(
      (select value from identity_layout),
      '{periods,4,id}',
      pg_catalog.to_jsonb((select id::text from identity_non_teaching_ids where period_type='break'))
    )
  )$$,
  '22023',
  'Period IDs must be unique.',
  'duplicate explicit non-teaching UUIDs remain rejected'
);

insert into public.plannix_timetables (id, organisation_id, academic_year_id, name, days_per_week, active_from, active_to, is_default)
values ('91000000-0000-0000-0000-000000000099','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000002','Unrelated timetable',5,'2027-09-01','2028-08-31',true);
insert into public.plannix_timetable_periods (id,timetable_id,period_number,label,start_time,end_time)
values ('93000000-0000-0000-0000-000000000099','91000000-0000-0000-0000-000000000099',1,'Foreign period','09:00','10:00');

select extensions.throws_ok($$select * from pg_temp.save_layout_as('42000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',(select timetable_id from saved_layout),3,pg_catalog.jsonb_set(pg_temp.base_timetable_layout(),'{periods,1,id}','"93000000-0000-0000-0000-000000000099"'))$$, '42501', 'A period ID belongs to another timetable.', 'foreign period ID is rejected');
select extensions.is((select name from public.plannix_timetables where id='91000000-0000-0000-0000-000000000099'), 'Unrelated timetable', 'unrelated timetable remains unchanged');
select extensions.throws_ok($$insert into public.plannix_timetables (organisation_id,academic_year_id,name,days_per_week,active_from,active_to,is_default) values ('52000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','Duplicate default',5,'2026-09-01','2027-08-31',true)$$, '23505', null, 'unique default timetable is enforced');
select extensions.ok(not exists (select 1 from information_schema.columns where table_schema='public' and table_name in ('plannix_classes','plannix_academic_years') and column_name='cadence'), 'cadence was not added to classes or academic years');
select extensions.is((select count(*)::integer from public.plannix_timetable_periods where period_type not in ('teaching','registration','break','lunch')), 0, 'all period rows satisfy typed backfill invariants');
select extensions.is((select count(*)::integer from public.plannix_timetables where is_default group by academic_year_id having count(*) > 1), null::integer, 'backfilled/default groups contain no duplicate defaults');

select * from extensions.finish();

rollback;
