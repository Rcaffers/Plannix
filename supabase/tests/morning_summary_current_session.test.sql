begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

select extensions.ok(not has_function_privilege('service_role',
  'private.plannix_morning_summary_has_current_bound_device(uuid)','EXECUTE')
  and not has_function_privilege('authenticated',
    'private.plannix_morning_summary_has_current_bound_device(uuid)','EXECUTE'),
  'the new eligibility helper is not callable by service or browser roles');

insert into auth.users(id,email,email_confirmed_at)
values ('d1000000-0000-4000-8000-000000000001','summary-bound-a@example.test',pg_catalog.now()),
  ('d1000000-0000-4000-8000-000000000002','summary-bound-b@example.test',pg_catalog.now());
insert into public.plannix_organisations(id,name,organisation_type)
values ('d1000000-0000-4000-8000-000000000011','Bound summary fixture','personal');
insert into private.plannix_personal_organisations(user_id,organisation_id)
values ('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000011');
insert into public.plannix_organisation_users(id,user_id,organisation_id)
values ('d1000000-0000-4000-8000-000000000012','d1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000011');
insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date)
values ('d1000000-0000-4000-8000-000000000013','d1000000-0000-4000-8000-000000000011',
  '2026-27','2026-09-01','2027-08-31');
set local role service_role;
select public.plannix_save_morning_summary_preferences('d1000000-0000-4000-8000-000000000001',
  0,true,'07:00','d1000000-0000-4000-8000-000000000013');
reset role;

insert into private.plannix_auth_browser_bindings(id,marker_hash,expires_at,current_session_id)
values ('d1000000-0000-4000-8000-000000000021',pg_catalog.repeat('1',64),
    pg_catalog.clock_timestamp()+interval '1 day','d1000000-0000-4000-8000-000000000031'),
  ('d1000000-0000-4000-8000-000000000022',pg_catalog.repeat('2',64),
    pg_catalog.clock_timestamp()+interval '1 day','d1000000-0000-4000-8000-000000000032');
insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
values ('d1000000-0000-4000-8000-000000000031','d1000000-0000-4000-8000-000000000021',
    pg_catalog.nextval('private.plannix_auth_generation_seq'),'d1000000-0000-4000-8000-000000000001',
    'ordinary',pg_catalog.repeat('3',64),'{}','{}',pg_catalog.clock_timestamp()+interval '1 day'),
  ('d1000000-0000-4000-8000-000000000032','d1000000-0000-4000-8000-000000000022',
    pg_catalog.nextval('private.plannix_auth_generation_seq'),'d1000000-0000-4000-8000-000000000002',
    'ordinary',pg_catalog.repeat('4',64),'{}','{}',pg_catalog.clock_timestamp()+interval '1 day');

insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key)
values (pg_catalog.repeat('a',64),'d1000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/fcm/send/unbound-summary-fixture',pg_catalog.repeat('p',87),pg_catalog.repeat('q',22));
select extensions.ok(not private.plannix_morning_summary_has_current_bound_device(
  'd1000000-0000-4000-8000-000000000001'),
  'legacy generic ownership is not a current-session binding');
select extensions.is(pg_catalog.jsonb_array_length(private.plannix_claim_morning_summary_pilot_jobs_at(
  '2026-10-05 06:00+00',1,'d1000000-0000-4000-8000-000000000001')),0,
  'unbound legacy device cannot reserve the scheduled job');
select extensions.ok(not exists(select 1 from private.plannix_morning_summary_jobs
  where user_id='d1000000-0000-4000-8000-000000000001'),
  'no job was left by the ineligible claim');

insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key,bound_session_id)
values (pg_catalog.repeat('b',64),'d1000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/fcm/send/bound-summary-fixture',pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),
  'd1000000-0000-4000-8000-000000000031');
select extensions.ok(private.plannix_morning_summary_has_current_bound_device(
  'd1000000-0000-4000-8000-000000000001'),
  'a bound current ordinary session is eligible');
savepoint recovery_only;
update private.plannix_auth_sessions set kind='recovery'
  where id='d1000000-0000-4000-8000-000000000031';
select extensions.ok(not private.plannix_morning_summary_has_current_bound_device(
  'd1000000-0000-4000-8000-000000000001'),
  'a recovery-only session cannot qualify a device for scheduled delivery');
select extensions.is(pg_catalog.jsonb_array_length(private.plannix_claim_morning_summary_pilot_jobs_at(
  '2026-10-05 06:00+00',1,'d1000000-0000-4000-8000-000000000001')),0,
  'recovery-only binding cannot reserve the scheduled job');
rollback to savepoint recovery_only;
create temp table bound_summary_claim as select private.plannix_claim_morning_summary_pilot_jobs_at(
  '2026-10-05 06:00+00',1,'d1000000-0000-4000-8000-000000000001') as claim;
select extensions.is((select pg_catalog.jsonb_array_length(claim) from bound_summary_claim),1,
  'current bound device permits one scheduled claim');
select extensions.ok(private.plannix_claim_morning_summary_device_at(
  'd1000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from bound_summary_claim),pg_catalog.repeat('b',64),1,
  'd1000000-0000-4000-8000-000000000013','2026-10-05 06:01+00') is not null,
  'bound device can be claimed for delivery');
