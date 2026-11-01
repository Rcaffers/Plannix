begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to service_role;
select extensions.no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',
  'push-cleanup-'||id||'@example.test','',now(),'{}','{}',now(),now()
from (values ('eb000000-0000-4000-8000-000000000001'::uuid),
  ('eb000000-0000-4000-8000-000000000002'::uuid)) as fixture(id);
insert into private.plannix_auth_browser_bindings(id,marker_hash,expires_at,current_session_id)
values ('eb000000-0000-4000-8000-000000000011',repeat('1',64),now()+interval '1 day','eb000000-0000-4000-8000-000000000021'),
  ('eb000000-0000-4000-8000-000000000012',repeat('2',64),now()+interval '1 day','eb000000-0000-4000-8000-000000000022'),
  ('eb000000-0000-4000-8000-000000000013',repeat('3',64),now()+interval '1 day','eb000000-0000-4000-8000-000000000023'),
  ('eb000000-0000-4000-8000-000000000014',repeat('4',64),now()+interval '1 day','eb000000-0000-4000-8000-000000000024'),
  ('eb000000-0000-4000-8000-000000000015',repeat('5',64),now()+interval '1 day',null);
insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
values ('eb000000-0000-4000-8000-000000000021','eb000000-0000-4000-8000-000000000011',
    nextval('private.plannix_auth_generation_seq'),'eb000000-0000-4000-8000-000000000001','ordinary',repeat('a',64),'{}','{}',now()+interval '1 day'),
  ('eb000000-0000-4000-8000-000000000022','eb000000-0000-4000-8000-000000000012',
    nextval('private.plannix_auth_generation_seq'),'eb000000-0000-4000-8000-000000000001','ordinary',repeat('b',64),'{}','{}',now()+interval '1 day'),
  ('eb000000-0000-4000-8000-000000000023','eb000000-0000-4000-8000-000000000013',
    nextval('private.plannix_auth_generation_seq'),'eb000000-0000-4000-8000-000000000001','ordinary',repeat('c',64),'{}','{}',now()+interval '1 day'),
  ('eb000000-0000-4000-8000-000000000024','eb000000-0000-4000-8000-000000000014',
    nextval('private.plannix_auth_generation_seq'),'eb000000-0000-4000-8000-000000000002','ordinary',repeat('d',64),'{}','{}',now()+interval '1 day');
insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key,bound_session_id)
select hash,user_id,'https://fcm.googleapis.com/fcm/send/cleanup-fixture',repeat('p',87),repeat('q',22),session_id
from (values
  (repeat('a',64),'eb000000-0000-4000-8000-000000000001'::uuid,'eb000000-0000-4000-8000-000000000021'::uuid),
  (repeat('b',64),'eb000000-0000-4000-8000-000000000001'::uuid,'eb000000-0000-4000-8000-000000000022'::uuid),
  (repeat('c',64),'eb000000-0000-4000-8000-000000000001'::uuid,'eb000000-0000-4000-8000-000000000023'::uuid),
  (repeat('d',64),'eb000000-0000-4000-8000-000000000002'::uuid,'eb000000-0000-4000-8000-000000000024'::uuid)
) as fixture(hash,user_id,session_id);

