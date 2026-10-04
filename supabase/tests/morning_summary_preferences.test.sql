begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',confirmed,
 '{"provider":"email","providers":["email"]}','{}',pg_catalog.now(),pg_catalog.now()
from (values
 ('cb000000-0000-4000-8000-000000000001'::uuid,'summary-fixture-one@example.test',pg_catalog.now()),
 ('cb000000-0000-4000-8000-000000000002'::uuid,'summary-fixture-two@example.test',pg_catalog.now()),
 ('cb000000-0000-4000-8000-000000000003'::uuid,'summary-unconfirmed@example.test',null::timestamptz)
) as fixtures(id,email,confirmed);
insert into public.plannix_organisations(id,name,organisation_type) values
 ('cb000000-0000-4000-8000-000000000011','Summary one','personal'),
 ('cb000000-0000-4000-8000-000000000012','Summary two','personal'),
 ('cb000000-0000-4000-8000-000000000013','Summary school','school');
insert into private.plannix_personal_organisations(user_id,organisation_id) values
 ('cb000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000011'),
 ('cb000000-0000-4000-8000-000000000002','cb000000-0000-4000-8000-000000000012');
insert into public.plannix_organisation_users(id,user_id,organisation_id) values
 ('cb000000-0000-4000-8000-000000000021','cb000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000011'),
 ('cb000000-0000-4000-8000-000000000022','cb000000-0000-4000-8000-000000000002','cb000000-0000-4000-8000-000000000012'),
 ('cb000000-0000-4000-8000-000000000023','cb000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000013');
insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date) values
 ('cb000000-0000-4000-8000-000000000031','cb000000-0000-4000-8000-000000000011','2026-27','2026-09-01','2027-08-31'),
 ('cb000000-0000-4000-8000-000000000032','cb000000-0000-4000-8000-000000000012','2026-27','2026-09-01','2027-08-31'),
 ('cb000000-0000-4000-8000-000000000033','cb000000-0000-4000-8000-000000000013','2026-27','2026-09-01','2027-08-31');

select extensions.ok(not has_table_privilege('anon','private.plannix_morning_summary_preferences','SELECT,INSERT,UPDATE,DELETE'), 'anon cannot access preferences');
select extensions.ok(not has_table_privilege('authenticated','private.plannix_morning_summary_preferences','SELECT,INSERT,UPDATE,DELETE'), 'authenticated cannot access preferences');
select extensions.ok(not has_table_privilege('service_role','private.plannix_morning_summary_preferences','SELECT'), 'service role uses RPCs only');
select extensions.ok(has_function_privilege('service_role','public.plannix_get_morning_summary_preferences(uuid)','EXECUTE'), 'service role may read preferences by RPC');
select extensions.ok(has_function_privilege('service_role','public.plannix_save_morning_summary_preferences(uuid,bigint,boolean,text,uuid)','EXECUTE'), 'service role may save preferences by RPC');
select extensions.ok(not has_function_privilege('anon','public.plannix_get_morning_summary_preferences(uuid)','EXECUTE'), 'anon cannot read RPC');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_save_morning_summary_preferences(uuid,bigint,boolean,text,uuid)','EXECUTE'), 'authenticated cannot save RPC');
select extensions.ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a
 where p.oid='public.plannix_get_morning_summary_preferences(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC cannot read RPC');
select extensions.ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a
 where p.oid='public.plannix_save_morning_summary_preferences(uuid,bigint,boolean,text,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC cannot save RPC');

set local role service_role;
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'deliveryTime', '07:00', 'default time');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'enabled', 'false', 'default opt-in off');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'revision', '0', 'absent row starts at revision zero');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'academicYearId', null::text, 'old/absent preference has no year');
select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',0,true,'06:45','cb000000-0000-4000-8000-000000000031');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'deliveryTime', '06:45', 'first user time');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'enabled', 'true', 'first user opt-in');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'revision', '1', 'first save advances revision');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',0,false,'09:00','cb000000-0000-4000-8000-000000000031')$$,
  '40001','Morning summary preferences changed.','second first save conflicts');