select extensions.is(private.plannix_morning_summary_dispatch_seconds_at(
  'd1000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from bound_summary_claim),pg_catalog.repeat('b',64),
  (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('b',64)),
  1,'d1000000-0000-4000-8000-000000000013','2026-10-05 06:02+00'),780,
  'current bound device retains the existing delivery window');

select extensions.ok(private.plannix_claim_morning_summary_device_at(
  'd1000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from bound_summary_claim),pg_catalog.repeat('a',64),1,
  'd1000000-0000-4000-8000-000000000013','2026-10-05 06:01+00') is not null,
  'legacy device may be selected from an otherwise eligible job');
select extensions.is(private.plannix_morning_summary_dispatch_seconds_at(
  'd1000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from bound_summary_claim),pg_catalog.repeat('a',64),
  (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('a',64)),
  1,'d1000000-0000-4000-8000-000000000013','2026-10-05 06:02+00'),null::integer,
  'unbound legacy device is skipped before provider work');

savepoint before_logout;
select extensions.is((select public.plannix_auth_logout('__Host-plannix-b-'||b.generation,b.marker_hash,
  '__Host-plannix-s-'||s.generation,s.secret_hash)->>'state'
  from private.plannix_auth_browser_bindings as b
  join private.plannix_auth_sessions as s on s.binding_id=b.id
  where s.id='d1000000-0000-4000-8000-000000000031'),'revoked',
  'production logout invalidates the original session');
select extensions.is(private.plannix_morning_summary_dispatch_seconds_at(
  'd1000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from bound_summary_claim),pg_catalog.repeat('b',64),
  (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('b',64)),
  1,'d1000000-0000-4000-8000-000000000013','2026-10-05 06:02+00'),null::integer,
  'logout after claim blocks final dispatch');
rollback to savepoint before_logout;

savepoint before_replacement;
insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
values ('d1000000-0000-4000-8000-000000000033','d1000000-0000-4000-8000-000000000021',
  pg_catalog.nextval('private.plannix_auth_generation_seq'),'d1000000-0000-4000-8000-000000000001',
  'ordinary',pg_catalog.repeat('5',64),'{}','{}',pg_catalog.clock_timestamp()+interval '1 day');
update private.plannix_auth_sessions set revoked=true where id='d1000000-0000-4000-8000-000000000031';
update private.plannix_auth_browser_bindings set current_session_id='d1000000-0000-4000-8000-000000000033'
  where id='d1000000-0000-4000-8000-000000000021';
select extensions.is(private.plannix_morning_summary_dispatch_seconds_at(
  'd1000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from bound_summary_claim),pg_catalog.repeat('b',64),
  (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('b',64)),
  1,'d1000000-0000-4000-8000-000000000013','2026-10-05 06:02+00'),null::integer,
  'same-account session replacement invalidates the old bound device');
select extensions.is(public.plannix_push_register_installation(
  'd1000000-0000-4000-8000-000000000033',pg_catalog.repeat('b',64),
  'https://fcm.googleapis.com/fcm/send/bound-summary-fixture',pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),
  (select installation_version from private.plannix_push_subscriptions
    where endpoint_hash=pg_catalog.repeat('b',64)))->>'state','registered',
  'explicit registration binds the device to the replacement session');
select extensions.ok(private.plannix_morning_summary_has_current_bound_device(
  'd1000000-0000-4000-8000-000000000001'),
  'fresh registration restores eligibility for a later scheduled day');
select extensions.is(pg_catalog.jsonb_array_length(private.plannix_claim_morning_summary_pilot_jobs_at(
  '2026-10-06 06:00+00',1,'d1000000-0000-4000-8000-000000000001')),1,
  'the re-registered current device can receive a future daily claim');
rollback to savepoint before_replacement;

savepoint before_expiry;
update private.plannix_auth_sessions set expires_at=pg_catalog.clock_timestamp()-interval '1 second'
  where id='d1000000-0000-4000-8000-000000000031';
select extensions.is(private.plannix_morning_summary_dispatch_seconds_at(
  'd1000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from bound_summary_claim),pg_catalog.repeat('b',64),
  (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('b',64)),
  1,'d1000000-0000-4000-8000-000000000013','2026-10-05 06:02+00'),null::integer,
  'expired bound session cannot authorize dispatch');
rollback to savepoint before_expiry;

savepoint before_reassignment;
select extensions.is(public.plannix_push_register_installation(
  'd1000000-0000-4000-8000-000000000032',pg_catalog.repeat('b',64),
  'https://fcm.googleapis.com/fcm/send/bound-summary-fixture',pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),
  (select installation_version from private.plannix_push_subscriptions
    where endpoint_hash=pg_catalog.repeat('b',64)))->>'state','registered',
  'B reassigns through the version-checked production RPC');
select extensions.is(private.plannix_morning_summary_dispatch_seconds_at(
  'd1000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from bound_summary_claim),pg_catalog.repeat('b',64),
  (select subscription_version from private.plannix_morning_summary_deliveries where endpoint_hash=pg_catalog.repeat('b',64)),
  1,'d1000000-0000-4000-8000-000000000013','2026-10-05 06:02+00'),null::integer,
  'old owner and version cannot dispatch after B takes the binding');
rollback to savepoint before_reassignment;

select * from extensions.finish();
rollback;
