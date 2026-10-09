begin;
create extension if not exists pgtap with schema extensions;
-- The disposable schema-only Supabase foundation omits platform ACLs.
grant usage on schema extensions to service_role;
select extensions.no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000',
  'dd000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'session-stage2@example.test','',pg_catalog.now(),
  '{"provider":"email","providers":["email"]}','{}',pg_catalog.now(),pg_catalog.now());

select extensions.ok(not has_table_privilege('anon','private.plannix_auth_browser_bindings','SELECT,INSERT,UPDATE,DELETE'), 'anon cannot access bindings');
select extensions.ok(not has_table_privilege('authenticated','private.plannix_auth_sessions','SELECT,INSERT,UPDATE,DELETE'), 'browser cannot access encrypted sessions');
select extensions.ok(not has_table_privilege('service_role','private.plannix_auth_sessions','SELECT,INSERT,UPDATE,DELETE'), 'service role uses RPCs, not private table');
select extensions.ok(not has_sequence_privilege('service_role','private.plannix_auth_generation_seq','USAGE'), 'service role cannot allocate generations directly');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_auth_issue_binding(text)','EXECUTE'), 'browser cannot issue bindings');
select extensions.ok(not has_function_privilege('authenticated',
  'public.plannix_auth_begin(text,text,text,text,text)','EXECUTE'),
  'browser cannot start signed-in replacement RPC');
select extensions.ok(not has_function_privilege('anon','public.plannix_auth_settle(uuid,text,uuid,text,jsonb,jsonb)','EXECUTE'), 'anon cannot settle transitions');
select extensions.ok(has_function_privilege('service_role','public.plannix_auth_inspect(text,text,text,text,text)','EXECUTE'), 'service role can inspect through RPC');
select extensions.ok(not has_function_privilege('service_role','private.plannix_auth_observe_expiry(private.plannix_auth_browser_bindings)','EXECUTE'), 'private expiry helper is not a service RPC');

set local role service_role;
select extensions.is(public.plannix_auth_issue_binding(pg_catalog.repeat('a',64))->>'state','issued','issue a server binding');
reset role;
select pg_catalog.set_config('test.session_marker',
  '__Host-plannix-b-' || generation, true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('a',64);
set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('x',64),'ordinary')->>'state','invalid','forged marker rejected');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),null)->>'state','invalid','missing session kind rejected');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),'ordinary')->>'state','started','verified marker starts a transition');
reset role;
select pg_catalog.set_config('test.first_intent', t.id::text, true)
  from private.plannix_auth_transitions as t order by generation desc limit 1;
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.first_intent')::uuid,
  null)->>'state','invalid','missing settlement outcome rejected');
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.first_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',null,'{}','{}')->>'state',
  'failed','invalid replacement secret settles failure');
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.first_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('b',64),'{}','{}')->>'state',
  'failed','failed intent cannot be retried');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),'ordinary')->>'state','started','a new transition may begin');
reset role;
select pg_catalog.set_config('test.second_intent', t.id::text, true)
  from private.plannix_auth_transitions as t order by generation desc limit 1;
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.second_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('b',64),'{}','{}')->>'state',
  'created','valid replacement commits');
reset role;
select pg_catalog.set_config('test.session_name',
  '__Host-plannix-s-' || generation, true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('b',64);
select pg_catalog.set_config('test.signed_in_intent','',true);
set local role service_role;
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('b',64),'ordinary')->>'state','current','ordinary session is current');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),'ordinary',pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('b',64))->>'state','started','signed-in browser begins replacement');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),'ordinary',pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('f',64))->>'state','invalid','forged current secret cannot begin replacement');
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('b',64),'ordinary')->>'state','current','forged begin preserves current session');
reset role;
select pg_catalog.set_config('test.signed_in_intent',t.id::text,true)
  from private.plannix_auth_transitions as t join private.plannix_auth_browser_bindings as b
    on b.id=t.binding_id where b.marker_hash=pg_catalog.repeat('a',64)
  order by t.generation desc limit 1;
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.signed_in_intent')::uuid,
  'failed')->>'state','failed','failed signed-in replacement settles');
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('b',64),'ordinary')->>'state','current','failed replacement preserves current session');
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('b',64),null)->>'state','invalid','missing expected session kind rejected');
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('b',64),'recovery')->>'state','wrong-kind','ordinary session cannot authorize recovery');
select extensions.is(public.plannix_auth_refresh(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('b',64),'dd000000-0000-4000-8000-000000000001',1,'{"v":1}','{"v":1}')
  ->>'state','refreshed','matching refresh advances token version');
select extensions.is(public.plannix_auth_refresh(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('b',64),'dd000000-0000-4000-8000-000000000001',1,'{}','{}')
  ->>'state','conflict','stale token version cannot overwrite refresh');
