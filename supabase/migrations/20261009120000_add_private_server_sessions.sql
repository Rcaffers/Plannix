begin;

-- Stage 2 storage only. No application route calls these service-role RPCs yet.
create sequence private.plannix_auth_generation_seq;
revoke all on sequence private.plannix_auth_generation_seq from public, anon, authenticated, service_role;

create table private.plannix_auth_browser_bindings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  generation bigint not null unique default pg_catalog.nextval('private.plannix_auth_generation_seq'::regclass),
  marker_hash text not null unique check (marker_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  expired boolean not null default false,
  revoked boolean not null default false,
  current_session_id uuid,
  latest_transition_id uuid
);
create table private.plannix_auth_transitions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  binding_id uuid not null references private.plannix_auth_browser_bindings(id) on delete cascade,
  generation bigint not null unique default pg_catalog.nextval('private.plannix_auth_generation_seq'::regclass),
  kind text not null check (kind in ('ordinary','recovery')),
  state text not null default 'pending' check (state in ('pending','created','failed','cancelled','expired','superseded')),
  expires_at timestamptz not null
);
create index plannix_auth_transitions_binding on private.plannix_auth_transitions(binding_id, generation desc);
create table private.plannix_auth_sessions (
  id uuid primary key,
  binding_id uuid not null references private.plannix_auth_browser_bindings(id) on delete cascade,
  generation bigint not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('ordinary','recovery')),
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  token_version bigint not null default 1 check (token_version > 0),
  access_envelope jsonb not null,
  refresh_envelope jsonb not null,
  expires_at timestamptz not null,
  expired boolean not null default false,
  revoked boolean not null default false
);
create index plannix_auth_sessions_binding on private.plannix_auth_sessions(binding_id, generation desc);
alter table private.plannix_auth_browser_bindings enable row level security;
alter table private.plannix_auth_transitions enable row level security;
alter table private.plannix_auth_sessions enable row level security;
revoke all on private.plannix_auth_browser_bindings, private.plannix_auth_transitions,
  private.plannix_auth_sessions from public, anon, authenticated, service_role;

-- Callers hold the binding row lock before calling this helper. Once observed,
-- expiry is stored, so moving the wall clock backwards cannot revive a version.
create function private.plannix_auth_observe_expiry(target private.plannix_auth_browser_bindings)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.plannix_auth_sessions as s set expired=true, revoked=true
    where s.id=target.current_session_id and not s.expired and s.expires_at <= pg_catalog.clock_timestamp();
  if target.expired then return true; end if;
  if target.expires_at > pg_catalog.clock_timestamp() then return false; end if;
  update private.plannix_auth_browser_bindings set expired=true, revoked=true
    where id=target.id;
  update private.plannix_auth_sessions set revoked=true where id=target.current_session_id;
  update private.plannix_auth_transitions set state='expired'
    where id=target.latest_transition_id and state='pending';
  update private.plannix_auth_browser_bindings set latest_transition_id=null where id=target.id;
  return true;
end;
$$;
revoke all on function private.plannix_auth_observe_expiry(private.plannix_auth_browser_bindings)
  from public, anon, authenticated, service_role;

