begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','cc000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','summary-delivery@example.test','',pg_catalog.now(),
  '{"provider":"email","providers":["email"]}','{}',pg_catalog.now(),pg_catalog.now());
insert into public.plannix_organisations(id,name,organisation_type)
values ('cc000000-0000-4000-8000-000000000002','Summary delivery personal fixture','personal');
insert into private.plannix_personal_organisations(user_id,organisation_id)
values ('cc000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000002');
insert into public.plannix_organisation_users(id,user_id,organisation_id)
values ('cc000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000001',
  'cc000000-0000-4000-8000-000000000002');
insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date)
values ('cc000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000002',
  '2026-27','2026-09-01','2027-08-31');
insert into public.plannix_timetables(id,organisation_id,academic_year_id,name,days_per_week,
  active_from,active_to,is_default)
values ('cc000000-0000-4000-8000-000000000005','cc000000-0000-4000-8000-000000000002',
  'cc000000-0000-4000-8000-000000000004','Summary fixture',5,'2026-09-01','2027-08-31',true);
insert into public.plannix_timetables(id,organisation_id,academic_year_id,name,days_per_week,
  active_from,active_to,is_default)
values ('cc000000-0000-4000-8000-000000000055','cc000000-0000-4000-8000-000000000002',
  'cc000000-0000-4000-8000-000000000004','Other valid timetable',5,'2026-09-01','2027-08-31',false);
insert into public.plannix_timetable_weeks(id,timetable_id,code,name,sort_order)
values ('cc000000-0000-4000-8000-000000000056','cc000000-0000-4000-8000-000000000055','A','Other Week A',0);
insert into public.plannix_timetable_session_collections(id,organisation_id,academic_year_id,
  timetable_id,collection_type,timetable_week_id)
values ('cc000000-0000-4000-8000-000000000057','cc000000-0000-4000-8000-000000000002',
  'cc000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000055',
  'recurring','cc000000-0000-4000-8000-000000000056');
insert into public.plannix_timetable_weeks(id,timetable_id,code,name,sort_order)
values ('cc000000-0000-4000-8000-000000000006','cc000000-0000-4000-8000-000000000005','A','Week A',0);
insert into public.plannix_timetable_periods(id,timetable_id,period_number,label,start_time,end_time,
  period_type,sort_order,is_enabled)
values ('cc000000-0000-4000-8000-000000000007','cc000000-0000-4000-8000-000000000005',1,
  'First lesson','09:00','10:00','teaching',1,true);
insert into public.plannix_classes(id,organisation_id,academic_year_id,name)
values ('cc000000-0000-4000-8000-000000000008','cc000000-0000-4000-8000-000000000002',
  'cc000000-0000-4000-8000-000000000004','7A');
insert into public.plannix_timetable_session_collections(id,organisation_id,academic_year_id,
  timetable_id,collection_type,timetable_week_id)
values ('cc000000-0000-4000-8000-000000000009','cc000000-0000-4000-8000-000000000002',
  'cc000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000005',
  'recurring','cc000000-0000-4000-8000-000000000006');
insert into public.plannix_timetable_sessions(timetable_id,timetable_week_id,class_id,period_id,
  academic_year_id,organisation_id,day_number,collection_id,title,notes)
values ('cc000000-0000-4000-8000-000000000005','cc000000-0000-4000-8000-000000000006',
  'cc000000-0000-4000-8000-000000000008','cc000000-0000-4000-8000-000000000007',
  'cc000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000002',1,
  'cc000000-0000-4000-8000-000000000009','Synthetic lesson','Synthetic private notes');
insert into private.plannix_personal_events(id,organisation_id,academic_year_id,
  owner_organisation_user_id,event_date,title)
values ('cc000000-0000-4000-8000-000000000010','cc000000-0000-4000-8000-000000000002',
  'cc000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000003',
  '2026-10-05','Synthetic assembly');

select extensions.ok(not has_function_privilege('authenticated','public.plannix_morning_summary_snapshot(uuid,uuid,date)','EXECUTE'),
  'browser role cannot retrieve worker snapshot');
select extensions.ok(not has_function_privilege('anon','public.plannix_claim_morning_summary_device(uuid,date,uuid,text,bigint,uuid)','EXECUTE'),
  'anon cannot claim a delivery');
select extensions.ok(has_function_privilege('service_role','public.plannix_morning_summary_snapshot(uuid,uuid,date)','EXECUTE'),
  'service role may resolve a day');
select extensions.ok(not has_function_privilege('authenticated',
  'public.plannix_morning_summary_dispatch_seconds(uuid,date,uuid,text,uuid,bigint,uuid)','EXECUTE'),
  'browser cannot check or claim worker dispatch');
select extensions.ok(not has_function_privilege('authenticated',
  'public.plannix_morning_summary_notification_snapshot(uuid,uuid)','EXECUTE'),
  'browser cannot resolve an opaque notification reference');

set local role service_role;
select extensions.is(public.plannix_morning_summary_snapshot(
  'cc000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000004','2026-10-05')
  #>> '{dated,repeatingWeekId}','cc000000-0000-4000-8000-000000000006',
  'default timetable Week A resolves despite overlapping non-default timetable');
