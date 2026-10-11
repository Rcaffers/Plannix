begin;

-- Stage 3 remains unmounted. These functions are callable only by the server's
-- service role and never accept a browser-provided user ID as authorization.
create table private.plannix_auth_callbacks (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  binding_id uuid not null references private.plannix_auth_browser_bindings(id) on delete cascade,
  initiating_intent_id uuid not null references private.plannix_auth_transitions(id) on delete cascade,
  initiating_generation bigint not null,
  initiating_session_id uuid,
  flow_id text check (flow_id ~ '^[0-9a-f]{32}$'),
  kind text not null check (kind in ('confirmation','recovery')),
  verifier_envelope jsonb,
  expires_at timestamptz not null,
  ready_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  check ((flow_id is null) = (verifier_envelope is null))
);
create index plannix_auth_callbacks_binding on private.plannix_auth_callbacks(binding_id, expires_at);
alter table private.plannix_auth_callbacks enable row level security;
revoke all on private.plannix_auth_callbacks from public, anon, authenticated, service_role;

-- Call only while holding the binding lock, then the callback lock. A newer
-- transition is permanently authoritative even if it later fails. Observed
-- expiry/supersession terminally cancels the link before returning false.
create function private.plannix_auth_callback_current(
  target_binding private.plannix_auth_browser_bindings,
  target_callback private.plannix_auth_callbacks
) returns boolean language plpgsql security definer set search_path = '' as $$
declare binding private.plannix_auth_browser_bindings%rowtype;
  transition private.plannix_auth_transitions%rowtype;
begin
  perform private.plannix_auth_observe_expiry(target_binding);
  select * into binding from private.plannix_auth_browser_bindings
    where id=target_binding.id for update;
  select * into transition from private.plannix_auth_transitions
    where id=target_callback.initiating_intent_id and binding_id=binding.id for update;
  if found and transition.state='pending'
    and transition.expires_at<=pg_catalog.clock_timestamp() then
    update private.plannix_auth_transitions set state='expired' where id=transition.id;
    update private.plannix_auth_browser_bindings set latest_transition_id=null
      where id=binding.id and latest_transition_id=transition.id;
    transition.state := 'expired';
  end if;
  if binding.revoked or binding.expired or target_callback.cancelled_at is not null
    or target_callback.consumed_at is not null
    or target_callback.expires_at<=pg_catalog.clock_timestamp()
    or transition.id is null or transition.state<>'pending'
    or transition.generation<>target_callback.initiating_generation
    or binding.latest_transition_id is distinct from transition.id
    or binding.current_session_id is distinct from target_callback.initiating_session_id then
    update private.plannix_auth_callbacks set cancelled_at=pg_catalog.clock_timestamp()
      where state_hash=target_callback.state_hash and cancelled_at is null
        and consumed_at is null;
    return false;
  end if;
  return true;
end;
$$;
revoke all on function private.plannix_auth_callback_current(
  private.plannix_auth_browser_bindings, private.plannix_auth_callbacks)
  from public, anon, authenticated, service_role;

alter table private.plannix_auth_sessions
  add column refresh_claim uuid,
  add column refresh_claim_expires_at timestamptz;

