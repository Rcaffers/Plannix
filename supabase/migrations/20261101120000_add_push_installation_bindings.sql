-- The Supabase CLI owns this migration's transaction and history entry.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Generic subscriptions remain deliverable. Detail authorization is disabled by
-- default and must additionally prove the bound session is still current.
alter table private.plannix_push_subscriptions
  add column installation_id uuid not null default pg_catalog.gen_random_uuid(),
  add column installation_version uuid not null default pg_catalog.gen_random_uuid(),
  add column bound_session_id uuid references private.plannix_auth_sessions(id) on delete set null,
  add column detail_disabled boolean not null default true;
create unique index plannix_push_installation_id on private.plannix_push_subscriptions(installation_id);

-- The service role supplies only the session ID obtained from the verified
-- cookie guard. Lock order: browser binding, auth.users, endpoint row.
-- The binding lock serializes registration with auth settlement and logout.
create function private.plannix_push_current_session(target_session uuid)
returns table(binding_id uuid, owner_id uuid) language plpgsql security definer set search_path = '' as $$
declare found_binding uuid;
declare locked_binding private.plannix_auth_browser_bindings%rowtype;
declare current_session private.plannix_auth_sessions%rowtype;
begin
  select s.binding_id into found_binding from private.plannix_auth_sessions as s where s.id=target_session;
  if found_binding is null then return; end if;
  select * into locked_binding from private.plannix_auth_browser_bindings as b
    where b.id=found_binding for update;
  if not found then return; end if;
  perform private.plannix_auth_observe_expiry(locked_binding);
  select * into locked_binding from private.plannix_auth_browser_bindings as b where b.id=found_binding;
  select * into current_session from private.plannix_auth_sessions as s where s.id=target_session;
  if current_session.id is null or current_session.kind <> 'ordinary'
    or current_session.revoked or current_session.expired
    or current_session.expires_at <= pg_catalog.clock_timestamp()
    or locked_binding.revoked or locked_binding.expired
    or locked_binding.expires_at <= pg_catalog.clock_timestamp()
    or locked_binding.current_session_id is distinct from target_session then
    if current_session.id is not null and current_session.expires_at <= pg_catalog.clock_timestamp() then
      update private.plannix_auth_sessions set expired=true,revoked=true where id=target_session;
    end if;
    return;
  end if;
  binding_id := found_binding;
  owner_id := current_session.owner_id;
  return next;
end;
$$;
revoke all on function private.plannix_push_current_session(uuid) from public, anon, authenticated, service_role;