select set_config('test.direct_version',installation_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=repeat('a',64);
select set_config('test.direct_generic',subscription_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=repeat('a',64);
select extensions.throws_ok($$update private.plannix_push_subscriptions set bound_session_id=null
  where endpoint_hash=repeat('a',64)$$,'P2002','Legacy notification write is unsupported.',
  'ordinary NULL update cannot imitate an FK cleanup while its parent exists');
delete from private.plannix_auth_sessions where id='eb000000-0000-4000-8000-000000000021';
select extensions.ok(bound_session_id is null and detail_disabled and
  installation_version<>current_setting('test.direct_version')::uuid and
  subscription_version<>current_setting('test.direct_generic')::uuid,
  'direct session deletion preserves generic row and rotates both versions')
  from private.plannix_push_subscriptions where endpoint_hash=repeat('a',64);
select extensions.ok(h.active and h.server_managed_seen and h.generation=s.installation_version,
  'direct cleanup retains synchronized active endpoint history')
  from private.plannix_push_endpoint_history h join private.plannix_push_subscriptions s using(endpoint_hash)
  where h.endpoint_hash=repeat('a',64);
set local role service_role;
select extensions.is(public.plannix_push_remove_expired_device(
  'eb000000-0000-4000-8000-000000000001',repeat('a',64),
  current_setting('test.direct_generic')::uuid),false,
  'delayed generic cleanup using the old version cannot remove the retained row');
reset role;
select extensions.throws_ok($$select public.plannix_push_register_device(
  'eb000000-0000-4000-8000-000000000001',repeat('a',64),
  'https://fcm.googleapis.com/fcm/send/cleanup-fixture',repeat('p',87),repeat('q',22))$$,
  'P2002','Legacy notification write is unsupported.',
  'legacy registration remains fenced after FK cleanup');

select set_config('test.cascade_version',installation_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=repeat('b',64);
delete from private.plannix_auth_browser_bindings where id='eb000000-0000-4000-8000-000000000012';
select extensions.ok(bound_session_id is null and detail_disabled and
  installation_version<>current_setting('test.cascade_version')::uuid,
  'browser-binding cascade preserves generic row and rotates generation')
  from private.plannix_push_subscriptions where endpoint_hash=repeat('b',64);
select extensions.ok(not exists(select 1 from private.plannix_auth_sessions
  where id='eb000000-0000-4000-8000-000000000022'),
  'browser-binding cascade removes the old auth session');

select set_config('test.bootstrap_version',installation_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=repeat('c',64);
update private.plannix_auth_browser_bindings set expires_at=now()-interval '1 second'
  where id='eb000000-0000-4000-8000-000000000013';
set local role service_role;
select extensions.is(public.plannix_auth_issue_binding(repeat('9',64))->>'state','issued',
  'bootstrap can prune expired binding with a bound subscription');
reset role;
select extensions.ok(bound_session_id is null and detail_disabled and
  installation_version<>current_setting('test.bootstrap_version')::uuid,
  'bootstrap cleanup leaves generic subscription and rotates generation')
  from private.plannix_push_subscriptions where endpoint_hash=repeat('c',64);
select extensions.ok(not exists(select 1 from private.plannix_auth_browser_bindings
  where id='eb000000-0000-4000-8000-000000000013'),
  'bootstrap removed the expired browser binding');

select set_config('test.account_version',installation_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=repeat('d',64);
delete from auth.users where id='eb000000-0000-4000-8000-000000000002';
select extensions.ok(not exists(select 1 from private.plannix_push_subscriptions where endpoint_hash=repeat('d',64)),
  'account deletion removes generic subscription');
select extensions.ok((select not active and generation<>current_setting('test.account_version')::uuid
  from private.plannix_push_endpoint_history where endpoint_hash=repeat('d',64)),
  'account deletion retains a rotated tombstone');

-- Nine prior sessions plus a new settlement invoke retained-session pruning.
do $$
declare n integer;
declare sid uuid;
begin
  for n in 1..9 loop
    sid:=('eb100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
      access_envelope,refresh_envelope,expires_at)
    values(sid,'eb000000-0000-4000-8000-000000000015',
      nextval('private.plannix_auth_generation_seq'),'eb000000-0000-4000-8000-000000000001',
      'ordinary',lpad(to_hex(100+n),64,'0'),'{}','{}',now()+interval '1 day');
  end loop;
end $$;
update private.plannix_auth_browser_bindings set current_session_id='eb100000-0000-4000-8000-000000000009'
  where id='eb000000-0000-4000-8000-000000000015';
insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key,bound_session_id)
values(repeat('e',64),'eb000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/fcm/send/prune-fixture',repeat('p',87),repeat('q',22),
  'eb100000-0000-4000-8000-000000000001');
select set_config('test.prune_version',installation_version::text,true)
  from private.plannix_push_subscriptions where endpoint_hash=repeat('e',64);
select set_config('test.prune_marker','__Host-plannix-b-'||generation,true)
  from private.plannix_auth_browser_bindings where id='eb000000-0000-4000-8000-000000000015';
select set_config('test.prune_session','__Host-plannix-s-'||generation,true)
  from private.plannix_auth_sessions where id='eb100000-0000-4000-8000-000000000009';
set local role service_role;
select set_config('test.prune_intent',public.plannix_auth_begin(
  current_setting('test.prune_marker'),repeat('5',64),'ordinary',
  current_setting('test.prune_session'),lpad(to_hex(109),64,'0'))->>'intentId',true);
select extensions.is(public.plannix_auth_settle(current_setting('test.prune_intent')::uuid,
  'created','eb000000-0000-4000-8000-000000000001',repeat('6',64),'{}','{}')->>'state',
  'created','retained-session pruning does not fail on a bound push row');
reset role;
select extensions.ok(not exists(select 1 from private.plannix_auth_sessions
  where id='eb100000-0000-4000-8000-000000000001'),
  'oldest bound auth session was pruned');
select extensions.ok(bound_session_id is null and detail_disabled and
  installation_version<>current_setting('test.prune_version')::uuid,
  'pruning preserves generic row and advances its installation generation')
  from private.plannix_push_subscriptions where endpoint_hash=repeat('e',64);
select extensions.ok(h.active and h.generation=s.installation_version,
  'pruned-session row and endpoint history remain synchronized')
  from private.plannix_push_endpoint_history h join private.plannix_push_subscriptions s using(endpoint_hash)
  where h.endpoint_hash=repeat('e',64);

select extensions.finish();
rollback;
