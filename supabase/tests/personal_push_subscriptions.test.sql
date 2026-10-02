begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',pg_catalog.now(),
 '{"provider":"email","providers":["email"]}','{}',pg_catalog.now(),pg_catalog.now()
from (values
 ('ca000000-0000-4000-8000-000000000001'::uuid,'push-fixture-one@example.test'),
 ('ca000000-0000-4000-8000-000000000002'::uuid,'push-fixture-two@example.test')
) as fixtures(id,email);

select extensions.ok(not has_table_privilege('authenticated','private.plannix_push_subscriptions','SELECT,INSERT,UPDATE,DELETE'), 'browser role has no subscription table privileges');
select extensions.ok(not has_table_privilege('anon','private.plannix_push_subscriptions','SELECT,INSERT,UPDATE,DELETE'), 'anon has no subscription table privileges');
select extensions.ok(has_function_privilege('service_role','public.plannix_push_register_device(uuid,text,text,text,text)','EXECUTE'), 'service role can register');
select extensions.ok(has_function_privilege('service_role','public.plannix_push_remove_expired_device(uuid,text,uuid)','EXECUTE'), 'service role can conditionally remove expired device');
select extensions.ok(has_function_privilege('service_role','public.plannix_push_claim_device(uuid,text,text,text)','EXECUTE'), 'service role can claim an exact device');
select extensions.ok(has_function_privilege('service_role','public.plannix_push_remove_device(uuid,text,uuid)','EXECUTE'), 'service role can conditionally remove an ordinary device');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_push_claim_device(uuid,text,text,text)','EXECUTE'), 'authenticated cannot claim an exact device');
select extensions.ok(not has_function_privilege('anon','public.plannix_push_claim_device(uuid,text,text,text)','EXECUTE'), 'anon cannot claim an exact device');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_push_remove_device(uuid,text,uuid)','EXECUTE'), 'authenticated cannot remove an ordinary device');
select extensions.ok(not has_function_privilege('anon','public.plannix_push_remove_device(uuid,text,uuid)','EXECUTE'), 'anon cannot remove an ordinary device');
select extensions.ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a
 where p.oid='public.plannix_push_claim_device(uuid,text,text,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC cannot claim an exact device');
select extensions.ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a
 where p.oid='public.plannix_push_remove_device(uuid,text,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC cannot remove an ordinary device');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_push_remove_expired_device(uuid,text,uuid)','EXECUTE'), 'authenticated cannot conditionally remove device');
select extensions.ok(not has_function_privilege('anon','public.plannix_push_remove_expired_device(uuid,text,uuid)','EXECUTE'), 'anon cannot conditionally remove device');
select extensions.ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a
 where p.oid='public.plannix_push_remove_expired_device(uuid,text,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC cannot conditionally remove device');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_push_register_device(uuid,text,text,text,text)','EXECUTE'), 'authenticated cannot register RPC');
select extensions.ok(not has_function_privilege('anon','public.plannix_push_claim_test(uuid,text)','EXECUTE'), 'anon cannot claim tests');
select extensions.ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a
 where p.oid='public.plannix_push_claim_test(uuid,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC cannot claim tests');

set local role service_role;
select public.plannix_push_register_device('ca000000-0000-4000-8000-000000000001',repeat('a',64),
 'https://fcm.googleapis.com/fcm/send/fixture-device-one',repeat('p',87),repeat('q',22));
select public.plannix_push_register_device('ca000000-0000-4000-8000-000000000001',repeat('b',64),
 'https://web.push.apple.com/fixture-device-two',repeat('r',87),repeat('s',22));
select public.plannix_push_register_device('ca000000-0000-4000-8000-000000000001',repeat('d',64),
 'https://fcm.googleapis.com/fcm/send/fixture-replacement',repeat('p',87),repeat('q',22));
reset role;
create temporary table push_old_version as
 select subscription_version from private.plannix_push_subscriptions where endpoint_hash=repeat('d',64);
set local role service_role;
select public.plannix_push_register_device('ca000000-0000-4000-8000-000000000001',repeat('d',64),
 'https://fcm.googleapis.com/fcm/send/fixture-replacement',repeat('r',87),repeat('s',22));
reset role;
select extensions.ok((select s.subscription_version <> v.subscription_version from private.plannix_push_subscriptions s
 cross join push_old_version v where s.endpoint_hash=repeat('d',64)), 'replacement receives a distinct version');
select extensions.is((public.plannix_push_claim_device('ca000000-0000-4000-8000-000000000001',repeat('d',64),
 repeat('p',87),repeat('q',22)) ->> 'state'),'superseded','old keys cannot claim replacement');
select extensions.is((public.plannix_push_claim_device('ca000000-0000-4000-8000-000000000001',repeat('d',64),
 repeat('r',87),repeat('s',22)) ->> 'state'),'current','replacement keys claim current version');
select extensions.ok(not public.plannix_push_remove_device('ca000000-0000-4000-8000-000000000001',repeat('d',64),
 (select subscription_version from push_old_version)), 'stale ordinary removal cannot delete replacement');