-- Validate every candidate before observing expiry or emitting cleanup. Lock
-- all bindings in generation order so competing selectors cannot deadlock.
create function public.plannix_auth_select(candidates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare markers jsonb; sessions jsonb; item jsonb;
  binding private.plannix_auth_browser_bindings%rowtype;
  session_record private.plannix_auth_sessions%rowtype;
  selected private.plannix_auth_browser_bindings%rowtype;
  marker_ids uuid[] := '{}'; seen_names text[] := '{}'; cleanup text[] := '{}';
  selected_session_name text; selected_session_hash text;
  marker_count integer; session_count integer;
begin
  if pg_catalog.jsonb_typeof(candidates) <> 'object' then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  markers := candidates->'markers'; sessions := candidates->'sessions';
  if pg_catalog.jsonb_typeof(markers) <> 'array' or pg_catalog.jsonb_typeof(sessions) <> 'array' then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  marker_count := pg_catalog.jsonb_array_length(markers);
  session_count := pg_catalog.jsonb_array_length(sessions);
  if marker_count > 4 or session_count > 8 or (marker_count=0 and session_count>0) then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  if marker_count=0 then return pg_catalog.jsonb_build_object('state','missing'); end if;
  for item in select value from pg_catalog.jsonb_array_elements(markers) loop
    if pg_catalog.jsonb_typeof(item)<>'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item))<>2
      or item->>'name' !~ '^__Host-plannix-b-[1-9][0-9]{0,15}$'
      or item->>'hash' !~ '^[0-9a-f]{64}$'
      or item->>'name'=any(seen_names) then
      return pg_catalog.jsonb_build_object('state','invalid');
    end if;
    seen_names := pg_catalog.array_append(seen_names,item->>'name');
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(sessions) loop
    if pg_catalog.jsonb_typeof(item)<>'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item))<>2
      or item->>'name' !~ '^__Host-plannix-[sr]-[1-9][0-9]{0,15}$'
      or item->>'hash' !~ '^[0-9a-f]{64}$'
      or item->>'name'=any(seen_names) then
      return pg_catalog.jsonb_build_object('state','invalid');
    end if;
    seen_names := pg_catalog.array_append(seen_names,item->>'name');
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(markers)
    order by pg_catalog.substring(value->>'name','[0-9]+$')::bigint loop
    select * into binding from private.plannix_auth_browser_bindings as b
      where b.generation=pg_catalog.substring(item->>'name','[0-9]+$')::bigint
        and b.marker_hash=item->>'hash' for update;
    if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
    marker_ids := pg_catalog.array_append(marker_ids,binding.id);
    if selected.id is null or binding.generation>selected.generation then selected := binding; end if;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(sessions)
    order by pg_catalog.substring(value->>'name','[0-9]+$')::bigint loop
    select * into session_record from private.plannix_auth_sessions as s
      where s.generation=pg_catalog.substring(item->>'name','[0-9]+$')::bigint
        and s.secret_hash=item->>'hash' and s.binding_id=any(marker_ids)
        and s.kind=case when item->>'name' like '__Host-plannix-s-%' then 'ordinary' else 'recovery' end
      for update;
    if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
    if session_record.binding_id=selected.id
      and session_record.id is distinct from selected.current_session_id
      and not session_record.revoked and not session_record.expired
      and session_record.expires_at>pg_catalog.clock_timestamp() then
      return pg_catalog.jsonb_build_object('state','invalid');
    end if;
  end loop;
  -- No state was changed before all candidate secrets were verified.
  for item in select value from pg_catalog.jsonb_array_elements(markers)
    order by pg_catalog.substring(value->>'name','[0-9]+$')::bigint loop
    select * into binding from private.plannix_auth_browser_bindings
      where generation=pg_catalog.substring(item->>'name','[0-9]+$')::bigint;
    if private.plannix_auth_observe_expiry(binding) then
      return pg_catalog.jsonb_build_object('state','expired','cleanup',pg_catalog.jsonb_build_array(item->>'name'));
    end if;
    if binding.revoked then
      return pg_catalog.jsonb_build_object('state','invalid','cleanup',pg_catalog.jsonb_build_array(item->>'name'));
    end if;
  end loop;
  -- Permanently retire older marker families before a delayed cleanup can be
  -- returned. The newest server-issued generation is authoritative.
  for item in select value from pg_catalog.jsonb_array_elements(markers) loop
    if pg_catalog.substring(item->>'name','[0-9]+$')::bigint<>selected.generation then
      update private.plannix_auth_browser_bindings set revoked=true where
        generation=pg_catalog.substring(item->>'name','[0-9]+$')::bigint;
      update private.plannix_auth_sessions set revoked=true where binding_id=(
        select id from private.plannix_auth_browser_bindings where
          generation=pg_catalog.substring(item->>'name','[0-9]+$')::bigint);
      update private.plannix_auth_transitions set state='superseded'
        where binding_id=(select id from private.plannix_auth_browser_bindings where
          generation=pg_catalog.substring(item->>'name','[0-9]+$')::bigint) and state='pending';
      cleanup := pg_catalog.array_append(cleanup,item->>'name');
    end if;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(sessions) loop
    select * into session_record from private.plannix_auth_sessions
      where generation=pg_catalog.substring(item->>'name','[0-9]+$')::bigint;
    if session_record.id=selected.current_session_id and not session_record.revoked
      and not session_record.expired and session_record.expires_at>pg_catalog.clock_timestamp() then
      selected_session_name := item->>'name'; selected_session_hash := item->>'hash';
    else
      -- The checked version is already non-authoritative. Make expiry terminal.
      if session_record.expires_at<=pg_catalog.clock_timestamp() then
        update private.plannix_auth_sessions set expired=true,revoked=true where id=session_record.id;
      end if;
      if session_record.binding_id=selected.id and not session_record.revoked
        and not session_record.expired and session_record.expires_at>pg_catalog.clock_timestamp() then
        return pg_catalog.jsonb_build_object('state','invalid');
      end if;
      cleanup := pg_catalog.array_append(cleanup,item->>'name');
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('state','selected',
    'markerName','__Host-plannix-b-' || selected.generation,
    'sessionName',selected_session_name,'cleanup',pg_catalog.to_jsonb(cleanup));
end;
$$;
revoke all on function public.plannix_auth_select(jsonb) from public, anon, authenticated;
grant execute on function public.plannix_auth_select(jsonb) to service_role;

create function public.plannix_auth_reserve_callback(
  marker_name text, provided_marker_hash text, provided_state_hash text,
  target_kind text, initiating_intent uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare binding private.plannix_auth_browser_bindings%rowtype;
  transition private.plannix_auth_transitions%rowtype;
  callback private.plannix_auth_callbacks%rowtype;
begin
  if marker_name !~ '^__Host-plannix-b-[1-9][0-9]{0,15}$'
    or provided_marker_hash !~ '^[0-9a-f]{64}$' or provided_state_hash !~ '^[0-9a-f]{64}$'
    or target_kind not in ('confirmation','recovery') or initiating_intent is null then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select * into binding from private.plannix_auth_browser_bindings as b
    where b.generation=pg_catalog.substring(marker_name,'[0-9]+$')::bigint
      and b.marker_hash=provided_marker_hash for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  if private.plannix_auth_observe_expiry(binding) or binding.revoked then
    return pg_catalog.jsonb_build_object('state','expired'); end if;
  select * into transition from private.plannix_auth_transitions as t
    where t.id=initiating_intent and t.binding_id=binding.id for update;
  if not found or transition.state<>'pending'
    or binding.latest_transition_id is distinct from initiating_intent
    or transition.kind is distinct from
      (case when target_kind='confirmation' then 'ordinary' else 'recovery' end) then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  if transition.expires_at<=pg_catalog.clock_timestamp() then
    update private.plannix_auth_transitions set state='expired' where id=transition.id;
    update private.plannix_auth_browser_bindings set latest_transition_id=null
      where id=binding.id and latest_transition_id=transition.id;
    return pg_catalog.jsonb_build_object('state','expired');
  end if;
  delete from private.plannix_auth_callbacks where binding_id=binding.id
    and (consumed_at is not null or cancelled_at is not null
      or expires_at<=pg_catalog.clock_timestamp());
  if (select pg_catalog.count(*) from private.plannix_auth_callbacks where binding_id=binding.id)>=16 then
    return pg_catalog.jsonb_build_object('state','unavailable'); end if;
  insert into private.plannix_auth_callbacks(state_hash,binding_id,initiating_intent_id,
    initiating_generation,initiating_session_id,kind,expires_at)
    values (provided_state_hash,binding.id,initiating_intent,transition.generation,
      binding.current_session_id,target_kind,
      pg_catalog.clock_timestamp()+interval '15 minutes');
  select * into callback from private.plannix_auth_callbacks
    where state_hash=provided_state_hash for update;
  if not private.plannix_auth_callback_current(binding,callback) then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  return pg_catalog.jsonb_build_object('state','reserved');
exception when unique_violation then return pg_catalog.jsonb_build_object('state','invalid');
end;
$$;
revoke all on function public.plannix_auth_reserve_callback(text,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_reserve_callback(text,text,text,text,uuid) to service_role;

-- Every operation locks the same binding first, including cancellation and
-- claiming. A late SDK verifier cannot recreate a cancelled reservation.
create function public.plannix_auth_attach_callback(
  marker_name text, provided_marker_hash text, provided_state_hash text,
  target_kind text, provided_flow_id text, verifier_cipher jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare binding private.plannix_auth_browser_bindings%rowtype;
  callback private.plannix_auth_callbacks%rowtype;
begin
  if marker_name !~ '^__Host-plannix-b-[1-9][0-9]{0,15}$'
    or provided_marker_hash !~ '^[0-9a-f]{64}$' or provided_state_hash !~ '^[0-9a-f]{64}$'
    or target_kind not in ('confirmation','recovery') or provided_flow_id !~ '^[0-9a-f]{32}$'
    or verifier_cipher is null then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select * into binding from private.plannix_auth_browser_bindings as b
    where b.generation=pg_catalog.substring(marker_name,'[0-9]+$')::bigint
      and b.marker_hash=provided_marker_hash for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select * into callback from private.plannix_auth_callbacks as c
    where c.state_hash=provided_state_hash and c.binding_id=binding.id
      and c.kind=target_kind for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  if not private.plannix_auth_callback_current(binding,callback) then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  if callback.cancelled_at is not null or callback.consumed_at is not null
    or callback.flow_id is not null then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  update private.plannix_auth_callbacks set flow_id=provided_flow_id,
    verifier_envelope=verifier_cipher where state_hash=provided_state_hash;
  -- A delayed write cannot return a usable attachment after eligibility ends.
  if not private.plannix_auth_callback_current(binding,callback) then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  return pg_catalog.jsonb_build_object('state','attached');
end;
$$;
revoke all on function public.plannix_auth_attach_callback(text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_attach_callback(text,text,text,text,text,jsonb) to service_role;

create function public.plannix_auth_ready_callback(
  marker_name text, provided_marker_hash text, provided_state_hash text, target_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare binding private.plannix_auth_browser_bindings%rowtype;
  callback private.plannix_auth_callbacks%rowtype;
begin
  if marker_name !~ '^__Host-plannix-b-[1-9][0-9]{0,15}$'
    or provided_marker_hash !~ '^[0-9a-f]{64}$' or provided_state_hash !~ '^[0-9a-f]{64}$'
    or target_kind not in ('confirmation','recovery') then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select * into binding from private.plannix_auth_browser_bindings as b
    where b.generation=pg_catalog.substring(marker_name,'[0-9]+$')::bigint
      and b.marker_hash=provided_marker_hash for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select * into callback from private.plannix_auth_callbacks as c
    where c.state_hash=provided_state_hash and c.binding_id=binding.id
      and c.kind=target_kind for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  if not private.plannix_auth_callback_current(binding,callback) then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  if callback.cancelled_at is not null or callback.consumed_at is not null
    or callback.flow_id is null or callback.ready_at is not null then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  -- A successful email initiation is still the latest pending transition.
  -- Give its one-use link the callback window without settling it as failed.
  update private.plannix_auth_transitions set expires_at=callback.expires_at
    where id=callback.initiating_intent_id and state='pending';
  update private.plannix_auth_callbacks set ready_at=pg_catalog.clock_timestamp()
    where state_hash=provided_state_hash;
  -- In particular, a callback expiring during the write cannot be revived by
  -- a later clock rollback or reported ready to the router.
  if not private.plannix_auth_callback_current(binding,callback) then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  return pg_catalog.jsonb_build_object('state','ready');
end;
$$;
revoke all on function public.plannix_auth_ready_callback(text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_ready_callback(text,text,text,text) to service_role;

create function public.plannix_auth_cancel_callback(
  marker_name text, provided_marker_hash text, provided_state_hash text, target_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare binding private.plannix_auth_browser_bindings%rowtype;
begin
  if marker_name !~ '^__Host-plannix-b-[1-9][0-9]{0,15}$'
    or provided_marker_hash !~ '^[0-9a-f]{64}$' or provided_state_hash !~ '^[0-9a-f]{64}$'
    or target_kind not in ('confirmation','recovery') then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select * into binding from private.plannix_auth_browser_bindings as b
    where b.generation=pg_catalog.substring(marker_name,'[0-9]+$')::bigint
      and b.marker_hash=provided_marker_hash for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  update private.plannix_auth_callbacks set cancelled_at=pg_catalog.clock_timestamp()
    where state_hash=provided_state_hash and binding_id=binding.id and kind=target_kind
      and cancelled_at is null and consumed_at is null;
  if not found then
    if exists (select 1 from private.plannix_auth_callbacks as c
      where c.state_hash=provided_state_hash and c.binding_id=binding.id
        and c.kind=target_kind and c.consumed_at is not null) then
      return pg_catalog.jsonb_build_object('state','claimed');
    end if;
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  return pg_catalog.jsonb_build_object('state','cancelled');
end;
$$;
revoke all on function public.plannix_auth_cancel_callback(text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_cancel_callback(text,text,text,text) to service_role;

create function public.plannix_auth_claim_callback(
  marker_name text, provided_marker_hash text, provided_state_hash text,
  provided_flow_id text, target_kind text, session_name text, provided_session_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare binding private.plannix_auth_browser_bindings%rowtype;
  callback private.plannix_auth_callbacks%rowtype;
  initiating private.plannix_auth_transitions%rowtype;
  exchange private.plannix_auth_transitions%rowtype;
  started jsonb; exchange_id uuid; checked_at timestamptz;
begin
  if marker_name !~ '^__Host-plannix-b-[1-9][0-9]{0,15}$'
    or provided_marker_hash !~ '^[0-9a-f]{64}$' or provided_state_hash !~ '^[0-9a-f]{64}$'
    or provided_flow_id !~ '^[0-9a-f]{32}$' or target_kind not in ('confirmation','recovery')
    or (session_name is null) <> (provided_session_hash is null)
    or (session_name is not null and (session_name !~ '^__Host-plannix-[sr]-[1-9][0-9]{0,15}$'
      or provided_session_hash !~ '^[0-9a-f]{64}$')) then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select * into binding from private.plannix_auth_browser_bindings as b
    where b.generation=pg_catalog.substring(marker_name,'[0-9]+$')::bigint
      and b.marker_hash=provided_marker_hash for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select * into callback from private.plannix_auth_callbacks as c
    where c.state_hash=provided_state_hash
      and c.binding_id=binding.id and c.flow_id=provided_flow_id
      and kind=target_kind for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  if not private.plannix_auth_callback_current(binding,callback) then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  if callback.consumed_at is not null or callback.cancelled_at is not null
    or callback.ready_at is null or callback.verifier_envelope is null then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  if (callback.initiating_session_id is null) <> (session_name is null) then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  -- The link cannot open a fresh transition after a newer attempt. Claim and
  -- begin share this binding lock; a subsequent login supersedes the child
  -- transition while provider exchange is pending.
  started := public.plannix_auth_begin(marker_name,provided_marker_hash,
    case when target_kind='confirmation' then 'ordinary' else 'recovery' end,
    session_name,provided_session_hash);
  if started->>'state'<>'started' then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  exchange_id := (started->>'intentId')::uuid;
  update private.plannix_auth_callbacks set consumed_at=pg_catalog.clock_timestamp()
    where state_hash=provided_state_hash;
  -- Begin and the callback update can wait on database work. Re-read every
  -- authority and deadline after that work, before returning a verifier.
  perform private.plannix_auth_observe_expiry(binding);
  select * into binding from private.plannix_auth_browser_bindings
    where id=binding.id for update;
  select * into callback from private.plannix_auth_callbacks
    where state_hash=provided_state_hash for update;
  select * into initiating from private.plannix_auth_transitions
    where id=callback.initiating_intent_id and binding_id=binding.id for update;
  select * into exchange from private.plannix_auth_transitions
    where id=exchange_id and binding_id=binding.id for update;
  checked_at := pg_catalog.clock_timestamp();
  if binding.revoked or binding.expired or binding.expires_at<=checked_at
    or binding.generation is distinct from
      pg_catalog.substring(marker_name,'[0-9]+$')::bigint
    or binding.marker_hash is distinct from provided_marker_hash
    or callback.state_hash is null
    or callback.binding_id is distinct from binding.id
    or callback.cancelled_at is not null or callback.expires_at<=checked_at
    or initiating.id is null or initiating.state<>'superseded'
    or initiating.expires_at<=checked_at
    or initiating.generation<>callback.initiating_generation
    or binding.current_session_id is distinct from callback.initiating_session_id
    or binding.latest_transition_id is distinct from exchange_id
    or exchange.id is null or exchange.state<>'pending'
    or exchange.expires_at<=checked_at
    or (callback.initiating_session_id is not null and not exists (
      select 1 from private.plannix_auth_sessions as s
      where s.id=callback.initiating_session_id and s.binding_id=binding.id
        and not s.revoked and not s.expired and s.expires_at>checked_at)) then
    update private.plannix_auth_callbacks
      set consumed_at=null,cancelled_at=checked_at
      where state_hash=provided_state_hash;
    update private.plannix_auth_transitions set state='expired'
      where id=callback.initiating_intent_id and state='superseded'
        and (expires_at<=checked_at or callback.expires_at<=checked_at);
    update private.plannix_auth_transitions set state='expired'
      where id=exchange_id and state='pending';
    update private.plannix_auth_browser_bindings set latest_transition_id=null
      where id=binding.id and latest_transition_id=exchange_id;
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  return pg_catalog.jsonb_build_object('state','claimed',
    'intentId',exchange_id,'verifierEnvelope',callback.verifier_envelope);
end;
$$;
revoke all on function public.plannix_auth_claim_callback(text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_claim_callback(text,text,text,text,text,text,text) to service_role;

create function public.plannix_auth_claim_refresh(
  marker_name text, marker_hash text, session_name text, session_hash text, expected_version bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_session jsonb; claim_id uuid;
begin
  current_session := public.plannix_auth_inspect(marker_name,marker_hash,session_name,session_hash,'ordinary');
  if current_session->>'state'<>'current' then return pg_catalog.jsonb_build_object('state','rejected'); end if;
  if (current_session->>'tokenVersion')::bigint<>expected_version then
    return pg_catalog.jsonb_build_object('state','conflict'); end if;
  claim_id := pg_catalog.gen_random_uuid();
  update private.plannix_auth_sessions as s set refresh_claim=claim_id,
    refresh_claim_expires_at=pg_catalog.clock_timestamp()+interval '15 seconds'
    where s.id=(current_session->>'sessionId')::uuid and s.token_version=expected_version
      and (s.refresh_claim is null or s.refresh_claim_expires_at<=pg_catalog.clock_timestamp())
      and not s.revoked and not s.expired and s.expires_at>pg_catalog.clock_timestamp();
  if not found then return pg_catalog.jsonb_build_object('state','busy'); end if;
  return pg_catalog.jsonb_build_object('state','claimed','claimId',claim_id,
    'sessionId',current_session->>'sessionId','ownerId',current_session->>'ownerId',
    'tokenVersion',expected_version,'accessEnvelope',current_session->'accessEnvelope',
    'refreshEnvelope',current_session->'refreshEnvelope');
end;
$$;
revoke all on function public.plannix_auth_claim_refresh(text,text,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_claim_refresh(text,text,text,text,bigint) to service_role;

create function public.plannix_auth_finish_refresh(
  claim_id uuid, target_session uuid, expected_version bigint,
  access_cipher jsonb, refresh_cipher jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare binding private.plannix_auth_browser_bindings%rowtype;
  session_record private.plannix_auth_sessions%rowtype;
begin
  if claim_id is null or target_session is null or expected_version is null
    or access_cipher is null or refresh_cipher is null then
    return pg_catalog.jsonb_build_object('state','invalid'); end if;
  select b.* into binding from private.plannix_auth_browser_bindings as b
    join private.plannix_auth_sessions as s on s.binding_id=b.id
    where s.id=target_session for update of b;
  if not found then return pg_catalog.jsonb_build_object('state','rejected'); end if;
  select * into session_record from private.plannix_auth_sessions where id=target_session for update;
  perform private.plannix_auth_observe_expiry(binding);
  -- The observer writes terminal expiry. Do not rely on the row image fetched
  -- before that write, especially if the wall clock later moves backwards.
  select * into binding from private.plannix_auth_browser_bindings where id=binding.id;
  select * into session_record from private.plannix_auth_sessions where id=target_session;
  if binding.current_session_id is distinct from target_session or binding.revoked or binding.expired
    or session_record.revoked or session_record.expired or session_record.expires_at<=pg_catalog.clock_timestamp()
    or session_record.refresh_claim is distinct from claim_id
    or session_record.refresh_claim_expires_at<=pg_catalog.clock_timestamp()
    or session_record.token_version<>expected_version then
    return pg_catalog.jsonb_build_object('state','conflict'); end if;
  update private.plannix_auth_sessions set token_version=expected_version+1,
    access_envelope=access_cipher,refresh_envelope=refresh_cipher,
    refresh_claim=null,refresh_claim_expires_at=null where id=target_session;
  return pg_catalog.jsonb_build_object('state','refreshed','tokenVersion',expected_version+1);
end;
$$;
revoke all on function public.plannix_auth_finish_refresh(uuid,uuid,bigint,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_finish_refresh(uuid,uuid,bigint,jsonb,jsonb) to service_role;

create function public.plannix_auth_release_refresh(claim_id uuid, target_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update private.plannix_auth_sessions set refresh_claim=null,refresh_claim_expires_at=null
    where id=target_session and refresh_claim=claim_id;
  return pg_catalog.jsonb_build_object('state','released');
end;
$$;
revoke all on function public.plannix_auth_release_refresh(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_release_refresh(uuid,uuid) to service_role;

commit;
