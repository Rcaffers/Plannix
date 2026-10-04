begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(id,email,email_confirmed_at)
values ('dd000000-0000-4000-8000-000000000001','pilot-one@example.test',pg_catalog.now()),
  ('dd000000-0000-4000-8000-000000000002','pilot-two@example.test',pg_catalog.now());
insert into public.plannix_organisations(id,name,organisation_type)
values ('dd000000-0000-4000-8000-000000000011','Pilot one','personal'),
  ('dd000000-0000-4000-8000-000000000012','Pilot two','personal');
insert into private.plannix_personal_organisations(user_id,organisation_id)
values ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000011'),
  ('dd000000-0000-4000-8000-000000000002','dd000000-0000-4000-8000-000000000012');
insert into public.plannix_organisation_users(id,user_id,organisation_id)
values ('dd000000-0000-4000-8000-000000000021','dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000011'),
  ('dd000000-0000-4000-8000-000000000022','dd000000-0000-4000-8000-000000000002','dd000000-0000-4000-8000-000000000012');
insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date)
values ('dd000000-0000-4000-8000-000000000031','dd000000-0000-4000-8000-000000000011','2026-27','2026-09-01','2027-08-31'),
  ('dd000000-0000-4000-8000-000000000032','dd000000-0000-4000-8000-000000000012','2026-27','2026-09-01','2027-08-31');
set local role service_role;
select public.plannix_save_morning_summary_preferences('dd000000-0000-4000-8000-000000000001',0,true,'07:00',
  'dd000000-0000-4000-8000-000000000031');
select public.plannix_save_morning_summary_preferences('dd000000-0000-4000-8000-000000000002',0,true,'07:00',
  'dd000000-0000-4000-8000-000000000032');
reset role;
insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key)
values (pg_catalog.repeat('a',64),'dd000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/fcm/send/synthetic-pilot-one',pg_catalog.repeat('x',88),pg_catalog.repeat('y',22)),
  (pg_catalog.repeat('b',64),'dd000000-0000-4000-8000-000000000002',
  'https://fcm.googleapis.com/fcm/send/synthetic-pilot-two',pg_catalog.repeat('x',88),pg_catalog.repeat('y',22));

select extensions.ok(not has_function_privilege('service_role',
  'public.plannix_claim_morning_summary_jobs(integer)','EXECUTE'),
  'unrestricted claim is no longer available to worker role');
select extensions.ok(has_function_privilege('service_role',
  'public.plannix_claim_morning_summary_pilot_jobs(integer,uuid)','EXECUTE'),
  'service role may claim the pilot only');
select extensions.ok(not has_function_privilege('authenticated',
  'public.plannix_claim_morning_summary_pilot_jobs(integer,uuid)','EXECUTE'),
  'browser role cannot claim pilot jobs');
select extensions.ok(not has_function_privilege('anon',
  'public.plannix_claim_morning_summary_pilot_jobs(integer,uuid)','EXECUTE'),
  'anon cannot claim pilot jobs');
select extensions.ok(not has_function_privilege('service_role',
  'private.plannix_claim_morning_summary_pilot_jobs_at(timestamptz,integer,uuid)','EXECUTE'),
  'service role cannot supply a synthetic clock through private helper');
select extensions.throws_ok($$select private.plannix_claim_morning_summary_pilot_jobs_at(
  '2026-10-05 06:00+00',4,null)$$,'22023','Invalid pilot claim.','null pilot fails closed');
select extensions.is(pg_catalog.jsonb_array_length(private.plannix_claim_morning_summary_pilot_jobs_at(
  '2026-10-05 06:00+00',4,'dd000000-0000-4000-8000-000000000001')),1,
  'only configured pilot is claimed despite two eligible users');
select extensions.is((select pg_catalog.count(*)::integer from private.plannix_morning_summary_jobs
  where user_id='dd000000-0000-4000-8000-000000000002'),0,
  'excluded user has no reserved job or delivery');
select extensions.is(pg_catalog.jsonb_array_length(private.plannix_claim_morning_summary_pilot_jobs_at(
  '2026-10-05 06:00:01+00',4,'dd000000-0000-4000-8000-000000000001')),0,
  'second replica cannot claim the same pilot job');

select * from extensions.finish();
rollback;
