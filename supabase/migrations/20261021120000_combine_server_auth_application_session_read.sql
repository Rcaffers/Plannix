begin;

-- Keep the last potentially delayed row read separate so expiry is observed
-- after it, including when storage or a lock wait delays this read.
create function private.plannix_auth_final_session_read(
  target_id uuid, target_binding uuid, target_generation bigint, target_hash text
) returns private.plannix_auth_sessions language plpgsql set search_path = '' as $$
declare selected private.plannix_auth_sessions%rowtype;
begin
  select * into selected from private.plannix_auth_sessions as s
    where s.id=target_id and s.binding_id=target_binding
      and s.generation=target_generation and s.secret_hash=target_hash for update;
  return selected;
end;
$$;
revoke all on function private.plannix_auth_final_session_read(uuid,uuid,bigint,text)
  from public, anon, authenticated, service_role;

-- One PostgREST request for protected application access. The existing selector
-- still verifies every cookie and performs only proven-version cleanup; inspect
-- rechecks the selected ordinary session while the selector's row locks remain
-- held. Neither function is replaced for bootstrap or auth-router requests.
create function public.plannix_auth_select_application(candidates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare chosen jsonb; inspected jsonb; candidate_marker_hash text; candidate_session_hash text;
  safe_cleanup jsonb;
  binding private.plannix_auth_browser_bindings%rowtype;
  session_record private.plannix_auth_sessions%rowtype;
begin
  chosen := public.plannix_auth_select(candidates);
  if chosen->>'state' <> 'selected' or chosen->>'sessionName' is null then
    return chosen;
  end if;
  select item->>'hash' into candidate_marker_hash
    from pg_catalog.jsonb_array_elements(candidates->'markers') as item
    where item->>'name'=chosen->>'markerName';
  select item->>'hash' into candidate_session_hash
    from pg_catalog.jsonb_array_elements(candidates->'sessions') as item
    where item->>'name'=chosen->>'sessionName';
  if candidate_marker_hash is null or candidate_session_hash is null then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  inspected := public.plannix_auth_inspect(chosen->>'markerName',candidate_marker_hash,
    chosen->>'sessionName',candidate_session_hash,'ordinary');
  safe_cleanup := coalesce(chosen->'cleanup','[]'::jsonb);
  if inspected->>'state' <> 'current' then
    if inspected->>'cleanup' in (chosen->>'markerName',chosen->>'sessionName')
      and not safe_cleanup ? (inspected->>'cleanup') then
      safe_cleanup := safe_cleanup || pg_catalog.jsonb_build_array(inspected->>'cleanup');
    end if;
    return pg_catalog.jsonb_build_object('state',inspected->>'state',
      'cleanup',safe_cleanup);
  end if;

  -- Inspect can itself wait on database work. Recheck eligibility using fresh
  -- database time before returning any usable envelope. Both rows remain locked
  -- until this RPC transaction ends.
  select * into binding from private.plannix_auth_browser_bindings as b
    where b.generation=pg_catalog.substring(chosen->>'markerName','[0-9]+$')::bigint
      and b.marker_hash=candidate_marker_hash for update;
  if not found then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  session_record := private.plannix_auth_final_session_read((inspected->>'sessionId')::uuid,
    binding.id,pg_catalog.substring(chosen->>'sessionName','[0-9]+$')::bigint,
    candidate_session_hash);
  if session_record.id is null then return pg_catalog.jsonb_build_object('state','invalid'); end if;
  -- This is the last row read. It may have been delayed independently of
  -- inspect, so observe binding expiry only after it completes.
  if private.plannix_auth_observe_expiry(binding) then
    return pg_catalog.jsonb_build_object('state','expired',
      'cleanup',safe_cleanup || pg_catalog.jsonb_build_array(chosen->>'markerName'));
  end if;
  if session_record.expires_at<=pg_catalog.clock_timestamp() then
    update private.plannix_auth_sessions set expired=true,revoked=true
      where id=session_record.id;
    return pg_catalog.jsonb_build_object('state','expired',
      'cleanup',safe_cleanup || pg_catalog.jsonb_build_array(chosen->>'sessionName'));
  end if;
  if binding.revoked or session_record.revoked or session_record.expired
    or binding.current_session_id is distinct from session_record.id
    or session_record.kind<>'ordinary'
    or session_record.token_version<>(inspected->>'tokenVersion')::bigint then
    return pg_catalog.jsonb_build_object('state','absent',
      'cleanup',chosen->'cleanup');
  end if;
  return chosen || inspected;
end;
$$;
revoke all on function public.plannix_auth_select_application(jsonb)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_select_application(jsonb) to service_role;

commit;
