-- Supabase CLI owns the schema and history transaction. No table change.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Either consent may authorize the shared device policy. Every other pilot,
-- session, binding and version precondition remains in force.
create or replace function public.plannix_push_set_detail_eligibility(
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
    if not found or not preference.enabled
      or not (preference.lesson_detail_consent or preference.event_title_consent)
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

-- Withdrawing the last consent disables all policies. Withdrawing only one
-- leaves the other consent independent; client selector invalidation and
-- per-reference reauthorization still prevent stale detail release.
create or replace function private.plannix_push_disable_details_on_consent_withdrawal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.lesson_detail_consent or old.event_title_consent)
    and not (new.lesson_detail_consent or new.event_title_consent) then
    update private.plannix_push_subscriptions as s
      set detail_disabled=true, detail_policy_version=pg_catalog.gen_random_uuid()
      where s.user_id=new.user_id and not s.detail_disabled;
  end if;
  return new;
end;
$$;
revoke all on function private.plannix_push_disable_details_on_consent_withdrawal()
  from public, anon, authenticated, service_role;

-- The existing trigger fires only for lesson-consent updates. Event-only
-- withdrawal must invoke the same last-consent policy rotation.
drop trigger if exists plannix_push_disable_details_on_consent_withdrawal
  on private.plannix_morning_summary_preferences;
create trigger plannix_push_disable_details_on_consent_withdrawal
  after update of lesson_detail_consent, event_title_consent
  on private.plannix_morning_summary_preferences
  for each row execute function private.plannix_push_disable_details_on_consent_withdrawal();

create or replace function public.plannix_authorize_morning_summary_detail(
  target_session uuid,target_hash text,target_version uuid,target_reference uuid,target_pilot uuid
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare authorized record;
declare device private.plannix_push_subscriptions%rowtype;
declare preference private.plannix_morning_summary_preferences%rowtype;
declare job private.plannix_morning_summary_jobs%rowtype;
declare year_scope record;
begin
  if target_session is null or target_hash is null or target_hash !~ '^[0-9a-f]{64}$'
    or target_version is null or target_reference is null or target_pilot is null then return null; end if;
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found or authorized.owner_id is distinct from target_pilot then return null; end if;
  select * into job from private.plannix_morning_summary_jobs as j
    where j.user_id=authorized.owner_id and j.notification_ref=target_reference for share;
  if not found then return null; end if;
  select * into preference from private.plannix_morning_summary_preferences as p
    where p.user_id=authorized.owner_id for share;
  if not found or not preference.enabled
    or not (preference.lesson_detail_consent or preference.event_title_consent)
    or preference.academic_year_id is null then return null; end if;
  if job.academic_year_id is distinct from preference.academic_year_id
    or job.preference_revision is distinct from preference.revision then return null; end if;
  select * into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash for share;
  if not found or device.user_id is distinct from authorized.owner_id
    or device.bound_session_id is distinct from target_session
    or device.installation_version is distinct from target_version
    or device.detail_disabled then return null; end if;
  perform 1 from private.plannix_morning_summary_deliveries as d
    where d.user_id=authorized.owner_id and d.london_date=job.london_date
      and d.endpoint_hash=target_hash and d.subscription_version=device.subscription_version
      and d.state in ('in_flight','accepted','uncertain') for share;
  if not found then return null; end if;
  select * into year_scope from private.plannix_morning_summary_year(authorized.owner_id,job.academic_year_id);
  if not found or job.london_date not between year_scope.year_start and year_scope.year_end
    or extract(isodow from job.london_date) not between 1 and 5
    or exists (select 1 from public.plannix_holidays as h
      where h.academic_year_id=job.academic_year_id
        and job.london_date between h.start_date and h.end_date) then return null; end if;
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found or authorized.owner_id is distinct from target_pilot then return null; end if;
  if device.detail_disabled or device.bound_session_id is distinct from target_session
    or device.installation_version is distinct from target_version then return null; end if;
  return pg_catalog.jsonb_build_object('ownerId',authorized.owner_id,
    'lessonDetailConsent',preference.lesson_detail_consent,
    'eventTitleConsent',preference.event_title_consent);
end;
$$;
revoke all on function public.plannix_authorize_morning_summary_detail(uuid,text,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_authorize_morning_summary_detail(uuid,text,uuid,uuid,uuid)
  to service_role;
