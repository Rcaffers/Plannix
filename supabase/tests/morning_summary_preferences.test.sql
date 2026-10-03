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

select extensions.ok(not has_table_privilege('anon','private.plannix_morning_summary_preferences','SELECT,INSERT,UPDATE,DELETE'), 'anon cannot access preferences');
select extensions.ok(not has_table_privilege('authenticated','private.plannix_morning_summary_preferences','SELECT,INSERT,UPDATE,DELETE'), 'authenticated cannot access preferences');
select extensions.ok(not has_table_privilege('service_role','private.plannix_morning_summary_preferences','SELECT'), 'service role uses RPCs only');
select extensions.ok(has_function_privilege('service_role','public.plannix_get_morning_summary_preferences(uuid)','EXECUTE'), 'service role may read preferences by RPC');
select extensions.ok(has_function_privilege('service_role','public.plannix_save_morning_summary_preferences(uuid,bigint,boolean,text)','EXECUTE'), 'service role may save preferences by RPC');
select extensions.ok(not has_function_privilege('anon','public.plannix_get_morning_summary_preferences(uuid)','EXECUTE'), 'anon cannot read RPC');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_save_morning_summary_preferences(uuid,bigint,boolean,text)','EXECUTE'), 'authenticated cannot save RPC');
select extensions.ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a
 where p.oid='public.plannix_get_morning_summary_preferences(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC cannot read RPC');
select extensions.ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a
 where p.oid='public.plannix_save_morning_summary_preferences(uuid,bigint,boolean,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC cannot save RPC');

set local role service_role;
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'deliveryTime', '07:00', 'default time');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'enabled', 'false', 'default opt-in off');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'revision', '0', 'absent row starts at revision zero');
select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',0,true,'06:45');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'deliveryTime', '06:45', 'first user time');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'enabled', 'true', 'first user opt-in');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'revision', '1', 'first save advances revision');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',0,false,'09:00')$$,
  '40001','Morning summary preferences changed.','second first save conflicts');
select extensions.is(public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',1,false,'07:15') ->> 'revision',
  '2','matching update advances revision once');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',1,true,'09:00')$$,
  '40001','Morning summary preferences changed.','stale update conflicts');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000001') ->> 'deliveryTime', '07:15',
  'stale update leaves newer time intact');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000002') ->> 'enabled', 'false', 'second user remains off');
select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000002',0,false,'08:30');
select extensions.is(public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000002') ->> 'deliveryTime', '08:30', 'second user time isolated');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',2,true,'24:00')$$,'22023','Invalid morning summary preferences.','invalid time rejected');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',2,null,'08:00')$$,'22023','Invalid morning summary preferences.','null opt-in rejected');
select extensions.throws_ok($$select public.plannix_save_morning_summary_preferences('cb000000-0000-4000-8000-000000000001',null,true,'08:00')$$,'22023','Invalid morning summary preferences.','missing revision rejected');
select extensions.throws_ok($$select public.plannix_get_morning_summary_preferences('cb000000-0000-4000-8000-000000000003')$$,'42501','Confirmed user required.','unconfirmed user rejected');
reset role;
select extensions.is((select pg_catalog.count(*) from private.plannix_morning_summary_preferences),2::bigint,'only two user records exist');
select extensions.is((select pg_catalog.count(*) from private.plannix_morning_summary_preferences where enabled),0::bigint,'only committed preference values remain');
select * from extensions.finish();
rollback;