select extensions.is(public.plannix_auth_logout(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('b',64))->>'state','revoked','captured session logout succeeds');
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.session_name'),
  pg_catalog.repeat('b',64),'ordinary')->>'state','absent','revoked session cannot revive');
reset role;
select extensions.is((select token_version from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('b',64)),
  2::bigint,'stale refresh did not advance token version');
select extensions.is((select revoked from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('b',64)),
  true,'revocation persisted');

-- A session from another binding cannot authorize a replacement on this marker.
set local role service_role;
select extensions.is(public.plannix_auth_issue_binding(pg_catalog.repeat('c',64))->>'state',
  'issued','cross-binding fixture issued');
reset role;
select pg_catalog.set_config('test.cross_marker','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('c',64);
set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.cross_marker'),
  pg_catalog.repeat('c',64),'ordinary')->>'state','started','cross-binding fixture begins');
reset role;
select pg_catalog.set_config('test.cross_intent',t.id::text,true)
  from private.plannix_auth_transitions as t join private.plannix_auth_browser_bindings as b
    on b.id=t.binding_id where b.marker_hash=pg_catalog.repeat('c',64);
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.cross_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('e',64),'{}','{}')->>'state',
  'created','cross-binding fixture is current');
reset role;
select pg_catalog.set_config('test.cross_name','__Host-plannix-s-' || generation,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('e',64);
set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),'ordinary',pg_catalog.current_setting('test.cross_name'),
  pg_catalog.repeat('e',64))->>'state','invalid','cross-binding session cannot begin');
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.cross_marker'),
  pg_catalog.repeat('c',64),pg_catalog.current_setting('test.cross_name'),
  pg_catalog.repeat('e',64),'ordinary')->>'state','current','cross-binding rejection preserves its owner');
reset role;
delete from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('c',64);

-- A second binding exercises terminal expiry independently of inspection.
set local role service_role;
select extensions.is(public.plannix_auth_issue_binding(pg_catalog.repeat('d',64))->>'state',
  'issued','second binding issued');
reset role;
select pg_catalog.set_config('test.expiring_marker', '__Host-plannix-b-' || generation, true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('d',64);
set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.expiring_marker'),
  pg_catalog.repeat('d',64),'ordinary')->>'state','started','expiring transition begins');
reset role;
select pg_catalog.set_config('test.expiring_intent',t.id::text,true)
  from private.plannix_auth_transitions as t
  join private.plannix_auth_browser_bindings as b on b.id=t.binding_id
  where b.marker_hash=pg_catalog.repeat('d',64);
update private.plannix_auth_browser_bindings set expires_at=pg_catalog.clock_timestamp()-interval '1 second'
  where marker_hash=pg_catalog.repeat('d',64);
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.expiring_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('e',64),'{}','{}')->>'state',
  'expired','completion first observes marker expiry');
reset role;
select extensions.is((select expired from private.plannix_auth_browser_bindings
  where marker_hash=pg_catalog.repeat('d',64)),true,'marker expiry persisted terminally');
select extensions.is((select state from private.plannix_auth_transitions
  where id=pg_catalog.current_setting('test.expiring_intent')::uuid),'expired','intent expiry persisted terminally');
update private.plannix_auth_browser_bindings set expires_at=pg_catalog.clock_timestamp()+interval '30 days'
  where marker_hash=pg_catalog.repeat('d',64);
set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.expiring_marker'),
  pg_catalog.repeat('d',64),'ordinary')->>'state','expired','clock rollback cannot revive marker');
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.expiring_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('e',64),'{}','{}')->>'state',
  'expired','repeated completion cannot revive intent');
reset role;
select extensions.is((select pg_catalog.count(*) from private.plannix_auth_sessions
  where secret_hash=pg_catalog.repeat('e',64)),0::bigint,'expired completion created no session');

-- Latest-started transition wins even when the older completion arrives last.
set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),'ordinary')->>'state','started','first replacement starts');
reset role;
select pg_catalog.set_config('test.superseded_intent',t.id::text,true)
  from private.plannix_auth_transitions as t
  join private.plannix_auth_browser_bindings as b on b.id=t.binding_id
  where b.marker_hash=pg_catalog.repeat('a',64) order by t.generation desc limit 1;
set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),'ordinary')->>'state','started','newer replacement starts');
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.superseded_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('f',64),'{}','{}')->>'state',
  'superseded','older completion cannot revive');
reset role;
select extensions.is((select pg_catalog.count(*) from private.plannix_auth_sessions
  where secret_hash=pg_catalog.repeat('f',64)),0::bigint,'superseded completion created no session');