select extensions.is(public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',1,false,'07:15','cb000000-0000-4000-8000-000000000031') ->> 'revision',
  '2','matching update advances revision once');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',1,true,'09:00','cb000000-0000-4000-8000-000000000031')$$,
  '40001','Morning summary preferences changed.','stale update conflicts');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'deliveryTime', '07:15',
  'stale update leaves newer time intact');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000002') ->> 'enabled', 'false', 'second user remains off');
select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000002',0,false,'08:30','cb000000-0000-4000-8000-000000000032');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000002') ->> 'deliveryTime', '08:30', 'second user time isolated');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',2,true,'24:00','cb000000-0000-4000-8000-000000000031')$$,'22023','Invalid morning summary preferences.','invalid time rejected');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',2,null,'08:00','cb000000-0000-4000-8000-000000000031')$$,'22023','Invalid morning summary preferences.','null opt-in rejected');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',null,true,'08:00','cb000000-0000-4000-8000-000000000031')$$,'22023','Invalid morning summary preferences.','missing revision rejected');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',2,true,'08:00','cb000000-0000-4000-8000-000000000032')$$,'22023','Invalid morning summary preferences.','foreign personal year rejected');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',2,true,'08:00','cb000000-0000-4000-8000-000000000033')$$,'22023','Invalid morning summary preferences.','school year rejected');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',2,true,'08:00',null)$$,'22023','Invalid morning summary preferences.','missing year rejected');
select extensions.throws_ok($$select public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000003')$$,'42501','Confirmed user required.','unconfirmed user rejected');
reset role;
select extensions.is((select pg_catalog.count(*) from private.plannix_morning_summary_preferences),2::bigint,'only two user records exist');
select extensions.is((select pg_catalog.count(*) from private.plannix_morning_summary_preferences where enabled),0::bigint,'only committed preference values remain');
select extensions.ok(not has_table_privilege('authenticated','private.plannix_morning_summary_jobs','SELECT,INSERT,UPDATE,DELETE'), 'browser cannot access claims');
select extensions.ok(not has_table_privilege('authenticated','private.plannix_morning_summary_deliveries','SELECT,INSERT,UPDATE,DELETE'), 'browser cannot access delivery state');
select extensions.ok(has_function_privilege('service_role','public.plannix_claim_morning_summary_jobs(integer)','EXECUTE'), 'worker can claim');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_claim_morning_summary_jobs(integer)','EXECUTE'), 'browser cannot claim');
select extensions.is(private.plannix_morning_summary_due_date('2026-10-05 06:00:00+00','07:00'),'2026-10-05'::date,'London delivery window begins inclusively');
select extensions.is(private.plannix_morning_summary_due_date('2026-10-05 06:14:59+00','07:00'),'2026-10-05'::date,'London delivery window includes final second');
select extensions.is(private.plannix_morning_summary_due_date('2026-10-05 06:15:00+00','07:00'),null::date,'London delivery window ends after 15 minutes');
select extensions.is(private.plannix_morning_summary_due_date('2026-10-05 23:00:00+00','23:55'),'2026-10-05'::date,'post-midnight window retains original date');
select extensions.is(private.plannix_morning_summary_due_date('2027-03-28 01:35:00+00','01:30'),null::date,'nonexistent spring clock time does not catch up');
select extensions.is(private.plannix_morning_summary_due_date('2027-10-31 00:35:00+00','01:30'),'2027-10-31'::date,'first autumn clock occurrence');
select extensions.is(private.plannix_morning_summary_due_date('2027-10-31 01:35:00+00','01:30'),'2027-10-31'::date,'second autumn clock occurrence maps to same day');
select * from extensions.finish();
rollback;