create function public.plannix_auth_issue_binding(target_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare created private.plannix_auth_browser_bindings%rowtype;
begin
  if target_hash is null or target_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='Invalid session input.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(649201, 1);
  -- Never evict a live binding to make capacity. Expired bindings are terminal.
  delete from private.plannix_auth_browser_bindings as b
    where b.expired or b.expires_at <= pg_catalog.clock_timestamp();
  if (select pg_catalog.count(*) from private.plannix_auth_browser_bindings) >= 1024 then
    return pg_catalog.jsonb_build_object('state','unavailable');
  end if;
  insert into private.plannix_auth_browser_bindings(marker_hash,expires_at)
    values (target_hash, pg_catalog.clock_timestamp()+interval '30 days') returning * into created;
  return pg_catalog.jsonb_build_object('state','issued','name',
    '__Host-plannix-b-' || created.generation,'generation',created.generation);
exception when unique_violation then
  return pg_catalog.jsonb_build_object('state','unavailable');
end;
$$;
revoke all on function public.plannix_auth_issue_binding(text) from public, anon, authenticated;
grant execute on function public.plannix_auth_issue_binding(text) to service_role;

create function public.plannix_auth_begin(
  marker_name text, provided_marker_hash text, target_kind text,
  session_name text default null, provided_session_hash text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare binding private.plannix_auth_browser_bindings%rowtype;
  current_session private.plannix_auth_sessions%rowtype;
  created private.plannix_auth_transitions%rowtype;
begin
  if marker_name is null or provided_marker_hash is null or target_kind is null
    or target_kind not in ('ordinary','recovery')
    or marker_name !~ '^__Host-plannix-b-[1-9][0-9]{0,15}$'
    or provided_marker_hash !~ '^[0-9a-f]{64}$'
    or (session_name is null) <> (provided_session_hash is null)
    or (session_name is not null and (
      session_name !~ '^__Host-plannix-[sr]-[1-9][0-9]{0,15}$'
      or provided_session_hash !~ '^[0-9a-f]{64}$')) then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  select * into binding from private.plannix_auth_browser_bindings as b
    where b.generation=pg_catalog.substring(marker_name, '[0-9]+$')::bigint
      and b.marker_hash=provided_marker_hash for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  if session_name is not null then
    select * into current_session from private.plannix_auth_sessions as s
      where s.id=binding.current_session_id and s.binding_id=binding.id
        and s.generation=pg_catalog.substring(session_name, '[0-9]+$')::bigint
        and s.kind=case when session_name like '__Host-plannix-s-%' then 'ordinary' else 'recovery' end
        and s.secret_hash=provided_session_hash for update;
    -- A forged, stale or cross-binding cookie must not mutate valid state.
    if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  end if;
  if private.plannix_auth_observe_expiry(binding) then
    return pg_catalog.jsonb_build_object('state','expired','cleanup',marker_name);
  end if;
  if binding.revoked then return pg_catalog.jsonb_build_object('state','invalid','cleanup',marker_name); end if;
  if session_name is not null and (current_session.revoked or current_session.expired
    or current_session.expires_at <= pg_catalog.clock_timestamp()) then
    return pg_catalog.jsonb_build_object('state','absent');
  end if;
  update private.plannix_auth_transitions set state='superseded'
    where id=binding.latest_transition_id and state='pending';
  insert into private.plannix_auth_transitions(binding_id,kind,expires_at)
    values (binding.id,target_kind,pg_catalog.clock_timestamp()+interval '2 minutes')
    returning * into created;
  update private.plannix_auth_browser_bindings set latest_transition_id=created.id where id=binding.id;
  delete from private.plannix_auth_transitions where id in (
    select id from private.plannix_auth_transitions where binding_id=binding.id
    order by generation desc offset 16);
  return pg_catalog.jsonb_build_object('state','started','intentId',created.id,
    'generation',created.generation);
end;
$$;
revoke all on function public.plannix_auth_begin(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.plannix_auth_begin(text,text,text,text,text) to service_role;

create function public.plannix_auth_settle(
  target_intent uuid, outcome text, confirmed_owner uuid default null,
  target_hash text default null, access_cipher jsonb default null, refresh_cipher jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare binding private.plannix_auth_browser_bindings%rowtype;
  transition private.plannix_auth_transitions%rowtype;
begin
  if outcome is null or outcome not in ('created','failed','cancelled','expired') then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  select b.* into binding from private.plannix_auth_browser_bindings as b
    join private.plannix_auth_transitions as t on t.binding_id=b.id
    where t.id=target_intent for update of b;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select * into transition from private.plannix_auth_transitions where id=target_intent for update;
  perform private.plannix_auth_observe_expiry(binding);
  select * into transition from private.plannix_auth_transitions where id=target_intent;
  if transition.state <> 'pending' then
    return pg_catalog.jsonb_build_object('state',case when transition.state='created' then 'already-settled' else transition.state end);
  end if;
  if binding.revoked or binding.expired or transition.expires_at <= pg_catalog.clock_timestamp() then
    update private.plannix_auth_transitions set state='expired' where id=target_intent;
    update private.plannix_auth_browser_bindings set latest_transition_id=null
      where id=binding.id and latest_transition_id=target_intent;
    return pg_catalog.jsonb_build_object('state','expired');
  end if;
  if binding.latest_transition_id is distinct from target_intent then
    update private.plannix_auth_transitions set state='superseded' where id=target_intent;
    return pg_catalog.jsonb_build_object('state','superseded');
  end if;
  if outcome='created' then
    -- Future callers must derive confirmed_owner from verified Supabase identity,
    -- never from a browser field. No route invokes this RPC in Stage 2.
    if confirmed_owner is null or not exists (select 1 from auth.users where id=confirmed_owner)
      or target_hash is null or target_hash !~ '^[0-9a-f]{64}$'
      or access_cipher is null or refresh_cipher is null then
      outcome := 'failed';
    end if;
  end if;
  if outcome='created' then
    insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,
      secret_hash,access_envelope,refresh_envelope,expires_at)
      values (transition.id,binding.id,transition.generation,confirmed_owner,transition.kind,
        target_hash,access_cipher,refresh_cipher,
        pg_catalog.clock_timestamp()+interval '30 days')
      on conflict do nothing;
    if not found then outcome := 'failed'; end if;
  end if;
  -- INSERT may wait on storage, constraints or test-only hooks. Re-observe
  -- deadlines under the binding lock before replacing the current session.
  perform private.plannix_auth_observe_expiry(binding);
  select * into binding from private.plannix_auth_browser_bindings where id=binding.id;
  select * into transition from private.plannix_auth_transitions where id=target_intent;
  if binding.expired or binding.revoked or transition.state='expired'
    or transition.expires_at <= pg_catalog.clock_timestamp() then
    -- A created row is provisional until both deadlines have passed.
    delete from private.plannix_auth_sessions where id=target_intent
      and binding_id=binding.id and binding.current_session_id is distinct from target_intent;
    update private.plannix_auth_transitions set state='expired'
      where id=target_intent and state='pending';
    update private.plannix_auth_browser_bindings set latest_transition_id=null
      where id=binding.id and latest_transition_id=target_intent;
    return pg_catalog.jsonb_build_object('state','expired');
  end if;
  if outcome='created' then
    update private.plannix_auth_sessions set revoked=true where id=binding.current_session_id;
    update private.plannix_auth_browser_bindings set current_session_id=transition.id,
      latest_transition_id=null where id=binding.id;
    update private.plannix_auth_transitions set state='created' where id=target_intent;
    delete from private.plannix_auth_sessions where id in (
      select id from private.plannix_auth_sessions where binding_id=binding.id
      order by generation desc offset 8);
    delete from private.plannix_auth_transitions where id in (
      select id from private.plannix_auth_transitions where binding_id=binding.id
      order by generation desc offset 16);
    return pg_catalog.jsonb_build_object('state','created','generation',transition.generation,
      'kind',transition.kind);
  end if;
  update private.plannix_auth_transitions set state=outcome where id=target_intent;
  update private.plannix_auth_browser_bindings set latest_transition_id=null where id=binding.id;
  return pg_catalog.jsonb_build_object('state',outcome);
end;
$$;
revoke all on function public.plannix_auth_settle(uuid,text,uuid,text,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_settle(uuid,text,uuid,text,jsonb,jsonb) to service_role;

create function public.plannix_auth_inspect(
  marker_name text, provided_marker_hash text, session_name text, session_hash text, expected_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare binding private.plannix_auth_browser_bindings%rowtype;
  session_record private.plannix_auth_sessions%rowtype;
begin
  if marker_name is null or provided_marker_hash is null or session_name is null or session_hash is null
    or expected_kind is null or expected_kind not in ('ordinary','recovery')
    or marker_name !~ '^__Host-plannix-b-[1-9][0-9]{0,15}$'
    or session_name !~ '^__Host-plannix-[sr]-[1-9][0-9]{0,15}$'
    or provided_marker_hash !~ '^[0-9a-f]{64}$' or session_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  -- Validate both complete secrets before observing expiry or emitting cleanup.
  select * into binding from private.plannix_auth_browser_bindings as b
    where b.generation=pg_catalog.substring(marker_name, '[0-9]+$')::bigint
      and b.marker_hash=provided_marker_hash for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select * into session_record from private.plannix_auth_sessions as s
    where s.generation=pg_catalog.substring(session_name, '[0-9]+$')::bigint
      and s.secret_hash=session_hash
      and s.binding_id=binding.id
      and s.kind=case when session_name like '__Host-plannix-s-%' then 'ordinary' else 'recovery' end
    for update;
  if not found then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  if private.plannix_auth_observe_expiry(binding) then
    return pg_catalog.jsonb_build_object('state','expired','cleanup',marker_name);
  end if;
  if binding.revoked then return pg_catalog.jsonb_build_object('state','invalid','cleanup',marker_name); end if;
  update private.plannix_auth_sessions set expired=true,revoked=true
    where id=session_record.id and not expired and expires_at<=pg_catalog.clock_timestamp();
  select * into session_record from private.plannix_auth_sessions where id=session_record.id;
  if session_record.revoked or binding.current_session_id is distinct from session_record.id then
    return pg_catalog.jsonb_build_object('state','absent','cleanup',session_name);
  end if;
  if session_record.kind<>expected_kind then return pg_catalog.jsonb_build_object('state','wrong-kind'); end if;
  return pg_catalog.jsonb_build_object('state','current','ownerId',session_record.owner_id,
    'sessionId',session_record.id,'generation',session_record.generation,
    'tokenVersion',session_record.token_version,
    'accessEnvelope',session_record.access_envelope,
    'refreshEnvelope',session_record.refresh_envelope);
end;
$$;
revoke all on function public.plannix_auth_inspect(text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_inspect(text,text,text,text,text) to service_role;

create function public.plannix_auth_logout(
  marker_name text, marker_hash text, session_name text, session_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected jsonb; target_id uuid;
begin
  selected := public.plannix_auth_inspect(marker_name,marker_hash,session_name,session_hash,
    case when session_name like '__Host-plannix-r-%' then 'recovery' else 'ordinary' end);
  if selected->>'state'<>'current' then return selected - 'accessEnvelope' - 'refreshEnvelope'; end if;
  target_id := (selected->>'sessionId')::uuid;
  update private.plannix_auth_sessions set revoked=true where id=target_id;
  update private.plannix_auth_browser_bindings set current_session_id=null
    where current_session_id=target_id;
  return pg_catalog.jsonb_build_object('state','revoked','cleanup',session_name);
end;
$$;
revoke all on function public.plannix_auth_logout(text,text,text,text) from public, anon, authenticated;
grant execute on function public.plannix_auth_logout(text,text,text,text) to service_role;

create function public.plannix_auth_refresh(
  marker_name text, marker_hash text, session_name text, session_hash text,
  confirmed_owner uuid, expected_version bigint, access_cipher jsonb, refresh_cipher jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected jsonb; updated_version bigint;
begin
  selected := public.plannix_auth_inspect(marker_name,marker_hash,session_name,session_hash,'ordinary');
  if selected->>'state'<>'current' or (selected->>'ownerId')::uuid is distinct from confirmed_owner
    or expected_version is null or expected_version<1
    or access_cipher is null or refresh_cipher is null then
    return pg_catalog.jsonb_build_object('state','rejected');
  end if;
  update private.plannix_auth_sessions as s set token_version=s.token_version+1,
    access_envelope=access_cipher, refresh_envelope=refresh_cipher
    where s.id=(selected->>'sessionId')::uuid and s.token_version=expected_version
      and not s.revoked and not s.expired and s.expires_at>pg_catalog.clock_timestamp()
    returning s.token_version into updated_version;
  if not found then return pg_catalog.jsonb_build_object('state','conflict'); end if;
  return pg_catalog.jsonb_build_object('state','refreshed','tokenVersion',updated_version);
end;
$$;
revoke all on function public.plannix_auth_refresh(text,text,text,text,uuid,bigint,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_refresh(text,text,text,text,uuid,bigint,jsonb,jsonb)
  to service_role;

commit;
