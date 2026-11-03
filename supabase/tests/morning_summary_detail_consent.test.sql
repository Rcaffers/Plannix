begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select extensions.ok(not has_function_privilege('anon',
  'public.plannix_authorize_morning_summary_detail(uuid,text,uuid,uuid,uuid)','EXECUTE'),
  'browser anon cannot authorize details');
select extensions.ok(not has_function_privilege('authenticated',
  'public.plannix_authorize_morning_summary_detail(uuid,text,uuid,uuid,uuid)','EXECUTE'),
  'browser authenticated cannot authorize details');
select extensions.ok(has_function_privilege('service_role',
  'public.plannix_authorize_morning_summary_detail(uuid,text,uuid,uuid,uuid)','EXECUTE'),
  'only server service role has detail RPC');
select extensions.ok(not has_table_privilege('service_role',
  'private.plannix_morning_summary_preferences','SELECT,UPDATE'),
  'service role cannot bypass preference RPC');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','cf000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','detail-fixture@example.test','',pg_catalog.now(),
  '{}','{}',pg_catalog.now(),pg_catalog.now());
insert into public.plannix_organisations(id,name,organisation_type)
values ('cf000000-0000-4000-8000-000000000011','Synthetic detail org','personal');
insert into private.plannix_personal_organisations(user_id,organisation_id)
values ('cf000000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000011');
insert into public.plannix_organisation_users(id,user_id,organisation_id)
values ('cf000000-0000-4000-8000-000000000012','cf000000-0000-4000-8000-000000000001',
  'cf000000-0000-4000-8000-000000000011');
insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date)
values ('cf000000-0000-4000-8000-000000000013','cf000000-0000-4000-8000-000000000011',
  'Synthetic 2026-27','2026-09-01','2027-08-31');
insert into private.plannix_auth_browser_bindings(id,marker_hash,expires_at)
values ('cf000000-0000-4000-8000-000000000021',pg_catalog.repeat('a',64),
  pg_catalog.clock_timestamp()+interval '1 day');
insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
values ('cf000000-0000-4000-8000-000000000022','cf000000-0000-4000-8000-000000000021',
  920001,'cf000000-0000-4000-8000-000000000001','ordinary',pg_catalog.repeat('b',64),
  '{}','{}',pg_catalog.clock_timestamp()+interval '1 day');
update private.plannix_auth_browser_bindings
  set current_session_id='cf000000-0000-4000-8000-000000000022'
  where id='cf000000-0000-4000-8000-000000000021';

set local role service_role;
select extensions.is(public.plannix_get_morning_summary_detail_preferences(
  'cf000000-0000-4000-8000-000000000001')->>'lessonDetailConsent','false',
  'lesson detail consent defaults off');
select extensions.is(public.plannix_get_morning_summary_detail_preferences(
  'cf000000-0000-4000-8000-000000000001')->>'eventTitleConsent','false',
  'event title consent defaults off separately');
select public.plannix_save_morning_summary_detail_preferences(
  'cf000000-0000-4000-8000-000000000001',0,true,'07:00',
  'cf000000-0000-4000-8000-000000000013',false,true);
select extensions.is(public.plannix_get_morning_summary_detail_preferences(
  'cf000000-0000-4000-8000-000000000001')->>'eventTitleConsent','true',
  'event title consent is independent of lesson consent');
select extensions.throws_ok($$select public.plannix_save_morning_summary_detail_preferences(
  'cf000000-0000-4000-8000-000000000001',0,true,'07:00',
  'cf000000-0000-4000-8000-000000000013',true,true)$$,
  '40001','Morning summary preferences changed.','stale consent save conflicts');
reset role;

insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key,
  bound_session_id)
values (pg_catalog.repeat('c',64),'cf000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/fcm/send/synthetic-detail',pg_catalog.repeat('p',87),
  pg_catalog.repeat('q',22),'cf000000-0000-4000-8000-000000000022');
insert into private.plannix_morning_summary_jobs(user_id,london_date,preference_revision,
  academic_year_id,notification_ref)
values ('cf000000-0000-4000-8000-000000000001','2026-11-03',1,
  'cf000000-0000-4000-8000-000000000013','cf000000-0000-4000-8000-000000000031');
insert into private.plannix_morning_summary_deliveries(user_id,london_date,endpoint_hash,
  subscription_version,state)
select 'cf000000-0000-4000-8000-000000000001','2026-11-03',endpoint_hash,
  subscription_version,'accepted' from private.plannix_push_subscriptions
  where endpoint_hash=pg_catalog.repeat('c',64);
select pg_catalog.set_config('test.detail_version',installation_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('c',64);

set local role service_role;
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000022',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000001'),null::jsonb,
  'detail disabled denies even with generic subscription and event consent');
