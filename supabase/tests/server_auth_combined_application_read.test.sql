begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to service_role;
select extensions.no_plan();

select extensions.ok(not pg_catalog.has_function_privilege('anon',
  'public.plannix_auth_select_application(jsonb)','EXECUTE'),
  'anonymous browser role cannot obtain token envelopes');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated',
  'public.plannix_auth_select_application(jsonb)','EXECUTE'),
  'authenticated browser role cannot obtain token envelopes');
select extensions.ok(pg_catalog.has_function_privilege('service_role',
  'public.plannix_auth_select_application(jsonb)','EXECUTE'),
  'service role can use the combined application RPC');

insert into auth.users(id,email,email_confirmed_at)
  values ('dd000000-0000-4000-8000-000000000111','combined@example.test',pg_catalog.now());
set local role service_role;
select extensions.is(public.plannix_auth_issue_binding(pg_catalog.repeat('a',64))->>'state',
  'issued','synthetic browser binding issued');
reset role;
select pg_catalog.set_config('combined.marker','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('a',64);
set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('combined.marker'),
  pg_catalog.repeat('a',64),'ordinary')->>'state','started','ordinary transition starts');
reset role;
select pg_catalog.set_config('combined.intent',latest_transition_id::text,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('a',64);
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('combined.intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000111',pg_catalog.repeat('b',64),
  '{"synthetic":"access"}'::jsonb,'{"synthetic":"refresh"}'::jsonb)->>'state',
  'created','ordinary session settles');
reset role;
select pg_catalog.set_config('combined.session','__Host-plannix-s-' || generation,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('b',64);

set local role service_role;
select extensions.is(public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.marker'),'hash',pg_catalog.repeat('a',64))),
  'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.session'),'hash',pg_catalog.repeat('b',64)))))
  ->>'state','current','combined read authorizes only a current ordinary session');
select extensions.is(public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.marker'),'hash',pg_catalog.repeat('a',64)),
    pg_catalog.jsonb_build_object('name','__Host-plannix-b-999999',
      'hash',pg_catalog.repeat('f',64))),
  'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.session'),'hash',pg_catalog.repeat('b',64)))))
  ->>'state','invalid','forged extra marker cannot select a session');
reset role;
select extensions.is((select revoked::text from private.plannix_auth_browser_bindings
  where marker_hash=pg_catalog.repeat('a',64)),'false',
  'forged marker did not revoke the verified binding');

set local role service_role;
select extensions.is(public.plannix_auth_issue_binding(pg_catalog.repeat('d',64))->>'state',
  'issued','independent recovery binding issued');
reset role;
select pg_catalog.set_config('combined.recovery_marker','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('d',64);
set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('combined.recovery_marker'),
  pg_catalog.repeat('d',64),'recovery')->>'state','started','recovery transition starts');
reset role;
select pg_catalog.set_config('combined.recovery_intent',latest_transition_id::text,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('d',64);
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('combined.recovery_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000111',pg_catalog.repeat('e',64),
  '{"synthetic":"recovery-access"}'::jsonb,'{"synthetic":"recovery-refresh"}'::jsonb)->>'state',
  'created','restricted recovery session settles');
reset role;
select pg_catalog.set_config('combined.recovery_session','__Host-plannix-r-' || generation,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('e',64);
set local role service_role;
select extensions.is(public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.recovery_marker'),'hash',pg_catalog.repeat('d',64))),
  'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.recovery_session'),'hash',pg_catalog.repeat('e',64)))))
  ->>'state','wrong-kind','recovery session cannot authorize application access');
select extensions.is(public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.marker'),'hash',pg_catalog.repeat('a',64))),
  'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.recovery_session'),'hash',pg_catalog.repeat('e',64)))))
  ->>'state','invalid','cross-binding recovery cookie is rejected without authorization');
reset role;

set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('combined.marker'),
  pg_catalog.repeat('a',64),'ordinary',pg_catalog.current_setting('combined.session'),
  pg_catalog.repeat('b',64))->>'state','started','replacement starts from signed-in browser');
reset role;
select pg_catalog.set_config('combined.next_intent',latest_transition_id::text,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('a',64);
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('combined.next_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000111',pg_catalog.repeat('c',64),
  '{"synthetic":"next-access"}'::jsonb,'{"synthetic":"next-refresh"}'::jsonb)->>'state',
  'created','replacement commits');
select extensions.is(public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.marker'),'hash',pg_catalog.repeat('a',64))),
  'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.session'),'hash',pg_catalog.repeat('b',64)))))
  ->>'state','selected','superseded cookie cannot return envelopes');
reset role;
select pg_catalog.set_config('combined.next_session','__Host-plannix-s-' || generation,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('c',64);
set local role service_role;
select extensions.is(public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.marker'),'hash',pg_catalog.repeat('a',64))),
  'sessions',pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('name',pg_catalog.current_setting('combined.session'),
      'hash',pg_catalog.repeat('b',64)),
    pg_catalog.jsonb_build_object('name',pg_catalog.current_setting('combined.next_session'),
      'hash',pg_catalog.repeat('c',64)))))
  ->>'state','current','new session remains usable with a verified stale cookie present');
select extensions.is((public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.marker'),'hash',pg_catalog.repeat('a',64))),
  'sessions',pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('name',pg_catalog.current_setting('combined.session'),
      'hash',pg_catalog.repeat('b',64)),
    pg_catalog.jsonb_build_object('name',pg_catalog.current_setting('combined.next_session'),
      'hash',pg_catalog.repeat('c',64))))) -> 'cleanup' ->> 0),
  pg_catalog.current_setting('combined.session'),'cleanup names only the proven stale version');
reset role;

-- Observed session expiry is terminal, even if the clock or expiry field moves back.
update private.plannix_auth_sessions set expires_at=pg_catalog.clock_timestamp()-interval '1 second'
  where secret_hash=pg_catalog.repeat('c',64);
set local role service_role;
select extensions.is(public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.marker'),'hash',pg_catalog.repeat('a',64))),
  'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.next_session'),'hash',pg_catalog.repeat('c',64)))))
  ->>'sessionName',null,'expired session yields no selected usable version');
reset role;
select extensions.is((select expired::text from private.plannix_auth_sessions
  where secret_hash=pg_catalog.repeat('c',64)),'true','observed session expiry is stored');
update private.plannix_auth_sessions set expires_at=pg_catalog.clock_timestamp()+interval '1 day'
  where secret_hash=pg_catalog.repeat('c',64);
set local role service_role;
select extensions.is(public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.marker'),'hash',pg_catalog.repeat('a',64))),
  'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('combined.next_session'),'hash',pg_catalog.repeat('c',64)))))
  ->>'sessionName',null,'clock rollback cannot revive expired session');
reset role;

select * from extensions.finish();
rollback;
