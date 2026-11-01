begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to service_role;
select extensions.no_plan();

select extensions.ok(not has_table_privilege('service_role','private.plannix_push_endpoint_history','SELECT,INSERT,UPDATE,DELETE'),
  'service role cannot manipulate endpoint history directly');
select extensions.ok(not has_table_privilege('authenticated','private.plannix_push_endpoint_history','SELECT,INSERT,UPDATE,DELETE'),
  'browser role cannot manipulate endpoint history');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_push_status_installation(uuid,text)','EXECUTE'),
  'browser role cannot call status directly');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','ed000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','push-history@example.test','',now(),'{}','{}',now(),now());
insert into private.plannix_auth_browser_bindings(id,marker_hash,expires_at,current_session_id)
values ('ed000000-0000-4000-8000-000000000011',repeat('a',64),now()+interval '1 day',
  'ed000000-0000-4000-8000-000000000021');
insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
values ('ed000000-0000-4000-8000-000000000021','ed000000-0000-4000-8000-000000000011',
  930001,'ed000000-0000-4000-8000-000000000001','ordinary',repeat('c',64),'{}','{}',now()+interval '1 day');

set local role service_role;
select extensions.is(public.plannix_push_register_installation('ed000000-0000-4000-8000-000000000021',
  repeat('f',64),'https://fcm.googleapis.com/fcm/send/history-fixture',repeat('p',87),repeat('q',22),null)->>'state',
  'registered','first server-bound registration succeeds');
select extensions.is(public.plannix_push_status_installation('ed000000-0000-4000-8000-000000000021',repeat('f',64))->>'registered',
  'true','generic ownership is reported');
select extensions.is(public.plannix_push_status_installation('ed000000-0000-4000-8000-000000000021',repeat('f',64))->>'detailEligible',
  'false','detail authorization stays disabled');
select extensions.throws_ok($$select public.plannix_push_register_device(
  'ed000000-0000-4000-8000-000000000001',repeat('f',64),
  'https://fcm.googleapis.com/fcm/send/history-fixture',repeat('p',87),repeat('q',22))$$,
  'P2002','Legacy notification write is unsupported.','legacy registration cannot rewrite a bound row');
reset role;
select extensions.throws_ok($$update private.plannix_push_subscriptions
  set subscription_version=gen_random_uuid() where endpoint_hash=repeat('f',64)$$,
  'P2002','Legacy notification write is unsupported.',
  'table trigger blocks an already-admitted old update body');
select extensions.throws_ok($$insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key)
  values(repeat('f',64),'ed000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/fcm/send/history-fixture',repeat('p',87),repeat('q',22))
  on conflict(endpoint_hash) do update set subscription_version=gen_random_uuid()$$,
  'P2002','Notification installation changed.',
  'table trigger blocks an already-admitted old upsert body');
select set_config('test.history_first',installation_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=repeat('f',64);
select set_config('test.generic_first',subscription_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=repeat('f',64);
set local role service_role;
select extensions.throws_ok(format($$select public.plannix_push_remove_device(
  'ed000000-0000-4000-8000-000000000001',repeat('f',64),%L::uuid)$$,
  current_setting('test.generic_first')),'P2002','Legacy notification write is unsupported.',
  'legacy removal cannot delete a bound row even with its current generic version');
select extensions.ok(public.plannix_push_remove_installation('ed000000-0000-4000-8000-000000000021',
  repeat('f',64),current_setting('test.history_first')::uuid),'current version can remove');
select extensions.is(public.plannix_push_register_installation('ed000000-0000-4000-8000-000000000021',
  repeat('f',64),'https://fcm.googleapis.com/fcm/send/history-fixture',repeat('p',87),repeat('q',22),null)->>'state',
  'conflict','delayed null first-registration cannot recreate removed endpoint');
select extensions.is(public.plannix_push_register_installation('ed000000-0000-4000-8000-000000000021',
  repeat('f',64),'https://fcm.googleapis.com/fcm/send/history-fixture',repeat('p',87),repeat('q',22),
  current_setting('test.history_first')::uuid)->>'state','conflict','old version cannot recreate removed endpoint');
select extensions.throws_ok($$select public.plannix_push_register_device(
  'ed000000-0000-4000-8000-000000000001',repeat('f',64),
  'https://fcm.googleapis.com/fcm/send/history-fixture',repeat('p',87),repeat('q',22))$$,
  'P2002','Legacy notification write is unsupported.','legacy first registration cannot reuse tombstone');
select set_config('test.history_tombstone',public.plannix_push_observe_installation(
  'ed000000-0000-4000-8000-000000000021',repeat('f',64),repeat('p',87),repeat('q',22))->>'version',true);
select extensions.is(public.plannix_push_register_installation('ed000000-0000-4000-8000-000000000021',
  repeat('f',64),'https://fcm.googleapis.com/fcm/send/history-fixture',repeat('p',87),repeat('q',22),
  current_setting('test.history_tombstone')::uuid)->>'state','registered',
  'explicit new observation permits legitimate re-enablement');
reset role;
select extensions.ok((select installation_version<>current_setting('test.history_first')::uuid
  from private.plannix_push_subscriptions where endpoint_hash=repeat('f',64)),
  're-enablement receives a fresh version');
select extensions.ok((select active and server_managed_seen from private.plannix_push_endpoint_history
  where endpoint_hash=repeat('f',64)),'history remains active and permanently server-managed');
select set_config('test.history_reenabled',generation::text,true)
  from private.plannix_push_endpoint_history where endpoint_hash=repeat('f',64);
delete from auth.users where id='ed000000-0000-4000-8000-000000000001';
select extensions.ok(not exists(select 1 from private.plannix_push_subscriptions where endpoint_hash=repeat('f',64)),
  'account deletion removes the active generic subscription');
select extensions.ok((select not active and generation<>current_setting('test.history_reenabled')::uuid
  from private.plannix_push_endpoint_history where endpoint_hash=repeat('f',64)),
  'account deletion retains a rotated endpoint tombstone');
select extensions.finish();
rollback;