-- Observation never reveals another account. Possession of the current push
-- keys is needed to obtain a version for reassignment; no retry is implicit.
create function public.plannix_push_observe_installation(
  target_session uuid, target_hash text, target_p256dh text, target_auth text
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare authorized record;
declare device private.plannix_push_subscriptions%rowtype;
begin
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
  if target_hash is null or target_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  select * into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash for share;
  if not found then return pg_catalog.jsonb_build_object('state','absent'); end if;
  if device.p256dh is distinct from target_p256dh or device.auth_key is distinct from target_auth then
    return pg_catalog.jsonb_build_object('state','changed');
  end if;
  -- A queued row read may cross an auth or wall-clock deadline.
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
  return pg_catalog.jsonb_build_object('state','current','version',device.installation_version);
end;
$$;
revoke all on function public.plannix_push_observe_installation(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.plannix_push_observe_installation(uuid,text,text,text) to service_role;

create function public.plannix_push_register_installation(
  target_session uuid, target_hash text, target_endpoint text, target_p256dh text,
  target_auth text, expected_version uuid
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare authorized record;
declare device private.plannix_push_subscriptions%rowtype;
declare new_version uuid;
begin
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
  if target_hash is null or target_hash !~ '^[0-9a-f]{64}$'
    or pg_catalog.length(target_endpoint) not between 30 and 2048
    or pg_catalog.length(target_p256dh) not between 80 and 128
    or pg_catalog.length(target_auth) not between 16 and 32 then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  perform 1 from auth.users as u where u.id=authorized.owner_id and u.email_confirmed_at is not null for update;
  if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
  begin
   select * into device from private.plannix_push_subscriptions as s
     where s.endpoint_hash=target_hash for update;
   if not found then
    if expected_version is not null then return pg_catalog.jsonb_build_object('state','conflict'); end if;
    if (select pg_catalog.count(*) from private.plannix_push_subscriptions as s
      where s.user_id=authorized.owner_id) >= 10 then
      return pg_catalog.jsonb_build_object('state','limit');
    end if;
    -- A competing first registration can win while this insert waits.
    insert into private.plannix_push_subscriptions
      (endpoint_hash,user_id,endpoint,p256dh,auth_key,bound_session_id)
    values (target_hash,authorized.owner_id,target_endpoint,target_p256dh,target_auth,target_session)
    on conflict (endpoint_hash) do nothing;
    if not found then return pg_catalog.jsonb_build_object('state','conflict'); end if;
   else
    if expected_version is distinct from device.installation_version
      or device.p256dh is distinct from target_p256dh
      or device.auth_key is distinct from target_auth then
      return pg_catalog.jsonb_build_object('state','conflict');
    end if;
    if device.user_id <> authorized.owner_id and
      (select pg_catalog.count(*) from private.plannix_push_subscriptions as s
        where s.user_id=authorized.owner_id) >= 10 then
      return pg_catalog.jsonb_build_object('state','limit');
    end if;
    update private.plannix_push_subscriptions as s set
      user_id=authorized.owner_id, endpoint=target_endpoint,
      p256dh=target_p256dh, auth_key=target_auth,
      installation_id=case when s.user_id=authorized.owner_id then s.installation_id
        else pg_catalog.gen_random_uuid() end,
      installation_version=pg_catalog.gen_random_uuid(),
      subscription_version=pg_catalog.gen_random_uuid(),
      bound_session_id=target_session, detail_disabled=true,
      last_test_at=case when s.user_id=authorized.owner_id then s.last_test_at else null end
      where s.endpoint_hash=target_hash;
   end if;
   -- A delayed insert/update can cross expiry. Roll back only the provisional
   -- endpoint change, then observe expiry outside this subtransaction.
   select * into authorized from private.plannix_push_current_session(target_session);
   if not found then raise exception using errcode='P2001', message='Notification session changed.'; end if;
   select s.installation_version into new_version from private.plannix_push_subscriptions as s
     where s.endpoint_hash=target_hash and s.bound_session_id=target_session;
  exception when sqlstate 'P2001' then
    perform private.plannix_push_current_session(target_session);
    return pg_catalog.jsonb_build_object('state','stale');
  end;
  return pg_catalog.jsonb_build_object('state','registered','version',new_version);
end;
$$;
revoke all on function public.plannix_push_register_installation(uuid,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.plannix_push_register_installation(uuid,text,text,text,text,uuid) to service_role;

create function public.plannix_push_claim_installation(
  target_session uuid, target_hash text, target_p256dh text, target_auth text
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare authorized record;
declare device private.plannix_push_subscriptions%rowtype;
begin
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
  select * into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash for share;
  if not found or device.user_id <> authorized.owner_id then
    return pg_catalog.jsonb_build_object('state','absent');
  end if;
  if device.p256dh is distinct from target_p256dh or device.auth_key is distinct from target_auth then
    return pg_catalog.jsonb_build_object('state','superseded');
  end if;
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
  return pg_catalog.jsonb_build_object('state','current','version',device.installation_version);
end;
$$;
revoke all on function public.plannix_push_claim_installation(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.plannix_push_claim_installation(uuid,text,text,text) to service_role;

create function public.plannix_push_remove_installation(
  target_session uuid, target_hash text, claimed_version uuid
) returns boolean language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare authorized record;
declare removed_count integer;
begin
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found or claimed_version is null then return false; end if;
  perform 1 from private.plannix_push_subscriptions as s where s.endpoint_hash=target_hash for update;
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found then return false; end if;
  delete from private.plannix_push_subscriptions as s where s.endpoint_hash=target_hash
    and s.user_id=authorized.owner_id and s.installation_version=claimed_version;
  get diagnostics removed_count = row_count;
  return removed_count=1;
end;
$$;
revoke all on function public.plannix_push_remove_installation(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.plannix_push_remove_installation(uuid,text,uuid) to service_role;

-- No enable-detail function exists in this stage. Effective authorization
-- requires this flag, current bound session, and future per-reference checks.
