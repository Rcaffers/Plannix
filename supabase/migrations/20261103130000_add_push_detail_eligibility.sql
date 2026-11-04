-- The pinned CLI owns the schema and history transaction.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A separate policy generation prevents a delayed enable from undoing a
-- later disable. Legacy and current registration continue to force details off.
alter table private.plannix_push_subscriptions
  add column detail_policy_version uuid not null default pg_catalog.gen_random_uuid();

-- Status exposes the committed, non-secret installation version to the
-- current session. An owner-only generic subscription is never a detail grant.
create or replace function public.plannix_push_status_installation(target_session uuid,target_hash text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare authorized record;
declare device private.plannix_push_subscriptions%rowtype;
begin
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found or target_hash is null or target_hash !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('state','stale');
  end if;
  select * into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash for share;
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found then return pg_catalog.jsonb_build_object('state','stale'); end if;
  return pg_catalog.jsonb_build_object('state','current',
    'registered',device.endpoint_hash is not null and device.user_id=authorized.owner_id,
    'boundToCurrentSession',device.endpoint_hash is not null and device.user_id=authorized.owner_id
      and device.bound_session_id=target_session,
    'version',case when device.endpoint_hash is not null
      and device.user_id=authorized.owner_id and device.bound_session_id=target_session
      then device.installation_version else null end,
    'detailEligible',false);
end;
$$;
revoke all on function public.plannix_push_status_installation(uuid,text) from public, anon, authenticated;
grant execute on function public.plannix_push_status_installation(uuid,text) to service_role;

create function private.plannix_push_rotate_detail_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if row(new.user_id,new.endpoint,new.p256dh,new.auth_key,new.bound_session_id,
      new.installation_id,new.installation_version,new.subscription_version)
    is distinct from row(old.user_id,old.endpoint,old.p256dh,old.auth_key,old.bound_session_id,
      old.installation_id,old.installation_version,old.subscription_version) then
    new.detail_policy_version := pg_catalog.gen_random_uuid();
  end if;
  return new;
end;
$$;
revoke all on function private.plannix_push_rotate_detail_policy() from public, anon, authenticated, service_role;
-- This runs after plannix_push_track_endpoint. The existing fence therefore
-- remains authoritative for material ownership and installation changes.
create trigger zz_plannix_push_rotate_detail_policy before update
  on private.plannix_push_subscriptions for each row
  execute function private.plannix_push_rotate_detail_policy();

create function public.plannix_push_detail_policy_status(
  target_session uuid, target_hash text, expected_version uuid, target_pilot uuid
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare authorized record;
declare device private.plannix_push_subscriptions%rowtype;
begin
  if target_hash is null or target_hash !~ '^[0-9a-f]{64}$'
    or expected_version is null or target_pilot is null then return null; end if;
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found or authorized.owner_id is distinct from target_pilot then return null; end if;
  select * into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash for share;
  if not found or device.user_id is distinct from authorized.owner_id
    or device.bound_session_id is distinct from target_session
    or device.installation_version is distinct from expected_version then return null; end if;
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found or authorized.owner_id is distinct from target_pilot then return null; end if;
  return pg_catalog.jsonb_build_object('policyVersion',device.detail_policy_version,
    'enabled',not device.detail_disabled);
end;
$$;
revoke all on function public.plannix_push_detail_policy_status(uuid,text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_push_detail_policy_status(uuid,text,uuid,uuid)
  to service_role;

create function public.plannix_push_set_detail_eligibility(
  target_session uuid, target_hash text, expected_version uuid,
  expected_policy_version uuid, target_pilot uuid, target_enabled boolean
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare authorized record;
declare device private.plannix_push_subscriptions%rowtype;
declare preference private.plannix_morning_summary_preferences%rowtype;
declare new_version uuid;
begin
  if target_hash is null or target_hash !~ '^[0-9a-f]{64}$'
    or expected_version is null or expected_policy_version is null
    or target_pilot is null or target_enabled is null then return null; end if;
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found or authorized.owner_id is distinct from target_pilot then return null; end if;
  if target_enabled then
    select * into preference from private.plannix_morning_summary_preferences as p
      where p.user_id=authorized.owner_id for share;
    if not found or not preference.enabled or not preference.lesson_detail_consent
      or preference.academic_year_id is null then return null; end if;
  end if;
  select * into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash for update;
  if not found or device.user_id is distinct from authorized.owner_id
    or device.bound_session_id is distinct from target_session
    or device.installation_version is distinct from expected_version
    or device.detail_policy_version is distinct from expected_policy_version then return null; end if;
  begin
    new_version := pg_catalog.gen_random_uuid();
    update private.plannix_push_subscriptions as s
      set detail_disabled=not target_enabled, detail_policy_version=new_version
      where s.endpoint_hash=target_hash and s.user_id=authorized.owner_id
        and s.bound_session_id=target_session and s.installation_version=expected_version
        and s.detail_policy_version=expected_policy_version;
    if not found then return null; end if;
    -- The endpoint lock can be delayed until either auth or wall-clock expiry.
    select * into authorized from private.plannix_push_current_session(target_session);
    if not found or authorized.owner_id is distinct from target_pilot then
      raise exception using errcode='P2001',message='Notification session changed.';
    end if;
  exception when sqlstate 'P2001' then
    perform private.plannix_push_current_session(target_session);
    return null;
  end;
  return pg_catalog.jsonb_build_object('policyVersion',new_version,
    'enabled',target_enabled);
end;
$$;
revoke all on function public.plannix_push_set_detail_eligibility(uuid,text,uuid,uuid,uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.plannix_push_set_detail_eligibility(uuid,text,uuid,uuid,uuid,boolean)
  to service_role;

-- Consent withdrawal invalidates every bound detail policy, even if an old
-- enable response or another tab arrives later. Event-title withdrawal is
-- handled by the existing per-reference reauthorization and display lock.
create function private.plannix_push_disable_details_on_consent_withdrawal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.lesson_detail_consent and not new.lesson_detail_consent then
    update private.plannix_push_subscriptions as s
      set detail_disabled=true, detail_policy_version=pg_catalog.gen_random_uuid()
      where s.user_id=new.user_id and not s.detail_disabled;
  end if;
  return new;
end;
$$;
revoke all on function private.plannix_push_disable_details_on_consent_withdrawal()
  from public, anon, authenticated, service_role;
create trigger plannix_push_disable_details_on_consent_withdrawal
  after update of lesson_detail_consent on private.plannix_morning_summary_preferences
  for each row execute function private.plannix_push_disable_details_on_consent_withdrawal();

-- Keep the previously deployed five-argument RPC unchanged for old code. New
-- worker requests must also match the current detail-policy generation.
create function public.plannix_authorize_morning_summary_detail_v2(
  target_session uuid,target_hash text,target_version uuid,target_reference uuid,
  target_pilot uuid,target_policy_version uuid
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare decision jsonb;
declare device private.plannix_push_subscriptions%rowtype;
declare authorized record;
begin
  if target_policy_version is null then return null; end if;
  decision := public.plannix_authorize_morning_summary_detail(
    target_session,target_hash,target_version,target_reference,target_pilot);
  if decision is null then return null; end if;
  select * into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash for share;
  if not found or device.installation_version is distinct from target_version
    or device.bound_session_id is distinct from target_session
    or device.detail_policy_version is distinct from target_policy_version
    or device.detail_disabled then return null; end if;
  -- The additional row read can itself wait across expiry.
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found or authorized.owner_id is distinct from target_pilot then return null; end if;
  return decision;
end;
$$;
revoke all on function public.plannix_authorize_morning_summary_detail_v2(uuid,text,uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_authorize_morning_summary_detail_v2(uuid,text,uuid,uuid,uuid,uuid)
  to service_role;
