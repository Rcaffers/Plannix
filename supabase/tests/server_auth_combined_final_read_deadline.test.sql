begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to service_role;
select extensions.no_plan();
select extensions.ok(not pg_catalog.has_function_privilege('anon',
  'private.plannix_auth_final_session_read(uuid,uuid,bigint,text)','EXECUTE'),
  'anonymous role cannot read the private selected session');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated',
  'private.plannix_auth_final_session_read(uuid,uuid,bigint,text)','EXECUTE'),
  'browser role cannot read the private selected session');
select extensions.ok(not pg_catalog.has_function_privilege('service_role',
  'private.plannix_auth_final_session_read(uuid,uuid,bigint,text)','EXECUTE'),
  'service role cannot call the private row reader directly');

insert into auth.users(id,email,email_confirmed_at)
  values ('dd000000-0000-4000-8000-000000000114','combined-final-read@example.test',pg_catalog.now());
set local role service_role;
select public.plannix_auth_issue_binding(pg_catalog.repeat('a',64));
reset role;
select pg_catalog.set_config('final.marker','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('a',64);
set local role service_role;
select public.plannix_auth_begin(pg_catalog.current_setting('final.marker'),
  pg_catalog.repeat('a',64),'ordinary');
reset role;
select pg_catalog.set_config('final.intent',latest_transition_id::text,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('a',64);
set local role service_role;
select public.plannix_auth_settle(pg_catalog.current_setting('final.intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000114',pg_catalog.repeat('b',64),'{}','{}');
reset role;
select pg_catalog.set_config('final.session','__Host-plannix-s-' || generation,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('b',64);

-- This replacement is scoped to the rolled-back pgTAP transaction. It delays
-- the exact last-row-read interval, after select and inspect have succeeded.
create or replace function private.plannix_auth_final_session_read(
  target_id uuid, target_binding uuid, target_generation bigint, target_hash text
) returns private.plannix_auth_sessions language plpgsql set search_path = '' as $$
declare selected private.plannix_auth_sessions%rowtype;
begin
  select * into selected from private.plannix_auth_sessions as s
    where s.id=target_id and s.binding_id=target_binding
      and s.generation=target_generation and s.secret_hash=target_hash for update;
  perform pg_catalog.set_config('final.read_reached','yes',true);
  perform pg_catalog.pg_sleep(1.3);
  return selected;
end;
$$;
update private.plannix_auth_browser_bindings
  set expires_at=pg_catalog.clock_timestamp()+interval '1 second'
  where marker_hash=pg_catalog.repeat('a',64);
set local role service_role;
select pg_catalog.set_config('final.result',public.plannix_auth_select_application(
  pg_catalog.jsonb_build_object('markers',pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('name',pg_catalog.current_setting('final.marker'),
      'hash',pg_catalog.repeat('a',64))),
    'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'name',pg_catalog.current_setting('final.session'),'hash',pg_catalog.repeat('b',64)))))::text,true);
reset role;
select extensions.is(pg_catalog.current_setting('final.read_reached',true),'yes',
  'last selected-session read was reached');
select extensions.is(pg_catalog.current_setting('final.result')::jsonb->>'state','expired',
  'binding expiry during the last read rejects the request');
select extensions.ok(not pg_catalog.current_setting('final.result')::jsonb ? 'accessEnvelope'
  and not pg_catalog.current_setting('final.result')::jsonb ? 'refreshEnvelope',
  'rejected result has no token envelopes');
select extensions.is(pg_catalog.current_setting('final.result')::jsonb->'cleanup',
  pg_catalog.jsonb_build_array(pg_catalog.current_setting('final.marker')),
  'cleanup names only the verified expired marker');
select extensions.is((select expired::text from private.plannix_auth_browser_bindings
  where marker_hash=pg_catalog.repeat('a',64)),'true','observed expiry is terminal');
select * from extensions.finish();
rollback;