select extensions.is(public.plannix_morning_summary_snapshot(
  'cc000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000004','2026-10-05')
  #>> '{events,0,title}','Synthetic assembly','personal event resolved');
select extensions.throws_ok($$select public.plannix_morning_summary_snapshot(
  'cc000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000004','2026-10-04')$$,
  'P0002','Daily summary is unavailable.','weekend is ineligible');
reset role;
update public.plannix_timetables set is_default=false
  where id='cc000000-0000-4000-8000-000000000005';
update public.plannix_timetables set is_default=true
  where id='cc000000-0000-4000-8000-000000000055';
set local role service_role;
select extensions.throws_ok($$select public.plannix_morning_summary_snapshot(
  'cc000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000004','2026-10-05')$$,
  'P0002','Daily summary is unavailable.','no valid teaching periods cannot produce a partial snapshot');
reset role;
update public.plannix_timetables set is_default=false
  where id='cc000000-0000-4000-8000-000000000055';
update public.plannix_timetables set is_default=true
  where id='cc000000-0000-4000-8000-000000000005';

set local role service_role;
select public.plannix_save_morning_summary_preferences('cc000000-0000-4000-8000-000000000001',0,true,'07:00',
  'cc000000-0000-4000-8000-000000000004');
reset role;
insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key)
values (pg_catalog.repeat('a',64),'cc000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/fcm/send/synthetic-summary-device',pg_catalog.repeat('x',88),pg_catalog.repeat('y',22));
create temp table summary_claim_fixture(claim jsonb);
grant select on summary_claim_fixture to service_role;
insert into summary_claim_fixture
select private.plannix_claim_morning_summary_jobs_at('2026-10-05 06:00:00+00',4);
select extensions.is((select pg_catalog.jsonb_array_length(claim) from summary_claim_fixture),1,
  'one eligible user is claimed inside London window');
select extensions.ok((select (claim->0->>'notificationRef')::uuid is not null from summary_claim_fixture),
  'claim has an opaque durable notification reference');
set local role service_role;
select extensions.is(public.plannix_morning_summary_notification_snapshot(
  'cc000000-0000-4000-8000-000000000001',
  (select (claim->0->>'notificationRef')::uuid from summary_claim_fixture)) #>> '{date}',
  '2026-10-05','original notification day resolves only on the trusted server');
reset role;
select extensions.is(pg_catalog.jsonb_array_length(private.plannix_claim_morning_summary_jobs_at('2026-10-05 06:00:01+00',4)),0,
  'second worker cannot claim an active lease');
select extensions.is(private.plannix_claim_morning_summary_device_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('a',64),1,
  'cc000000-0000-4000-8000-000000000004','2026-10-05 06:01:00+00') ->> 'endpoint',
  'https://fcm.googleapis.com/fcm/send/synthetic-summary-device','claimed version has a single send attempt');
select extensions.is(private.plannix_morning_summary_dispatch_seconds_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('a',64),
  (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('a',64)),
  1,'cc000000-0000-4000-8000-000000000004','2026-10-05 06:14:58+00'),2,
  'two seconds remain immediately before the London cutoff');
select extensions.is(private.plannix_morning_summary_dispatch_seconds_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('a',64),
  (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('a',64)),
  1,'cc000000-0000-4000-8000-000000000004','2026-10-05 06:15:00+00'),null::integer,
  'dispatch is refused at the cutoff');
select extensions.is(private.plannix_claim_morning_summary_device_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('a',64),1,
  'cc000000-0000-4000-8000-000000000004','2026-10-05 06:02:00+00'),null::jsonb,
  'in-flight delivery cannot be claimed twice');
select extensions.ok(public.plannix_finish_morning_summary_device(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('a',64),
  (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('a',64)),
  'accepted'),'accepted device is recorded once');
select extensions.is((select state from private.plannix_morning_summary_deliveries),
  'accepted','accepted state is durable in the job');
select extensions.ok((select pg_catalog.count(*)=1 from private.plannix_morning_summary_jobs),
  'one user/day job exists');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','cc000000-0000-4000-8000-000000000099',
  'authenticated','authenticated','summary-reassigned@example.test','',pg_catalog.now(),
  '{"provider":"email","providers":["email"]}','{}',pg_catalog.now(),pg_catalog.now());
set local role service_role;
select extensions.throws_ok($$select public.plannix_morning_summary_notification_snapshot(
  'cc000000-0000-4000-8000-000000000099',
  (select (claim->0->>'notificationRef')::uuid from summary_claim_fixture))$$,
  'P0002','Daily summary is unavailable.','new account cannot resolve previous account reference');
reset role;
insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key)
values (pg_catalog.repeat('d',64),'cc000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/fcm/send/synthetic-reassigned-device',pg_catalog.repeat('x',88),pg_catalog.repeat('y',22));
select extensions.ok(private.plannix_claim_morning_summary_device_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('d',64),1,
  'cc000000-0000-4000-8000-000000000004','2026-10-05 06:03:00+00') is not null,
  'device is claimed before reassignment');
