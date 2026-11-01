begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to service_role;
select extensions.no_plan();

select extensions.ok(not has_table_privilege('authenticated','private.plannix_push_subscriptions','SELECT,INSERT,UPDATE,DELETE'),
  'browser role cannot access installation rows');
select extensions.ok(not has_function_privilege('authenticated',
  'public.plannix_push_register_installation(uuid,text,text,text,text,uuid)','EXECUTE'),
  'browser role cannot register an installation');
select extensions.ok(not has_function_privilege('anon',
  'public.plannix_push_observe_installation(uuid,text,text,text)','EXECUTE'),
  'anon cannot observe a binding version');
select extensions.ok(has_function_privilege('service_role',
  'public.plannix_push_register_installation(uuid,text,text,text,text,uuid)','EXECUTE'),
  'service role can register through the restricted RPC');
select extensions.ok(not has_function_privilege('service_role',
  'private.plannix_push_current_session(uuid)','EXECUTE'),
  'service role cannot invoke internal session helper');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000', id,'authenticated','authenticated',
  'push-binding-' || id || '@example.test','',pg_catalog.now(),'{}','{}',pg_catalog.now(),pg_catalog.now()
from (values ('ee000000-0000-4000-8000-000000000001'::uuid),
  ('ee000000-0000-4000-8000-000000000002'::uuid)) as fixture(id);
insert into private.plannix_auth_browser_bindings(id,marker_hash,expires_at)
values ('ee000000-0000-4000-8000-000000000011',pg_catalog.repeat('a',64),pg_catalog.clock_timestamp()+interval '1 day'),
  ('ee000000-0000-4000-8000-000000000012',pg_catalog.repeat('b',64),pg_catalog.clock_timestamp()+interval '1 day');
insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
values ('ee000000-0000-4000-8000-000000000021','ee000000-0000-4000-8000-000000000011',
  910001,'ee000000-0000-4000-8000-000000000001','ordinary',pg_catalog.repeat('c',64),'{}','{}',pg_catalog.clock_timestamp()+interval '1 day'),
  ('ee000000-0000-4000-8000-000000000022','ee000000-0000-4000-8000-000000000012',
  910002,'ee000000-0000-4000-8000-000000000002','ordinary',pg_catalog.repeat('d',64),'{}','{}',pg_catalog.clock_timestamp()+interval '1 day');
update private.plannix_auth_browser_bindings set current_session_id=
  case when marker_hash=pg_catalog.repeat('a',64) then 'ee000000-0000-4000-8000-000000000021'::uuid
  else 'ee000000-0000-4000-8000-000000000022'::uuid end
  where marker_hash in (pg_catalog.repeat('a',64),pg_catalog.repeat('b',64));

set local role service_role;
select extensions.is(public.plannix_push_observe_installation('ee000000-0000-4000-8000-000000000021',
  pg_catalog.repeat('f',64),pg_catalog.repeat('p',87),pg_catalog.repeat('q',22))->>'state','absent',
  'first registration observes an absent endpoint');
select extensions.is(public.plannix_push_register_installation('ee000000-0000-4000-8000-000000000021',
  pg_catalog.repeat('f',64),'https://fcm.googleapis.com/fcm/send/fixture-device',
  pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),null)->>'state','registered',
  'A registers the endpoint');
select extensions.is(public.plannix_push_register_installation('ee000000-0000-4000-8000-000000000021',
  pg_catalog.repeat('f',64),'https://fcm.googleapis.com/fcm/send/fixture-device',
  pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),null)->>'state','conflict',
  'duplicate first registration does not overwrite');
select extensions.is(public.plannix_push_observe_installation('ee000000-0000-4000-8000-000000000022',
  pg_catalog.repeat('f',64),pg_catalog.repeat('p',87),pg_catalog.repeat('q',22))->>'state','current',
  'B can observe version with the same browser subscription keys');
reset role;
select pg_catalog.set_config('test.first_version',installation_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('f',64);
set local role service_role;
select extensions.is(public.plannix_push_register_installation('ee000000-0000-4000-8000-000000000022',
  pg_catalog.repeat('f',64),'https://fcm.googleapis.com/fcm/send/fixture-device',
  pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),pg_catalog.current_setting('test.first_version')::uuid)->>'state',
  'registered','B reassigns only with observed version');
select extensions.is(public.plannix_push_register_installation('ee000000-0000-4000-8000-000000000021',
  pg_catalog.repeat('f',64),'https://fcm.googleapis.com/fcm/send/fixture-device',
  pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),pg_catalog.current_setting('test.first_version')::uuid)->>'state',
  'conflict','late A registration cannot reclaim B');
select extensions.is(public.plannix_push_remove_installation('ee000000-0000-4000-8000-000000000021',
  pg_catalog.repeat('f',64),pg_catalog.current_setting('test.first_version')::uuid),false,
  'late A removal cannot delete B');
reset role;
select extensions.is(user_id::text,'ee000000-0000-4000-8000-000000000002',
  'B remains authoritative') from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('f',64);
select extensions.ok(detail_disabled and bound_session_id='ee000000-0000-4000-8000-000000000022',
  'new binding is tied to B session and detail stays disabled')
  from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('f',64);
insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
values ('ee000000-0000-4000-8000-000000000023','ee000000-0000-4000-8000-000000000012',
  910003,'ee000000-0000-4000-8000-000000000002','ordinary',pg_catalog.repeat('e',64),'{}','{}',pg_catalog.clock_timestamp()+interval '1 day');
