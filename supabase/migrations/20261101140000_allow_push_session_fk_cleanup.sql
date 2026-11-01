begin;

-- Additive correction: the bound-session FK uses ON DELETE SET NULL. Its
-- exact child update must not make auth-session retention or binding cleanup
-- depend on a push row. Legacy writers cannot create the narrow condition:
-- they cannot update this private table directly, their RPCs never clear the
-- bound session, and the referenced parent must already be absent.
create or replace function private.plannix_push_track_endpoint()
returns trigger language plpgsql security definer set search_path = '' as $$
declare history private.plannix_push_endpoint_history%rowtype;
declare material_change boolean;
declare session_fk_cleanup boolean;
begin
  if tg_op = 'INSERT' then
    select * into history from private.plannix_push_endpoint_history as h
      where h.endpoint_hash=new.endpoint_hash for update;
    if found then
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

  -- Only PostgreSQL's exact SET NULL update can meet all conditions. A caller
  -- that simply writes NULL while the parent exists remains rejected. Compare
  -- every other column so an update cannot smuggle owner, keys or versions.
  session_fk_cleanup := history.server_managed_seen
    and old.bound_session_id is not null and new.bound_session_id is null
    and pg_catalog.to_jsonb(new) - 'bound_session_id'
      is not distinct from pg_catalog.to_jsonb(old) - 'bound_session_id'
    and not exists (select 1 from private.plannix_auth_sessions as s
      where s.id=old.bound_session_id);
  if session_fk_cleanup then
    new.installation_version := pg_catalog.gen_random_uuid();
    new.subscription_version := pg_catalog.gen_random_uuid();
    new.detail_disabled := true;
    update private.plannix_push_endpoint_history as h set generation=new.installation_version
      where h.endpoint_hash=old.endpoint_hash;
    return new;
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

commit;