select pg_catalog.set_config('test.newer_intent',t.id::text,true)
  from private.plannix_auth_transitions as t
  join private.plannix_auth_browser_bindings as b on b.id=t.binding_id
  where b.marker_hash=pg_catalog.repeat('a',64) order by t.generation desc limit 1;
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.newer_intent')::uuid,
  'cancelled')->>'state','cancelled','newer cancellation settles');
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.superseded_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('f',64),'{}','{}')->>'state',
  'superseded','cancellation does not revive older attempt');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),'recovery')->>'state','started','recovery transition starts');
reset role;
select pg_catalog.set_config('test.recovery_intent',t.id::text,true)
  from private.plannix_auth_transitions as t
  join private.plannix_auth_browser_bindings as b on b.id=t.binding_id
  where b.marker_hash=pg_catalog.repeat('a',64) order by t.generation desc limit 1;
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.recovery_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('f',64),'{}','{}')->>'state',
  'created','recovery session created');
reset role;
select pg_catalog.set_config('test.recovery_name','__Host-plannix-r-' || generation,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('f',64);
set local role service_role;
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.recovery_name'),
  pg_catalog.repeat('f',64),'ordinary')->>'state','wrong-kind','recovery cannot authorize ordinary access');
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.recovery_name'),
  pg_catalog.repeat('f',64),'recovery')->>'state','current','recovery access is separately scoped');
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.recovery_name'),
  pg_catalog.repeat('x',64),'recovery')->>'state','invalid','forged session secret fails closed');
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.recovery_name'),
  pg_catalog.repeat('f',64),'recovery')->>'state','current','forgery did not revoke current session');
select extensions.is(public.plannix_auth_refresh(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.recovery_name'),
  pg_catalog.repeat('f',64),'dd000000-0000-4000-8000-000000000001',1,'{}','{}')->>'state',
  'rejected','ordinary refresh cannot act on recovery session');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),'ordinary')->>'state','started','replacement of recovery begins');
reset role;
select pg_catalog.set_config('test.failed_replacement',t.id::text,true)
  from private.plannix_auth_transitions as t
  join private.plannix_auth_browser_bindings as b on b.id=t.binding_id
  where b.marker_hash=pg_catalog.repeat('a',64) order by t.generation desc limit 1;
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.failed_replacement')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',null,'{}','{}')->>'state',
  'failed','invalid replacement fails without deleting current recovery');
select extensions.is(public.plannix_auth_inspect(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.recovery_name'),
  pg_catalog.repeat('f',64),'recovery')->>'state','current','failed replacement preserved recovery session');
select extensions.is(public.plannix_auth_logout(pg_catalog.current_setting('test.session_marker'),
  pg_catalog.repeat('a',64),pg_catalog.current_setting('test.recovery_name'),
  pg_catalog.repeat('f',64))->>'state','revoked','recovery session can be explicitly logged out');
reset role;

-- Disposable, transaction-scoped delay: INSERT crosses the transition
-- deadline while the binding lock remains held. It is rolled back below.
create function private.plannix_auth_test_delay() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.secret_hash in (pg_catalog.repeat('3',64),pg_catalog.repeat('6',64)) then
    perform pg_catalog.pg_sleep(1);
  end if;
  return new;
end;
$$;
create trigger plannix_auth_test_delay before insert on private.plannix_auth_sessions
  for each row execute function private.plannix_auth_test_delay();

-- Transition expiry during provisional insertion preserves the old session.
select extensions.is(public.plannix_auth_issue_binding(pg_catalog.repeat('1',64))->>'state',
  'issued','delayed-transition fixture binding issued');
select pg_catalog.set_config('test.delay_marker','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('1',64);
select pg_catalog.set_config('test.delay_first',public.plannix_auth_begin(
  pg_catalog.current_setting('test.delay_marker'),pg_catalog.repeat('1',64),'ordinary')->>'intentId',true);
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.delay_first')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('2',64),'{}','{}')->>'state',
  'created','prior delayed-transition session exists');
select pg_catalog.set_config('test.delay_next',public.plannix_auth_begin(
  pg_catalog.current_setting('test.delay_marker'),pg_catalog.repeat('1',64),'ordinary')->>'intentId',true);
update private.plannix_auth_transitions set expires_at=pg_catalog.clock_timestamp()+interval '400 milliseconds'
  where id=pg_catalog.current_setting('test.delay_next')::uuid;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.delay_next')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('3',64),'{}','{}')->>'state',
  'expired','delayed completion cannot cross transition deadline');
select extensions.is((select state from private.plannix_auth_transitions
  where id=pg_catalog.current_setting('test.delay_next')::uuid),'expired','delayed transition expires terminally');
select extensions.is((select pg_catalog.count(*) from private.plannix_auth_sessions
  where secret_hash=pg_catalog.repeat('3',64)),0::bigint,'provisional transition session removed');
