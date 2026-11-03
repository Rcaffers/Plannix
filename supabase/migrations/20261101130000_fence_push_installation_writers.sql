-- The Supabase CLI owns this migration's transaction and history entry.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Wait for writers that have reached the subscription table before installing
-- the trigger. Subsequent writes, including calls using an old cached RPC body,
-- must pass the trigger. The deployment still must quiesce old HTTP writers.
lock table private.plannix_push_subscriptions in access exclusive mode;

create table private.plannix_push_endpoint_history (
  endpoint_hash text primary key check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  generation uuid not null,
  active boolean not null,
  server_managed_seen boolean not null default false
);
alter table private.plannix_push_endpoint_history enable row level security;
revoke all on table private.plannix_push_endpoint_history from public, anon, authenticated, service_role;
insert into private.plannix_push_endpoint_history(endpoint_hash,generation,active,server_managed_seen)
select endpoint_hash,installation_version,true,bound_session_id is not null
from private.plannix_push_subscriptions;

create function private.plannix_push_track_endpoint()
returns trigger language plpgsql security definer set search_path = '' as $$
declare history private.plannix_push_endpoint_history%rowtype;
declare material_change boolean;
begin
  if tg_op = 'INSERT' then
    select * into history from private.plannix_push_endpoint_history as h
      where h.endpoint_hash=new.endpoint_hash for update;
    if found then
      -- A new endpoint may use only the generation returned by a fresh
      -- observation of a removed endpoint. A legacy insert has no such value.
      if history.active or new.installation_version is distinct from history.generation then
        raise exception using errcode='P2002',message='Notification installation changed.';
      end if;
      new.installation_version := pg_catalog.gen_random_uuid();
      update private.plannix_push_endpoint_history as h set generation=new.installation_version,
        active=true,server_managed_seen=h.server_managed_seen or new.bound_session_id is not null
        where h.endpoint_hash=new.endpoint_hash;
    else
      insert into private.plannix_push_endpoint_history(endpoint_hash,generation,active,server_managed_seen)
      values (new.endpoint_hash,new.installation_version,true,new.bound_session_id is not null)
      on conflict (endpoint_hash) do nothing;
      if not found then
        raise exception using errcode='P2002',message='Notification installation changed.';
      end if;
    end if;
    new.detail_disabled := true;
    return new;
  end if;

  select * into history from private.plannix_push_endpoint_history as h
    where h.endpoint_hash=old.endpoint_hash for update;
  if not found or not history.active or history.generation is distinct from old.installation_version then
    raise exception using errcode='P2002',message='Notification installation changed.';
  end if;
  if tg_op = 'DELETE' then
    update private.plannix_push_endpoint_history as h set generation=pg_catalog.gen_random_uuid(),active=false
      where h.endpoint_hash=old.endpoint_hash;
    return old;
  end if;
  if new.endpoint_hash is distinct from old.endpoint_hash then
    raise exception using errcode='P2002',message='Notification installation changed.';
  end if;
  material_change := row(new.user_id,new.endpoint,new.p256dh,new.auth_key,new.bound_session_id,
      new.installation_id,new.installation_version,new.subscription_version)
    is distinct from row(old.user_id,old.endpoint,old.p256dh,old.auth_key,old.bound_session_id,
      old.installation_id,old.installation_version,old.subscription_version);
  if not material_change then return new; end if;
  if history.server_managed_seen then
    if new.bound_session_id is null or new.installation_version is not distinct from old.installation_version then
      raise exception using errcode='P2002',message='Legacy notification write is unsupported.';
    end if;
  elsif new.bound_session_id is null then
    -- The bearer writer has no installation CAS. It may update only an
    -- installation that has never been managed by a server session.
    new.installation_version := pg_catalog.gen_random_uuid();
  elsif new.installation_version is not distinct from old.installation_version then
    raise exception using errcode='P2002',message='Notification installation changed.';
  end if;
  new.detail_disabled := true;
  update private.plannix_push_endpoint_history as h set generation=new.installation_version,
    server_managed_seen=h.server_managed_seen or new.bound_session_id is not null
    where h.endpoint_hash=old.endpoint_hash;
  return new;
end;
$$;
revoke all on function private.plannix_push_track_endpoint() from public, anon, authenticated, service_role;
create trigger plannix_push_track_endpoint before insert or update or delete
  on private.plannix_push_subscriptions for each row execute function private.plannix_push_track_endpoint();