select extensions.is((select p256dh from private.plannix_push_subscriptions where endpoint_hash=repeat('d',64)),repeat('r',87),
 'replacement survives stale ordinary removal');
select extensions.ok(not public.plannix_push_remove_expired_device('ca000000-0000-4000-8000-000000000001',repeat('d',64),
 (select subscription_version from push_old_version)), 'stale expiry does not remove replacement');
select extensions.is((select p256dh from private.plannix_push_subscriptions where endpoint_hash=repeat('d',64)),repeat('r',87),
 'replacement keys survive stale expiry');
select extensions.ok(not public.plannix_push_remove_expired_device('ca000000-0000-4000-8000-000000000002',repeat('d',64),
 (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=repeat('d',64))),
 'other user cannot remove current version');
select extensions.ok(public.plannix_push_remove_expired_device('ca000000-0000-4000-8000-000000000001',repeat('d',64),
 (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=repeat('d',64))),
 'current expired version is removed');
select extensions.ok(not exists(select 1 from private.plannix_push_subscriptions where endpoint_hash=repeat('d',64)),
 'conditional removal deleted only the current version');
set local role service_role;
select extensions.ok(public.plannix_push_device_status('ca000000-0000-4000-8000-000000000001',repeat('a',64)), 'first owner sees own device');
select extensions.ok(not public.plannix_push_device_status('ca000000-0000-4000-8000-000000000002',repeat('a',64)), 'other owner does not see device');
select extensions.is((public.plannix_push_claim_test('ca000000-0000-4000-8000-000000000001',repeat('a',64)) ->> 'endpoint'),
 'https://fcm.googleapis.com/fcm/send/fixture-device-one', 'claim resolves own endpoint only');
select extensions.is((public.plannix_push_claim_test('ca000000-0000-4000-8000-000000000001',repeat('a',64)) ->> 'rateLimited'), 'true', 'repeat test is rate limited');
select extensions.is((public.plannix_push_claim_test('ca000000-0000-4000-8000-000000000001',repeat('b',64)) ->> 'rateLimited'), 'true', 'second device shares user rate limit');
select public.plannix_push_register_device('ca000000-0000-4000-8000-000000000001',repeat('a',64),
 'https://fcm.googleapis.com/fcm/send/fixture-device-one',repeat('p',87),repeat('q',22));
select extensions.is((public.plannix_push_claim_test('ca000000-0000-4000-8000-000000000001',repeat('a',64)) ->> 'rateLimited'), 'true', 're-registering cannot bypass test limit');
select extensions.throws_ok($$select public.plannix_push_claim_test('ca000000-0000-4000-8000-000000000002',repeat('a',64))$$,'P0002','Device not found.','cross-user claim denied');
select public.plannix_push_register_device('ca000000-0000-4000-8000-000000000002',repeat('a',64),
 'https://fcm.googleapis.com/fcm/send/fixture-device-one',repeat('p',87),repeat('q',22));
select extensions.ok(not public.plannix_push_device_status('ca000000-0000-4000-8000-000000000001',repeat('a',64)), 'reassignment removes previous owner');
select extensions.ok(public.plannix_push_device_status('ca000000-0000-4000-8000-000000000002',repeat('a',64)), 'new owner has reassigned device');
select extensions.ok(not public.plannix_push_remove_device('ca000000-0000-4000-8000-000000000001',repeat('a',64),
 (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=repeat('a',64))),
 'departed owner cannot remove reassigned device');
select extensions.ok(public.plannix_push_device_status('ca000000-0000-4000-8000-000000000002',repeat('a',64)), 'old owner cannot remove new owner device');
select extensions.ok(public.plannix_push_remove_device('ca000000-0000-4000-8000-000000000002',repeat('a',64),
 (select subscription_version from private.plannix_push_subscriptions where endpoint_hash=repeat('a',64))),
 'current owner removes claimed version');
select extensions.ok(not public.plannix_push_device_status('ca000000-0000-4000-8000-000000000002',repeat('a',64)), 'owner removes own device');
do $$
declare n integer;
begin
  for n in 1..9 loop
    perform public.plannix_push_register_device('ca000000-0000-4000-8000-000000000001',
      pg_catalog.lpad(pg_catalog.to_hex(n),64,'0'),
      'https://fcm.googleapis.com/fcm/send/fixture-extra-device-' || n,repeat('p',87),repeat('q',22));
  end loop;
end;
$$;
reset role;
select extensions.is((select pg_catalog.count(*) from private.plannix_push_subscriptions
  where user_id='ca000000-0000-4000-8000-000000000001'),10::bigint,'ten devices can be registered');
set local role service_role;
select extensions.throws_ok($$select public.plannix_push_register_device('ca000000-0000-4000-8000-000000000001',repeat('c',64),
  'https://fcm.googleapis.com/fcm/send/fixture-eleventh-device',repeat('p',87),repeat('q',22))$$,
  'P1001','Device limit reached.','eleventh device denied atomically');
reset role;
select * from extensions.finish();
rollback;
