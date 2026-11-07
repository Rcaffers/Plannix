-- The Supabase CLI owns this migration and its history transaction.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Scheduled generic delivery now requires a currently bound ordinary session.
-- This is a read-only eligibility test. The final per-device RPC below also
-- serializes with auth settlement and registration through the browser binding.
create function private.plannix_morning_summary_has_current_bound_device(target_user uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select exists (
    select 1 from private.plannix_push_subscriptions as device
    join private.plannix_auth_sessions as session
      on session.id=device.bound_session_id and session.owner_id=device.user_id
    join private.plannix_auth_browser_bindings as binding
      on binding.id=session.binding_id and binding.current_session_id=session.id
    where device.user_id=target_user and session.kind='ordinary'
      and not session.revoked and not session.expired
      and session.expires_at>pg_catalog.clock_timestamp()
      and not binding.revoked and not binding.expired
      and binding.expires_at>pg_catalog.clock_timestamp()
  );
$$;
revoke all on function private.plannix_morning_summary_has_current_bound_device(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.plannix_claim_morning_summary_pilot_jobs_at(
  now_instant timestamptz, max_jobs integer, pilot_user uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare candidate record; claims jsonb := '[]'::jsonb; token uuid; notification_reference uuid;
begin
  if now_instant is null or pilot_user is null or max_jobs is null or max_jobs not between 1 and 50 then
    raise exception using errcode='22023', message='Invalid pilot claim.';
  end if;
  for candidate in
    select p.user_id, p.revision, p.academic_year_id, due.target_date
    from private.plannix_morning_summary_preferences as p
    join auth.users as u on u.id=p.user_id and u.email_confirmed_at is not null
    cross join lateral (select private.plannix_morning_summary_due_date(now_instant,p.delivery_time) as target_date) as due
    where p.user_id=pilot_user and p.enabled and p.academic_year_id is not null
      and due.target_date between (select y.year_start from private.plannix_morning_summary_year(p.user_id,p.academic_year_id) as y)
        and (select y.year_end from private.plannix_morning_summary_year(p.user_id,p.academic_year_id) as y)
      and extract(isodow from due.target_date) between 1 and 5
      and not exists (select 1 from public.plannix_holidays as h
        where h.academic_year_id=p.academic_year_id and due.target_date between h.start_date and h.end_date)
      and private.plannix_morning_summary_has_current_bound_device(p.user_id)
      and not exists (select 1 from private.plannix_morning_summary_jobs as existing
        where existing.user_id=p.user_id and existing.london_date=due.target_date
          and (existing.completed_at is not null
            or existing.lease_until >= pg_catalog.clock_timestamp()
            or existing.preference_revision <> p.revision
            or existing.academic_year_id <> p.academic_year_id))
    order by p.user_id limit max_jobs * 2
  loop
    token := pg_catalog.gen_random_uuid();
    insert into private.plannix_morning_summary_jobs as j
      (user_id,london_date,preference_revision,academic_year_id,lease_claim_id,lease_until)
      values (candidate.user_id,candidate.target_date,candidate.revision,candidate.academic_year_id,
        token,pg_catalog.clock_timestamp()+interval '90 seconds')
      on conflict (user_id,london_date) do update
        set lease_claim_id=excluded.lease_claim_id, lease_until=excluded.lease_until
        where j.completed_at is null and j.lease_until < pg_catalog.clock_timestamp()
          and j.preference_revision=candidate.revision and j.academic_year_id=candidate.academic_year_id
      returning j.notification_ref into notification_reference;
    if found then
      -- The unique-key wait above can outlive the session. Roll back the
      -- entire claim rather than reserve a day for an ineligible device.
      if not private.plannix_morning_summary_has_current_bound_device(candidate.user_id) then
        raise exception using errcode='P0002',message='Morning summary binding changed.';
      end if;
      claims := claims || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'userId',candidate.user_id,'date',candidate.target_date,'academicYearId',candidate.academic_year_id,
        'revision',candidate.revision,'token',token,'notificationRef',notification_reference));
      exit when pg_catalog.jsonb_array_length(claims) >= max_jobs;
    end if;
  end loop;
  return claims;
end;
$$;

-- First acquire the browser-binding lock, which auth settlement and device
-- registration acquire before touching the endpoint. The preliminary endpoint
-- read is not authority: after all locks, its session and subscription version
-- must still match the target device. Recheck the session and clock after all
-- potentially delayed row reads before returning a send allowance.
create or replace function private.plannix_morning_summary_dispatch_seconds_at(
  target_user uuid,target_date date,target_token uuid,target_hash text,
  target_version uuid,target_revision bigint,target_year uuid,now_instant timestamptz,
  clock_offset interval default null
) returns integer language plpgsql security invoker set search_path = '' as $$
declare job private.plannix_morning_summary_jobs%rowtype;
  preference private.plannix_morning_summary_preferences%rowtype;
  device private.plannix_push_subscriptions%rowtype;
  delivery private.plannix_morning_summary_deliveries%rowtype;
  candidate_session uuid; authorized record;
  checked_at timestamptz; seconds_left integer;
begin
  select s.bound_session_id into candidate_session from private.plannix_push_subscriptions as s
    where s.endpoint_hash=target_hash and s.user_id=target_user;
  if candidate_session is null then return null; end if;
  select * into authorized from private.plannix_push_current_session(candidate_session);
  if not found or authorized.owner_id is distinct from target_user then return null; end if;

  select * into job from private.plannix_morning_summary_jobs as j
    where j.user_id=target_user and j.london_date=target_date for update;
  if not found then return null; end if;
  select * into preference from private.plannix_morning_summary_preferences as p
    where p.user_id=target_user for share;
  if not found then return null; end if;
  select * into device from private.plannix_push_subscriptions as s
    where s.user_id=target_user and s.endpoint_hash=target_hash for share;
  if not found then return null; end if;
  select * into delivery from private.plannix_morning_summary_deliveries as d
    where d.user_id=target_user and d.london_date=target_date
      and d.endpoint_hash=target_hash for update;
  if not found then return null; end if;

  if job.lease_claim_id is distinct from target_token or job.completed_at is not null
    or job.preference_revision <> target_revision or job.academic_year_id <> target_year
    or not preference.enabled or preference.revision <> target_revision
    or preference.academic_year_id <> target_year
    or not exists (select 1 from auth.users as u
      where u.id=target_user and u.email_confirmed_at is not null)
    or extract(isodow from target_date) not between 1 and 5
    or not exists (select 1 from private.plannix_morning_summary_year(target_user,target_year) as y
      where target_date between y.year_start and y.year_end)
    or exists (select 1 from public.plannix_holidays as h
      where h.academic_year_id=target_year and target_date between h.start_date and h.end_date)
    or device.bound_session_id is distinct from candidate_session
    or device.subscription_version <> target_version
    or delivery.subscription_version <> target_version or delivery.state <> 'in_flight' then
    return null;
  end if;

  -- The year/school-day queries above may have waited. The binding is already
  -- locked by this transaction, and this second check observes wall-clock
  -- expiry even if no concurrent transaction could replace the session.
  select * into authorized from private.plannix_push_current_session(candidate_session);
  if not found or authorized.owner_id is distinct from target_user then return null; end if;
  checked_at := coalesce(now_instant,pg_catalog.clock_timestamp()
    + coalesce(clock_offset,interval '0 seconds'));
  if job.lease_until <= pg_catalog.clock_timestamp()
    or private.plannix_morning_summary_due_date(checked_at,preference.delivery_time) is distinct from target_date then
    return null;
  end if;
  seconds_left := pg_catalog.floor(extract(epoch from
    ((target_date + preference.delivery_time + interval '15 minutes')
      - (checked_at at time zone 'Europe/London'))))::integer;
  if seconds_left < 1 then return null; end if;
  return least(seconds_left,900);
end;
$$;