-- A legacy call can continue managing a never-server-bound generic endpoint.
-- It cannot rewrite an endpoint that has ever belonged to the versioned path.
create or replace function public.plannix_push_register_device(
  validated_user_id uuid,target_hash text,target_endpoint text,target_p256dh text,target_auth text
) returns boolean language plpgsql security definer set search_path = '' set lock_timeout='2s' as $$
declare device private.plannix_push_subscriptions%rowtype;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  if target_hash is null or target_hash !~ '^[0-9a-f]{64}$'
    or pg_catalog.length(target_endpoint) not between 30 and 2048
    or pg_catalog.length(target_p256dh) not between 80 and 128
    or pg_catalog.length(target_auth) not between 16 and 32 then
    raise exception using errcode='22023',message='Invalid push subscription.';
  end if;
  perform 1 from auth.users as u where u.id=validated_user_id for update;
  select * into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash for update;
  if found then
    if device.bound_session_id is not null or exists (
      select 1 from private.plannix_push_endpoint_history as h
      where h.endpoint_hash=target_hash and h.server_managed_seen) then
      raise exception using errcode='P2002',message='Legacy notification write is unsupported.';
    end if;
    if device.user_id<>validated_user_id and (select pg_catalog.count(*)
      from private.plannix_push_subscriptions as s where s.user_id=validated_user_id)>=10 then
      raise exception using errcode='P1001',message='Device limit reached.';
    end if;
    update private.plannix_push_subscriptions as s set user_id=validated_user_id,
      endpoint=target_endpoint,p256dh=target_p256dh,auth_key=target_auth,
      subscription_version=pg_catalog.gen_random_uuid(),detail_disabled=true,
      last_test_at=case when s.user_id=validated_user_id then s.last_test_at else null end
      where s.endpoint_hash=target_hash;
  else
    if exists (select 1 from private.plannix_push_endpoint_history as h where h.endpoint_hash=target_hash) then
      raise exception using errcode='P2002',message='Legacy notification write is unsupported.';
    end if;
    if (select pg_catalog.count(*) from private.plannix_push_subscriptions as s
      where s.user_id=validated_user_id)>=10 then
      raise exception using errcode='P1001',message='Device limit reached.';
    end if;
    insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key)
      values(target_hash,validated_user_id,target_endpoint,target_p256dh,target_auth)
      on conflict (endpoint_hash) do nothing;
    if not found then raise exception using errcode='P2002',message='Notification installation changed.'; end if;
  end if;
  return true;
end;
$$;

create or replace function public.plannix_push_remove_device(
  validated_user_id uuid,target_hash text,claimed_version uuid
) returns boolean language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare device private.plannix_push_subscriptions%rowtype;
declare removed_count integer;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  select * into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash for update;
  if not found or device.user_id<>validated_user_id
    or device.subscription_version is distinct from claimed_version then return false; end if;
  if device.bound_session_id is not null or exists (
    select 1 from private.plannix_push_endpoint_history as h
    where h.endpoint_hash=target_hash and h.server_managed_seen) then
    raise exception using errcode='P2002',message='Legacy notification write is unsupported.';
  end if;
  delete from private.plannix_push_subscriptions as s where s.endpoint_hash=target_hash
    and s.user_id=validated_user_id and s.subscription_version=claimed_version;
  get diagnostics removed_count=row_count;
  return removed_count=1;
end;
$$;