select extensions.is((select revoked from private.plannix_auth_sessions
  where secret_hash=pg_catalog.repeat('2',64)),false,'prior session survives transition expiry');
update private.plannix_auth_transitions set expires_at=pg_catalog.clock_timestamp()+interval '2 minutes'
  where id=pg_catalog.current_setting('test.delay_next')::uuid;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.delay_next')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('3',64),'{}','{}')->>'state',
  'expired','clock rollback cannot revive delayed transition');

-- Binding expiry during the same delayed insertion is likewise terminal.
select extensions.is(public.plannix_auth_issue_binding(pg_catalog.repeat('4',64))->>'state',
  'issued','delayed-binding fixture issued');
select pg_catalog.set_config('test.delay_binding','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('4',64);
select pg_catalog.set_config('test.delay_binding_first',public.plannix_auth_begin(
  pg_catalog.current_setting('test.delay_binding'),pg_catalog.repeat('4',64),'ordinary')->>'intentId',true);
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.delay_binding_first')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('5',64),'{}','{}')->>'state',
  'created','prior delayed-binding session exists');
select pg_catalog.set_config('test.delay_binding_next',public.plannix_auth_begin(
  pg_catalog.current_setting('test.delay_binding'),pg_catalog.repeat('4',64),'ordinary')->>'intentId',true);
update private.plannix_auth_browser_bindings set expires_at=pg_catalog.clock_timestamp()+interval '400 milliseconds'
  where marker_hash=pg_catalog.repeat('4',64);
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.delay_binding_next')::uuid,
  'created','dd000000-0000-4000-8000-000000000001',pg_catalog.repeat('6',64),'{}','{}')->>'state',
  'expired','delayed completion cannot cross binding deadline');
select extensions.is((select expired from private.plannix_auth_browser_bindings
  where marker_hash=pg_catalog.repeat('4',64)),true,'binding expiry recorded terminally');
select extensions.is((select pg_catalog.count(*) from private.plannix_auth_sessions
  where secret_hash=pg_catalog.repeat('6',64)),0::bigint,'provisional binding session removed');
select extensions.is((select revoked from private.plannix_auth_sessions
  where secret_hash=pg_catalog.repeat('5',64)),true,'expired binding revokes prior session');
update private.plannix_auth_browser_bindings set expires_at=pg_catalog.clock_timestamp()+interval '30 days'
  where marker_hash=pg_catalog.repeat('4',64);
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.delay_binding'),
  pg_catalog.repeat('4',64),'ordinary')->>'state','expired','rollback cannot revive expired binding');
delete from private.plannix_auth_browser_bindings where marker_hash in
  (pg_catalog.repeat('1',64),pg_catalog.repeat('4',64));
drop trigger plannix_auth_test_delay on private.plannix_auth_sessions;
drop function private.plannix_auth_test_delay();

do $$
declare intent uuid; i integer;
begin
  for i in 1..18 loop
    intent := (public.plannix_auth_begin(pg_catalog.current_setting('test.session_marker'),
      pg_catalog.repeat('a',64),'ordinary')->>'intentId')::uuid;
    if i <= 10 then
      perform public.plannix_auth_settle(intent,'created',
        'dd000000-0000-4000-8000-000000000001',
        pg_catalog.lpad(pg_catalog.to_hex(i),64,'0'),'{}','{}');
    else
      perform public.plannix_auth_settle(intent,'cancelled');
    end if;
  end loop;
end;
$$;
select extensions.is((select pg_catalog.count(*) from private.plannix_auth_sessions as s
  join private.plannix_auth_browser_bindings as b on b.id=s.binding_id
  where b.marker_hash=pg_catalog.repeat('a',64)),8::bigint,'only eight recent session versions retained');
select extensions.is((select pg_catalog.count(*) from private.plannix_auth_transitions as t
  join private.plannix_auth_browser_bindings as b on b.id=t.binding_id
  where b.marker_hash=pg_catalog.repeat('a',64)),16::bigint,'only sixteen recent transitions retained');
insert into private.plannix_auth_browser_bindings(marker_hash,expires_at)
  select pg_catalog.lpad(pg_catalog.to_hex(i),64,'0'),pg_catalog.clock_timestamp()+interval '30 days'
  from pg_catalog.generate_series(100,1122) as i;
select extensions.is((select pg_catalog.count(*) from private.plannix_auth_browser_bindings),1024::bigint,
  'synthetic fixture reaches the 1,024 live-family cap');
set local role service_role;
select extensions.is(public.plannix_auth_issue_binding(pg_catalog.repeat('e',64))->>'state',
  'unavailable','binding cap rejects instead of evicting a live version');
reset role;
select extensions.is((select pg_catalog.count(*) from private.plannix_auth_browser_bindings),1024::bigint,
  'live binding count remains capped');
select * from extensions.finish();
rollback;