update private.plannix_auth_sessions set revoked=true where id='ee000000-0000-4000-8000-000000000022';
update private.plannix_auth_browser_bindings set current_session_id='ee000000-0000-4000-8000-000000000023'
  where id='ee000000-0000-4000-8000-000000000012';
select pg_catalog.set_config('test.second_version',installation_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('f',64);
set local role service_role;
select extensions.is(public.plannix_push_register_installation('ee000000-0000-4000-8000-000000000022',
  pg_catalog.repeat('f',64),'https://fcm.googleapis.com/fcm/send/fixture-device',
  pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),
  pg_catalog.current_setting('test.second_version')::uuid)->>'state',
  'stale','same-account old session cannot re-register');
select extensions.ok(not public.plannix_push_remove_installation('ee000000-0000-4000-8000-000000000022',
  pg_catalog.repeat('f',64),pg_catalog.current_setting('test.second_version')::uuid),
  'same-account old session cannot remove');
select extensions.is(public.plannix_push_claim_installation('ee000000-0000-4000-8000-000000000023',
  pg_catalog.repeat('f',64),pg_catalog.repeat('p',87),pg_catalog.repeat('q',22))->>'state','current',
  'new current session can claim own generic binding');
select extensions.is(public.plannix_push_status_installation('ee000000-0000-4000-8000-000000000023',
  pg_catalog.repeat('f',64))->>'registered','true',
  'same-owner generic subscription remains registered after session replacement');
select extensions.is(public.plannix_push_status_installation('ee000000-0000-4000-8000-000000000023',
  pg_catalog.repeat('f',64))->>'boundToCurrentSession','false',
  'generic ownership does not imply current-session binding');
select extensions.is(public.plannix_push_status_installation('ee000000-0000-4000-8000-000000000023',
  pg_catalog.repeat('f',64))->>'detailEligible','false',
  'status never enables detailed delivery');
reset role;
select extensions.ok(bound_session_id <> (select current_session_id from private.plannix_auth_browser_bindings
  where id='ee000000-0000-4000-8000-000000000012'),
  'old installation session is not the current detail-authorizing session')
  from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.repeat('f',64);
update private.plannix_auth_browser_bindings set expires_at=pg_catalog.clock_timestamp()-interval '1 second'
  where id='ee000000-0000-4000-8000-000000000012';
set local role service_role;
select extensions.is(public.plannix_push_observe_installation('ee000000-0000-4000-8000-000000000023',
  pg_catalog.repeat('f',64),pg_catalog.repeat('p',87),pg_catalog.repeat('q',22))->>'state','stale',
  'binding expiry blocks observation');
reset role;
select extensions.ok(expired and revoked,'observed binding expiry becomes terminal')
  from private.plannix_auth_browser_bindings where id='ee000000-0000-4000-8000-000000000012';
update private.plannix_auth_browser_bindings set expires_at=pg_catalog.clock_timestamp()+interval '1 day'
  where id='ee000000-0000-4000-8000-000000000012';
set local role service_role;
select extensions.is(public.plannix_push_observe_installation('ee000000-0000-4000-8000-000000000023',
  pg_catalog.repeat('f',64),pg_catalog.repeat('p',87),pg_catalog.repeat('q',22))->>'state','stale',
  'clock rollback cannot revive the expired binding');
do $$
declare n integer;
begin
  for n in 1..10 loop
    perform public.plannix_push_register_installation('ee000000-0000-4000-8000-000000000021',
      pg_catalog.lpad(pg_catalog.to_hex(n),64,'0'),
      'https://fcm.googleapis.com/fcm/send/fixture-device',
      pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),null);
  end loop;
end;
$$;
select extensions.is(public.plannix_push_register_installation('ee000000-0000-4000-8000-000000000021',
  pg_catalog.repeat('9',64),'https://fcm.googleapis.com/fcm/send/fixture-device',
  pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),null)->>'state','limit',
  'the eleventh installation cannot exceed the per-owner device limit');
reset role;
select pg_catalog.set_config('test.a_marker','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where id='ee000000-0000-4000-8000-000000000011';
select pg_catalog.set_config('test.a_device_version',installation_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.lpad('1',64,'0');
set local role service_role;
select pg_catalog.set_config('test.a_intent',public.plannix_auth_begin(
  pg_catalog.current_setting('test.a_marker'),pg_catalog.repeat('a',64),'ordinary',
  '__Host-plannix-s-910001',pg_catalog.repeat('c',64))->>'intentId',true);
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.a_intent')::uuid,
  'created','ee000000-0000-4000-8000-000000000002',pg_catalog.repeat('1',64),'{}','{}')->>'state',
  'created','auth settlement replaces the old account in the same browser binding');
select extensions.is(public.plannix_push_register_installation('ee000000-0000-4000-8000-000000000021',
  pg_catalog.lpad('1',64,'0'),'https://fcm.googleapis.com/fcm/send/fixture-device',
  pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),
  pg_catalog.current_setting('test.a_device_version')::uuid)->>'state',
  'stale','old-account work cannot register after an auth callback or login settles');
reset role;
select extensions.is(user_id::text,'ee000000-0000-4000-8000-000000000001',
  'stale callback-era work did not modify the generic device')
  from private.plannix_push_subscriptions where endpoint_hash=pg_catalog.lpad('1',64,'0');
select extensions.finish();
rollback;