create or replace function public.plannix_push_observe_installation(
  target_session uuid,target_hash text,target_p256dh text,target_auth text
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare authorized record;
declare device private.plannix_push_subscriptions%rowtype;
declare absent_version uuid;
begin
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
  if target_hash is null or target_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  select * into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash for share;
  if found and (device.p256dh is distinct from target_p256dh or device.auth_key is distinct from target_auth) then
    return pg_catalog.jsonb_build_object('state','changed');
  end if;
  if device.endpoint_hash is null then
    select h.generation into absent_version from private.plannix_push_endpoint_history as h
      where h.endpoint_hash=target_hash and not h.active for share;
  end if;
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
  if device.endpoint_hash is null then
    return pg_catalog.jsonb_build_object('state','absent','version',absent_version);
  end if;
  return pg_catalog.jsonb_build_object('state','current','version',device.installation_version);
end;
$$;

-- The original function is replaced only in this additive migration. The
-- endpoint trigger is the final CAS, including for an absent tombstone row.
create or replace function public.plannix_push_register_installation(
  target_session uuid,target_hash text,target_endpoint text,target_p256dh text,
  target_auth text,expected_version uuid
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare authorized record;
declare device private.plannix_push_subscriptions%rowtype;
declare history private.plannix_push_endpoint_history%rowtype;
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
      select * into history from private.plannix_push_endpoint_history as h where h.endpoint_hash=target_hash;
      if (history.endpoint_hash is null and expected_version is not null)
        or (history.endpoint_hash is not null and (history.active or expected_version is distinct from history.generation)) then
        return pg_catalog.jsonb_build_object('state','conflict');
      end if;
      if (select pg_catalog.count(*) from private.plannix_push_subscriptions as s
        where s.user_id=authorized.owner_id)>=10 then
        return pg_catalog.jsonb_build_object('state','limit');
      end if;
      insert into private.plannix_push_subscriptions
        (endpoint_hash,user_id,endpoint,p256dh,auth_key,bound_session_id,installation_version)
      values(target_hash,authorized.owner_id,target_endpoint,target_p256dh,target_auth,
        target_session,coalesce(expected_version,pg_catalog.gen_random_uuid()))
      on conflict (endpoint_hash) do nothing;
      if not found then return pg_catalog.jsonb_build_object('state','conflict'); end if;
    else
      if expected_version is distinct from device.installation_version
        or device.p256dh is distinct from target_p256dh or device.auth_key is distinct from target_auth then
        return pg_catalog.jsonb_build_object('state','conflict');
      end if;
      if device.user_id<>authorized.owner_id and (select pg_catalog.count(*)
        from private.plannix_push_subscriptions as s where s.user_id=authorized.owner_id)>=10 then
        return pg_catalog.jsonb_build_object('state','limit');
      end if;
      update private.plannix_push_subscriptions as s set
        user_id=authorized.owner_id,endpoint=target_endpoint,p256dh=target_p256dh,auth_key=target_auth,
        installation_id=case when s.user_id=authorized.owner_id then s.installation_id else pg_catalog.gen_random_uuid() end,
        installation_version=pg_catalog.gen_random_uuid(),subscription_version=pg_catalog.gen_random_uuid(),
        bound_session_id=target_session,detail_disabled=true,
        last_test_at=case when s.user_id=authorized.owner_id then s.last_test_at else null end
        where s.endpoint_hash=target_hash;
    end if;
    select * into authorized from private.plannix_push_current_session(target_session);
    if not found then raise exception using errcode='P2001',message='Notification session changed.'; end if;
    select s.installation_version into new_version from private.plannix_push_subscriptions as s
      where s.endpoint_hash=target_hash and s.bound_session_id=target_session;
  exception when sqlstate 'P2001' then
    perform private.plannix_push_current_session(target_session);
    return pg_catalog.jsonb_build_object('state','stale');
  when sqlstate 'P2002' then
    -- A uniqueness/history wait can cross the auth deadline as well.
    select * into authorized from private.plannix_push_current_session(target_session);
    if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
    return pg_catalog.jsonb_build_object('state','conflict');
  end;
  return pg_catalog.jsonb_build_object('state','registered','version',new_version);
end;
$$;

create or replace function public.plannix_push_status_installation(target_session uuid,target_hash text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare authorized record;
declare device private.plannix_push_subscriptions%rowtype;
begin
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found or target_hash is null or target_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('state','stale');
  end if;
  select * into device from private.plannix_push_subscriptions as s where s.endpoint_hash=target_hash for share;
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
  return pg_catalog.jsonb_build_object('state','current',
    'registered',device.endpoint_hash is not null and device.user_id=authorized.owner_id,
    'boundToCurrentSession',device.endpoint_hash is not null and device.user_id=authorized.owner_id
      and device.bound_session_id=target_session,
    'detailEligible',false);
end;
$$;
revoke all on function public.plannix_push_status_installation(uuid,text) from public, anon, authenticated;
grant execute on function public.plannix_push_status_installation(uuid,text) to service_role;

-- The exact owner and captured generic version still fence dispatch cleanup.
-- The DELETE trigger advances the endpoint generation before it can be reused.
create or replace function public.plannix_push_remove_expired_device(
  validated_user_id uuid,target_hash text,claimed_version uuid
) returns boolean language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare removed_count integer;
begin
  delete from private.plannix_push_subscriptions as s
    where s.user_id=validated_user_id and s.endpoint_hash=target_hash
      and s.subscription_version=claimed_version;
  get diagnostics removed_count=row_count;
  return removed_count=1;
end;
$$;
