-- The pinned Supabase CLI owns this migration and its history transaction.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Consent is separate from delivery opt-in. Existing rows remain opted out.
alter table private.plannix_morning_summary_preferences
  add column lesson_detail_consent boolean not null default false,
  add column event_title_consent boolean not null default false;

-- A new signature leaves the existing API/RPC contract intact for old clients.
create function public.plannix_get_morning_summary_detail_preferences(validated_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare preference private.plannix_morning_summary_preferences%rowtype;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  select p.* into preference from private.plannix_morning_summary_preferences as p
    where p.user_id = validated_user_id;
  return pg_catalog.jsonb_build_object(
    'enabled',coalesce(preference.enabled,false),
    'deliveryTime',coalesce(pg_catalog.left(preference.delivery_time::text,5),'07:00'),
    'revision',coalesce(preference.revision,0),
    'academicYearId',preference.academic_year_id,
    'lessonDetailConsent',coalesce(preference.lesson_detail_consent,false),
    'eventTitleConsent',coalesce(preference.event_title_consent,false));
end;
$$;
revoke all on function public.plannix_get_morning_summary_detail_preferences(uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_get_morning_summary_detail_preferences(uuid) to service_role;

create function public.plannix_save_morning_summary_detail_preferences(
  validated_user_id uuid, expected_revision bigint, target_enabled boolean,
  target_delivery_time text, target_academic_year_id uuid,
  target_lesson_detail_consent boolean, target_event_title_consent boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare preference private.plannix_morning_summary_preferences%rowtype;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  if expected_revision is null or expected_revision < 0 or expected_revision >= 9007199254740991
    or target_enabled is null or target_delivery_time is null
    or target_lesson_detail_consent is null or target_event_title_consent is null
    or target_delivery_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or target_academic_year_id is null
    or not exists (select 1 from private.plannix_morning_summary_year(validated_user_id,target_academic_year_id)) then
    raise exception using errcode='22023',message='Invalid morning summary preferences.';
  end if;
  if expected_revision=0 then
    insert into private.plannix_morning_summary_preferences
      (user_id,enabled,delivery_time,academic_year_id,lesson_detail_consent,event_title_consent)
    values (validated_user_id,target_enabled,target_delivery_time::time,target_academic_year_id,
      target_lesson_detail_consent,target_event_title_consent)
    on conflict (user_id) do nothing returning * into preference;
  else
    update private.plannix_morning_summary_preferences as p
      set enabled=target_enabled,delivery_time=target_delivery_time::time,
        academic_year_id=target_academic_year_id,
        lesson_detail_consent=target_lesson_detail_consent,
        event_title_consent=target_event_title_consent,
        revision=p.revision+1,updated_at=pg_catalog.clock_timestamp()
      where p.user_id=validated_user_id and p.revision=expected_revision
      returning * into preference;
  end if;
  if not found then raise exception using errcode='40001',message='Morning summary preferences changed.'; end if;
  return pg_catalog.jsonb_build_object('enabled',preference.enabled,
    'deliveryTime',pg_catalog.left(preference.delivery_time::text,5),
    'revision',preference.revision,'academicYearId',preference.academic_year_id,
    'lessonDetailConsent',preference.lesson_detail_consent,
    'eventTitleConsent',preference.event_title_consent);
end;
$$;
revoke all on function public.plannix_save_morning_summary_detail_preferences(uuid,bigint,boolean,text,uuid,boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.plannix_save_morning_summary_detail_preferences(uuid,bigint,boolean,text,uuid,boolean,boolean)
  to service_role;

-- Selectors from a client are never authority. Only the verified server session
-- supplies target_session; the pilot is read from trusted server configuration.
-- No production path currently clears detail_disabled, so this remains dormant.
create function public.plannix_authorize_morning_summary_detail(
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
  -- Match dispatch's job -> preference -> endpoint -> delivery lock order.
  -- The browser binding was locked by current_session above, matching
  -- installation registration and auth settlement.
  select * into job from private.plannix_morning_summary_jobs as j
    where j.user_id=authorized.owner_id and j.notification_ref=target_reference for share;
  if not found then return null; end if;
  select * into preference from private.plannix_morning_summary_preferences as p
    where p.user_id=authorized.owner_id for share;
  if not found or not preference.enabled or not preference.lesson_detail_consent
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
  -- The row read above may wait. Recheck the auth and wall-clock deadline
  -- immediately before returning eligibility; the HTTP caller checks again
  -- after resolving the potentially delayed timetable snapshot.
  select * into authorized from private.plannix_push_current_session(target_session);
  if not found or authorized.owner_id is distinct from target_pilot then return null; end if;
  if device.detail_disabled or device.bound_session_id is distinct from target_session
    or device.installation_version is distinct from target_version then return null; end if;
  return pg_catalog.jsonb_build_object('ownerId',authorized.owner_id,
    'eventTitleConsent',preference.event_title_consent);
end;
$$;
revoke all on function public.plannix_authorize_morning_summary_detail(uuid,text,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_authorize_morning_summary_detail(uuid,text,uuid,uuid,uuid)
  to service_role;
