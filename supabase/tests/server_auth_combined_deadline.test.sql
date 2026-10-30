begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to service_role;
select extensions.no_plan();

insert into auth.users(id,email,email_confirmed_at)
  values ('dd000000-0000-4000-8000-000000000113','combined-deadline@example.test',pg_catalog.now());

-- Two independent fixtures allow a delayed inspection to cross only one
-- eligibility deadline at a time. The inspector replacement below exists only
-- inside this rolled-back test transaction; production inspect is unchanged.
set local role service_role;
select public.plannix_auth_issue_binding(pg_catalog.repeat('f',64));
select public.plannix_auth_issue_binding(pg_catalog.repeat('d',64));
reset role;
select pg_catalog.set_config('deadline.binding_marker','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('f',64);
select pg_catalog.set_config('deadline.session_marker','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('d',64);
set local role service_role;
select public.plannix_auth_begin(pg_catalog.current_setting('deadline.binding_marker'),
  pg_catalog.repeat('f',64),'ordinary');
select public.plannix_auth_begin(pg_catalog.current_setting('deadline.session_marker'),
  pg_catalog.repeat('d',64),'ordinary');
reset role;
select pg_catalog.set_config('deadline.binding_intent',latest_transition_id::text,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('f',64);
select pg_catalog.set_config('deadline.session_intent',latest_transition_id::text,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('d',64);
set local role service_role;
select public.plannix_auth_settle(pg_catalog.current_setting('deadline.binding_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000113',pg_catalog.repeat('a',64),'{}','{}');
select public.plannix_auth_settle(pg_catalog.current_setting('deadline.session_intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000113',pg_catalog.repeat('e',64),'{}','{}');
reset role;
select pg_catalog.set_config('deadline.binding_session','__Host-plannix-s-' || generation,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('a',64);
select pg_catalog.set_config('deadline.session_session','__Host-plannix-s-' || generation,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('e',64);

create or replace function public.plannix_auth_inspect(
  marker_name text, provided_marker_hash text, session_name text, session_hash text, expected_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare record private.plannix_auth_sessions%rowtype;
begin
  select * into record from private.plannix_auth_sessions as s
    where s.generation=pg_catalog.substring(session_name,'[0-9]+$')::bigint
      and s.secret_hash=session_hash;
  perform pg_catalog.set_config('deadline.inspector_reached','yes',true);
  perform pg_catalog.pg_sleep(1.4);
  return pg_catalog.jsonb_build_object('state','current','ownerId',record.owner_id,
    'sessionId',record.id,'tokenVersion',record.token_version,
    'accessEnvelope',record.access_envelope,'refreshEnvelope',record.refresh_envelope);
end;
$$;

update private.plannix_auth_browser_bindings
  set expires_at=pg_catalog.clock_timestamp()+interval '1 second'
  where marker_hash=pg_catalog.repeat('f',64);
set local role service_role;
select extensions.is(public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('deadline.binding_marker'),'hash',pg_catalog.repeat('f',64))),
  'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('deadline.binding_session'),'hash',pg_catalog.repeat('a',64)))))
  ->>'state','expired','binding expiry after delayed inspection returns no tokens');
reset role;
select extensions.is(pg_catalog.current_setting('deadline.inspector_reached',true),'yes',
  'binding expiry was observed after the delayed inspection began');
select extensions.is((select expired::text from private.plannix_auth_browser_bindings
  where marker_hash=pg_catalog.repeat('f',64)),'true','late binding expiry is terminal');

update private.plannix_auth_sessions
  set expires_at=pg_catalog.clock_timestamp()+interval '1 second'
  where secret_hash=pg_catalog.repeat('e',64);
set local role service_role;
select extensions.is(public.plannix_auth_select_application(pg_catalog.jsonb_build_object(
  'markers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('deadline.session_marker'),'hash',pg_catalog.repeat('d',64))),
  'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'name',pg_catalog.current_setting('deadline.session_session'),'hash',pg_catalog.repeat('e',64)))))
  ->>'state','expired','session expiry after delayed inspection returns no tokens');
reset role;
select extensions.is((select expired::text from private.plannix_auth_sessions
  where secret_hash=pg_catalog.repeat('e',64)),'true','late session expiry is terminal');

select * from extensions.finish();
rollback;