set local role service_role;
select public.plannix_push_register_device('cc000000-0000-4000-8000-000000000099',pg_catalog.repeat('d',64),
  'https://fcm.googleapis.com/fcm/send/synthetic-reassigned-device',pg_catalog.repeat('x',88),pg_catalog.repeat('y',22));
reset role;
select extensions.is(private.plannix_morning_summary_dispatch_seconds_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('d',64),
  (select subscription_version from private.plannix_morning_summary_deliveries where endpoint_hash=pg_catalog.repeat('d',64)),
  1,'cc000000-0000-4000-8000-000000000004','2026-10-05 06:04:00+00'),null::integer,
  'reassigned subscription cannot pass the final dispatch check');
select extensions.ok(public.plannix_finish_morning_summary_device(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('d',64),
  (select subscription_version from private.plannix_morning_summary_deliveries where endpoint_hash=pg_catalog.repeat('d',64)),
  'skipped'),'stale claim is recorded without a transport attempt');

insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key)
values (pg_catalog.repeat('b',64),'cc000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/fcm/send/synthetic-retry-device',pg_catalog.repeat('x',88),pg_catalog.repeat('y',22)),
  (pg_catalog.repeat('c',64),'cc000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/fcm/send/synthetic-crash-device',pg_catalog.repeat('x',88),pg_catalog.repeat('y',22));
select extensions.ok(private.plannix_claim_morning_summary_device_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('b',64),1,
  'cc000000-0000-4000-8000-000000000004','2026-10-05 06:03:00+00') is not null,
  'second device claimed independently');
select extensions.ok(public.plannix_finish_morning_summary_device(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('b',64),
  (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('b',64)),
  'retryable'),'explicit rejected delivery can retry');
select extensions.ok(private.plannix_claim_morning_summary_device_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('b',64),1,
  'cc000000-0000-4000-8000-000000000004','2026-10-05 06:04:00+00') is not null,
  'one bounded retry is claimed');
select extensions.is((select attempts from private.plannix_morning_summary_deliveries where endpoint_hash=pg_catalog.repeat('b',64)),
  2::smallint,'retry attempt limit advances atomically');
select extensions.ok(public.plannix_finish_morning_summary_device(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('b',64),
  (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('b',64)),
  'uncertain'),'ambiguous outcome marked uncertain');
select extensions.is(private.plannix_claim_morning_summary_device_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('b',64),1,
  'cc000000-0000-4000-8000-000000000004','2026-10-05 06:05:00+00'),null::jsonb,
  'uncertain result is not retried');
select extensions.ok(private.plannix_claim_morning_summary_device_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_claim_fixture),pg_catalog.repeat('c',64),1,
  'cc000000-0000-4000-8000-000000000004','2026-10-05 06:05:00+00') is not null,
  'third device starts before simulated worker crash');
update private.plannix_morning_summary_jobs set lease_until=pg_catalog.clock_timestamp()-interval '1 second';
create temp table summary_reclaim_fixture(claim jsonb);
insert into summary_reclaim_fixture select private.plannix_claim_morning_summary_jobs_at('2026-10-05 06:06:00+00',4);
select extensions.is((select pg_catalog.jsonb_array_length(claim) from summary_reclaim_fixture),1,
  'expired worker lease is recoverable inside window');
select extensions.is(private.plannix_claim_morning_summary_device_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_reclaim_fixture),pg_catalog.repeat('c',64),1,
  'cc000000-0000-4000-8000-000000000004','2026-10-05 06:07:00+00'),null::jsonb,
  'crashed in-flight device is not resent');
select extensions.is(private.plannix_claim_morning_summary_device_at(
  'cc000000-0000-4000-8000-000000000001','2026-10-05',
  (select (claim->0->>'token')::uuid from summary_reclaim_fixture),pg_catalog.repeat('a',64),1,
  'cc000000-0000-4000-8000-000000000004','2026-10-05 06:07:00+00'),null::jsonb,
  'accepted device is not resent when another device failed');
select extensions.ok(public.plannix_finish_morning_summary_job('cc000000-0000-4000-8000-000000000001',
  '2026-10-05',(select (claim->0->>'token')::uuid from summary_reclaim_fixture)),
  'reclaimed job can finish');
select extensions.is(pg_catalog.jsonb_array_length(private.plannix_claim_morning_summary_jobs_at('2026-10-05 06:08:00+00',4)),0,
  'completed user/day cannot be claimed again');

insert into public.plannix_holidays(academic_year_id,name,start_date,end_date,holiday_type)
values ('cc000000-0000-4000-8000-000000000004','Synthetic INSET closure','2026-10-05','2026-10-06','school');
set local role service_role;
select extensions.throws_ok($$select public.plannix_morning_summary_snapshot(
  'cc000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000004','2026-10-05')$$,
  'P0002','Daily summary is unavailable.','inclusive closure blocks a populated day with events');
reset role;

select * from extensions.finish();
rollback;