reset role;
-- No deployed route can enable details. This rollback-only fixture exercises
-- future eligibility without changing the generic delivery policy.
update private.plannix_push_subscriptions set detail_disabled=false
  where endpoint_hash=pg_catalog.repeat('c',64);
set local role service_role;
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000022',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000001'),null::jsonb,
  'event consent cannot substitute for lesson consent');
select public.plannix_save_morning_summary_detail_preferences(
  'cf000000-0000-4000-8000-000000000001',1,true,'07:00',
  'cf000000-0000-4000-8000-000000000013',true,false);
reset role;
update private.plannix_morning_summary_jobs set preference_revision=2
  where user_id='cf000000-0000-4000-8000-000000000001';
set local role service_role;
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000022',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000001')->>'eventTitleConsent','false',
  'eligible lesson details do not authorize event titles');
select public.plannix_save_morning_summary_detail_preferences(
  'cf000000-0000-4000-8000-000000000001',2,true,'07:00',
  'cf000000-0000-4000-8000-000000000013',true,true);
reset role;
update private.plannix_morning_summary_jobs set preference_revision=3
  where user_id='cf000000-0000-4000-8000-000000000001';
set local role service_role;
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000022',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000001')->>'eventTitleConsent','true',
  'separate event consent is returned only after an eligible lesson decision');
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000022',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000098',
  'cf000000-0000-4000-8000-000000000001'),null::jsonb,
  'foreign or missing notification reference is denied');
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000022',pg_catalog.repeat('c',64),
  'cf000000-0000-4000-8000-000000000099',
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000001'),null::jsonb,
  'stale installation version denied');
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000022',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000099'),null::jsonb,
  'wrong pilot/account denied');
reset role;
update private.plannix_auth_sessions set kind='recovery'
  where id='cf000000-0000-4000-8000-000000000022';
set local role service_role;
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000022',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000001'),null::jsonb,
  'recovery-only session cannot authorize ordinary notification detail');
reset role;
update private.plannix_auth_sessions set kind='ordinary'
  where id='cf000000-0000-4000-8000-000000000022';
insert into public.plannix_holidays(academic_year_id,name,start_date,end_date,holiday_type)
values ('cf000000-0000-4000-8000-000000000013','Synthetic closure',
  '2026-11-03','2026-11-03','school');
set local role service_role;
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000022',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000001'),null::jsonb,
  'school-day closure denies detail');
reset role;
delete from public.plannix_holidays where academic_year_id='cf000000-0000-4000-8000-000000000013';
update private.plannix_auth_sessions set revoked=true
  where id='cf000000-0000-4000-8000-000000000022';
set local role service_role;
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000022',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000001'),null::jsonb,
  'revoked session denied');
reset role;

insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
values ('cf000000-0000-4000-8000-000000000023','cf000000-0000-4000-8000-000000000021',
  920002,'cf000000-0000-4000-8000-000000000001','ordinary',pg_catalog.repeat('d',64),
  '{}','{}',pg_catalog.clock_timestamp()+interval '1 day');
update private.plannix_auth_browser_bindings
  set current_session_id='cf000000-0000-4000-8000-000000000023'
  where id='cf000000-0000-4000-8000-000000000021';
set local role service_role;
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000023',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000001'),null::jsonb,
  'same-account new session cannot borrow old installation binding');
reset role;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','cf000000-0000-4000-8000-000000000002',
  'authenticated','authenticated','detail-switch@example.test','',pg_catalog.now(),
  '{}','{}',pg_catalog.now(),pg_catalog.now());
insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
values ('cf000000-0000-4000-8000-000000000024','cf000000-0000-4000-8000-000000000021',
  920003,'cf000000-0000-4000-8000-000000000002','ordinary',pg_catalog.repeat('e',64),
  '{}','{}',pg_catalog.clock_timestamp()+interval '1 day');
update private.plannix_auth_sessions set revoked=true
  where id='cf000000-0000-4000-8000-000000000023';
update private.plannix_auth_browser_bindings
  set current_session_id='cf000000-0000-4000-8000-000000000024'
  where id='cf000000-0000-4000-8000-000000000021';
set local role service_role;
select extensions.is(public.plannix_authorize_morning_summary_detail(
  'cf000000-0000-4000-8000-000000000024',pg_catalog.repeat('c',64),
  pg_catalog.current_setting('test.detail_version')::uuid,
  'cf000000-0000-4000-8000-000000000031',
  'cf000000-0000-4000-8000-000000000002'),null::jsonb,
  'new account cannot use old owner, reference or binding');
reset role;

select * from extensions.finish();
rollback;
