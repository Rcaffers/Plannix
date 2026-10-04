begin;

-- An old preference has no delivery year and cannot become a scheduled job.
alter table private.plannix_morning_summary_preferences
  add column academic_year_id uuid references public.plannix_academic_years(id) on delete set null;

-- The server may supply only a confirmed user's own personal academic year.
create function private.plannix_morning_summary_year(target_user uuid, target_year uuid)
returns table (organisation_id uuid, membership_id uuid, year_start date, year_end date)
language sql security definer stable set search_path = '' as $$
  select mapping.organisation_id, member.id, year.start_date, year.end_date
  from private.plannix_personal_organisations as mapping
  join public.plannix_organisations as organisation
    on organisation.id = mapping.organisation_id and organisation.organisation_type = 'personal'
  join public.plannix_organisation_users as member
    on member.organisation_id = mapping.organisation_id and member.user_id = target_user
  join public.plannix_academic_years as year
    on year.organisation_id = mapping.organisation_id and year.id = target_year
  where mapping.user_id = target_user and year.end_date > year.start_date;
$$;
revoke all on function private.plannix_morning_summary_year(uuid,uuid) from public, anon, authenticated;

create or replace function public.plannix_get_morning_summary_preferences(validated_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare preference private.plannix_morning_summary_preferences%rowtype;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  select p.* into preference from private.plannix_morning_summary_preferences as p
    where p.user_id = validated_user_id;
  return pg_catalog.jsonb_build_object(
    'enabled', coalesce(preference.enabled, false),
    'deliveryTime', coalesce(pg_catalog.left(preference.delivery_time::text, 5), '07:00'),
    'revision', coalesce(preference.revision, 0),
    'academicYearId', preference.academic_year_id
  );
end;
$$;
revoke all on function public.plannix_get_morning_summary_preferences(uuid) from public, anon, authenticated;
grant execute on function public.plannix_get_morning_summary_preferences(uuid) to service_role;

-- Retain the Stage 1 signature during a rolling deployment. It cannot assign
-- a year to a new preference, so any row it creates remains ineligible.
-- The Stage 2 server exclusively calls the five-argument overload below.
create function public.plannix_save_morning_summary_preferences(
  validated_user_id uuid, expected_revision bigint, target_enabled boolean,
  target_delivery_time text, target_academic_year_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare preference private.plannix_morning_summary_preferences%rowtype;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  if expected_revision is null or expected_revision < 0 or expected_revision >= 9007199254740991
    or target_enabled is null or target_delivery_time is null
    or target_delivery_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or target_academic_year_id is null
    or not exists (select 1 from private.plannix_morning_summary_year(validated_user_id, target_academic_year_id)) then
    raise exception using errcode = '22023', message = 'Invalid morning summary preferences.';
  end if;
  if expected_revision = 0 then
    insert into private.plannix_morning_summary_preferences
      (user_id, enabled, delivery_time, academic_year_id)
      values (validated_user_id, target_enabled, target_delivery_time::time, target_academic_year_id)
      on conflict (user_id) do nothing returning * into preference;
  else
    update private.plannix_morning_summary_preferences as p
      set enabled = target_enabled, delivery_time = target_delivery_time::time,
        academic_year_id = target_academic_year_id, revision = p.revision + 1,
        updated_at = pg_catalog.now()
      where p.user_id = validated_user_id and p.revision = expected_revision
      returning * into preference;
  end if;
  if not found then raise exception using errcode = '40001', message = 'Morning summary preferences changed.'; end if;
  return pg_catalog.jsonb_build_object('enabled', preference.enabled,
    'deliveryTime', pg_catalog.left(preference.delivery_time::text, 5),
    'revision', preference.revision, 'academicYearId', preference.academic_year_id);
end;
$$;
revoke all on function public.plannix_save_morning_summary_preferences(uuid,bigint,boolean,text,uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_save_morning_summary_preferences(uuid,bigint,boolean,text,uuid)
  to service_role;

-- One durable claim per user and London date, regardless of preference edits.
create table private.plannix_morning_summary_jobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  london_date date not null,
  preference_revision bigint not null,
  academic_year_id uuid not null references public.plannix_academic_years(id) on delete cascade,
  notification_ref uuid not null default pg_catalog.gen_random_uuid() unique,
  lease_claim_id uuid,
  lease_until timestamptz,
  completed_at timestamptz,
  primary key (user_id, london_date)
);
create table private.plannix_morning_summary_deliveries (
  user_id uuid not null,
  london_date date not null,
  endpoint_hash text not null,
  subscription_version uuid not null,
  state text not null check (state in ('in_flight','accepted','uncertain','retryable','expired','skipped')),
  attempts smallint not null default 1 check (attempts between 1 and 2),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, london_date, endpoint_hash),
  foreign key (user_id, london_date) references private.plannix_morning_summary_jobs(user_id, london_date) on delete cascade
);
create index idx_morning_summary_jobs_lease on private.plannix_morning_summary_jobs(lease_until)
  where completed_at is null;
alter table private.plannix_morning_summary_jobs enable row level security;
alter table private.plannix_morning_summary_deliveries enable row level security;
revoke all on table private.plannix_morning_summary_jobs from public, anon, authenticated;
revoke all on table private.plannix_morning_summary_deliveries from public, anon, authenticated;

-- Use London wall-clock dates. A late time may cross midnight, but never
-- silently switches the summary to the next calendar day. The repeated autumn
-- hour still maps to one user/day job; a nonexistent spring time has no window.
create function private.plannix_morning_summary_due_date(now_at timestamptz, scheduled time)
returns date language plpgsql stable set search_path = '' as $$
declare london_time timestamp := now_at at time zone 'Europe/London';
  candidate date;
begin
  if scheduled is null or now_at is null then return null; end if;
  candidate := london_time::date;
  if london_time < candidate + scheduled then candidate := candidate - 1; end if;
  if london_time >= candidate + scheduled
    and london_time < candidate + scheduled + interval '15 minutes' then
    return candidate;
  end if;
  return null;
end;
$$;
revoke all on function private.plannix_morning_summary_due_date(timestamptz,time) from public, anon, authenticated;

-- Candidate selection and claims are one transaction. Claims are short leases;
-- an expired in-flight device is *uncertain*, never automatically retried.
create function private.plannix_claim_morning_summary_jobs_at(now_instant timestamptz,max_jobs integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare candidate record; claims jsonb := '[]'::jsonb; token uuid; notification_reference uuid;
begin
  if now_instant is null or max_jobs is null or max_jobs not between 1 and 50 then
    raise exception using errcode='22023', message='Invalid job limit.';
  end if;
  for candidate in
    select p.user_id, p.revision, p.academic_year_id, due.target_date
    from private.plannix_morning_summary_preferences as p
    join auth.users as u on u.id=p.user_id and u.email_confirmed_at is not null
    cross join lateral (select private.plannix_morning_summary_due_date(now_instant,p.delivery_time) as target_date) as due
    where p.enabled and p.academic_year_id is not null
      and due.target_date between (select y.year_start from private.plannix_morning_summary_year(p.user_id,p.academic_year_id) as y)
        and (select y.year_end from private.plannix_morning_summary_year(p.user_id,p.academic_year_id) as y)
      and extract(isodow from due.target_date) between 1 and 5
      and not exists (select 1 from public.plannix_holidays as h
        where h.academic_year_id=p.academic_year_id and due.target_date between h.start_date and h.end_date)
      and exists (select 1 from private.plannix_push_subscriptions as s where s.user_id=p.user_id)
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
      claims := claims || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'userId',candidate.user_id,'date',candidate.target_date,'academicYearId',candidate.academic_year_id,
        'revision',candidate.revision,'token',token,'notificationRef',notification_reference));
      exit when pg_catalog.jsonb_array_length(claims) >= max_jobs;
    end if;
  end loop;
  return claims;
end;
$$;
revoke all on function private.plannix_claim_morning_summary_jobs_at(timestamptz,integer) from public, anon, authenticated;
create function public.plannix_claim_morning_summary_jobs(max_jobs integer)
returns jsonb language sql security definer set search_path = '' as $$
  select private.plannix_claim_morning_summary_jobs_at(pg_catalog.clock_timestamp(),max_jobs);
$$;
revoke all on function public.plannix_claim_morning_summary_jobs(integer) from public, anon, authenticated;
grant execute on function public.plannix_claim_morning_summary_jobs(integer) to service_role;

-- Returns a complete, authoritative snapshot or fails. The private week
-- resolver is also used by the dated timetable and respects closed weeks.
create function public.plannix_morning_summary_snapshot(target_user uuid, target_year uuid, target_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare scope record; timetable record; monday date; week_id uuid;
  collection_id uuid; is_override boolean; result jsonb;
begin
  perform private.plannix_confirm_push_user(target_user);
  select * into scope from private.plannix_morning_summary_year(target_user,target_year);
  if not found or target_date not between scope.year_start and scope.year_end
    or extract(isodow from target_date) not between 1 and 5
    or exists (select 1 from public.plannix_holidays as h where h.academic_year_id=target_year
      and target_date between h.start_date and h.end_date) then
    raise exception using errcode='P0002',message='Daily summary is unavailable.';
  end if;
  select t.id, t.active_from, t.active_to into timetable
    from public.plannix_timetables as t
    where t.organisation_id=scope.organisation_id and t.academic_year_id=target_year
      and t.is_default and target_date between t.active_from and t.active_to;
  if not found then raise exception using errcode='P0002',message='Daily summary is unavailable.'; end if;
  if (select pg_catalog.count(*) from public.plannix_timetables as t
      where t.organisation_id=scope.organisation_id and t.academic_year_id=target_year
        and t.is_default and target_date between t.active_from and t.active_to) <> 1 then
    raise exception using errcode='P0002',message='Daily summary is unavailable.';
  end if;
  if not exists (select 1 from public.plannix_timetable_periods as p
    where p.timetable_id=timetable.id and p.period_type='teaching' and p.is_enabled) then
    raise exception using errcode='P0002',message='Daily summary is unavailable.';
  end if;
  monday := target_date - (extract(isodow from target_date)::integer - 1);
  week_id := private.plannix_resolve_timetable_week(timetable.id,monday);
  select c.id into collection_id from public.plannix_timetable_session_collections as c
    where c.timetable_id=timetable.id and c.collection_type='date_override' and c.week_start_date=monday;
  is_override := collection_id is not null;
  if not is_override then
    select c.id into collection_id from public.plannix_timetable_session_collections as c
      where c.timetable_id=timetable.id and c.collection_type='recurring' and c.timetable_week_id=week_id;
  end if;
  if collection_id is null then raise exception using errcode='P0002',message='Daily summary is unavailable.'; end if;
  select pg_catalog.jsonb_build_object(
    'year', pg_catalog.jsonb_build_object('id',target_year,'startDate',scope.year_start,'endDate',scope.year_end),
    'date',target_date,'dated',pg_catalog.jsonb_build_object('weekStartDate',monday,
      'repeatingWeekId',week_id,'sessions',private.plannix_session_json(collection_id,not is_override)),
    'periods',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',p.id,'type',p.period_type,'enabled',p.is_enabled,'order',p.sort_order,
      'number',p.period_number,'startTime',pg_catalog.left(p.start_time::text,5),
      'endTime',pg_catalog.left(p.end_time::text,5)) order by p.sort_order,p.period_number,p.id),'[]'::jsonb)
      from public.plannix_timetable_periods as p where p.timetable_id=timetable.id),
    'weeks',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',w.id,'code',w.code)
      order by w.sort_order,w.id),'[]'::jsonb) from public.plannix_timetable_weeks as w where w.timetable_id=timetable.id),
    'classes',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',c.id,'name',c.name)
      order by c.sort_order,c.id),'[]'::jsonb) from public.plannix_classes as c
      where c.organisation_id=scope.organisation_id and c.academic_year_id=target_year),
    'events',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',e.id,'date',e.event_date,'title',e.title,'startTime',pg_catalog.left(e.start_time::text,5),
      'endTime',pg_catalog.left(e.end_time::text,5),'location',e.location)
      order by e.start_time nulls first,e.title,e.id),'[]'::jsonb)
      from private.plannix_personal_events as e where e.owner_organisation_user_id=scope.membership_id
        and e.academic_year_id=target_year and e.event_date=target_date)
  ) into result;
  return result;
end;
$$;
revoke all on function public.plannix_morning_summary_snapshot(uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.plannix_morning_summary_snapshot(uuid,uuid,date) to service_role;

-- The push carries only this opaque reference. The authenticated server must
-- resolve it for the currently confirmed user before reading the saved day.
create function public.plannix_morning_summary_notification_snapshot(target_user uuid,target_reference uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved_year uuid; saved_date date;
begin
  perform private.plannix_confirm_push_user(target_user);
  select j.academic_year_id,j.london_date into saved_year,saved_date
    from private.plannix_morning_summary_jobs as j
    where j.user_id=target_user and j.notification_ref=target_reference;
  if not found then raise exception using errcode='P0002',message='Daily summary is unavailable.'; end if;
  return public.plannix_morning_summary_snapshot(target_user,saved_year,saved_date);
end;
$$;
revoke all on function public.plannix_morning_summary_notification_snapshot(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_morning_summary_notification_snapshot(uuid,uuid) to service_role;

create function public.plannix_morning_summary_device_hashes(target_user uuid,target_date date,target_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.plannix_morning_summary_jobs as j
    where j.user_id=target_user and j.london_date=target_date and j.lease_claim_id=target_token
      and j.lease_until>pg_catalog.clock_timestamp() and j.completed_at is null) then
    return '[]'::jsonb;
  end if;
  return (select coalesce(pg_catalog.jsonb_agg(s.endpoint_hash order by s.endpoint_hash),'[]'::jsonb)
    from private.plannix_push_subscriptions as s where s.user_id=target_user);
end;
$$;
revoke all on function public.plannix_morning_summary_device_hashes(uuid,date,uuid) from public, anon, authenticated;
grant execute on function public.plannix_morning_summary_device_hashes(uuid,date,uuid) to service_role;

-- The final claim rechecks every mutable owner, preference, date and device
-- field. It returns a device only after recording an in-flight attempt.
create function private.plannix_claim_morning_summary_device_at(
  target_user uuid,target_date date,target_token uuid,target_hash text,target_revision bigint,target_year uuid
  ,now_instant timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare job private.plannix_morning_summary_jobs%rowtype;
  device private.plannix_push_subscriptions%rowtype;
  delivery private.plannix_morning_summary_deliveries%rowtype;
  preference private.plannix_morning_summary_preferences%rowtype;
  checked_at timestamptz; delivery_found boolean;
begin
  select * into job from private.plannix_morning_summary_jobs as j
    where j.user_id=target_user and j.london_date=target_date for update;
  if not found or job.lease_claim_id is distinct from target_token or job.lease_until < pg_catalog.clock_timestamp()
    or job.completed_at is not null or job.preference_revision <> target_revision
    or job.academic_year_id <> target_year then return null; end if;
  select * into preference from private.plannix_morning_summary_preferences as p
    where p.user_id=target_user for share;
  if not found then return null; end if;
  select * into device from private.plannix_push_subscriptions as s
    where s.user_id=target_user and s.endpoint_hash=target_hash for update;
  if not found then return null; end if;
  select * into delivery from private.plannix_morning_summary_deliveries as d
    where d.user_id=target_user and d.london_date=target_date and d.endpoint_hash=target_hash for update;
  delivery_found := found;
  -- Production passes NULL so the clock is read only after every row lock.
  -- The explicit time is for deterministic, transactionally isolated tests.
  checked_at := coalesce(now_instant,pg_catalog.clock_timestamp());
  if not preference.enabled or preference.revision <> target_revision
    or preference.academic_year_id <> target_year
    or not exists (select 1 from auth.users as u
      where u.id=target_user and u.email_confirmed_at is not null)
    or private.plannix_morning_summary_due_date(checked_at,preference.delivery_time) is distinct from target_date
    or extract(isodow from target_date) not between 1 and 5
    or not exists (select 1 from private.plannix_morning_summary_year(target_user,target_year) as y
      where target_date between y.year_start and y.year_end)
    or exists (select 1 from public.plannix_holidays as h
      where h.academic_year_id=target_year and target_date between h.start_date and h.end_date) then return null; end if;
  if delivery_found then
    if delivery.state <> 'retryable' or delivery.attempts >= 2
      or delivery.subscription_version <> device.subscription_version then return null; end if;
    update private.plannix_morning_summary_deliveries as d
      set state='in_flight',attempts=d.attempts+1,updated_at=pg_catalog.clock_timestamp()
      where d.user_id=target_user and d.london_date=target_date and d.endpoint_hash=target_hash;
  else
    insert into private.plannix_morning_summary_deliveries
      (user_id,london_date,endpoint_hash,subscription_version,state)
      values (target_user,target_date,target_hash,device.subscription_version,'in_flight');
  end if;
  return pg_catalog.jsonb_build_object('endpoint',device.endpoint,
    'keys',pg_catalog.jsonb_build_object('p256dh',device.p256dh,'auth',device.auth_key),
    'version',device.subscription_version);
end;
$$;
revoke all on function private.plannix_claim_morning_summary_device_at(uuid,date,uuid,text,bigint,uuid,timestamptz)
  from public, anon, authenticated;
create function public.plannix_claim_morning_summary_device(
  target_user uuid,target_date date,target_token uuid,target_hash text,target_revision bigint,target_year uuid
) returns jsonb language sql security definer set search_path = '' as $$
  select private.plannix_claim_morning_summary_device_at(target_user,target_date,target_token,
    target_hash,target_revision,target_year,null::timestamptz);
$$;
revoke all on function public.plannix_claim_morning_summary_device(uuid,date,uuid,text,bigint,uuid) from public, anon, authenticated;
grant execute on function public.plannix_claim_morning_summary_device(uuid,date,uuid,text,bigint,uuid) to service_role;

-- Recheck the exact claimed subscription and the remaining delivery window
-- after locks are acquired. This does not make a network send atomic with a
-- later account reassignment; the notification payload is therefore generic.
create function private.plannix_morning_summary_dispatch_seconds_at(
  target_user uuid,target_date date,target_token uuid,target_hash text,
  target_version uuid,target_revision bigint,target_year uuid,now_instant timestamptz,
  clock_offset interval default null
) returns integer language plpgsql security invoker set search_path = '' as $$
declare job private.plannix_morning_summary_jobs%rowtype;
  preference private.plannix_morning_summary_preferences%rowtype;
  device private.plannix_push_subscriptions%rowtype;
  delivery private.plannix_morning_summary_deliveries%rowtype;
  checked_at timestamptz; seconds_left integer;
begin
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
  -- A private test offset lets a real lock wait cross a synthetic London
  -- cutoff without changing the database clock. Production passes neither.
  checked_at := coalesce(now_instant,pg_catalog.clock_timestamp()
    + coalesce(clock_offset,interval '0 seconds'));
  if job.lease_claim_id is distinct from target_token or job.lease_until <= pg_catalog.clock_timestamp()
    or job.completed_at is not null or job.preference_revision <> target_revision
    or job.academic_year_id <> target_year
    or not preference.enabled or preference.revision <> target_revision
    or preference.academic_year_id <> target_year
    or not exists (select 1 from auth.users as u
      where u.id=target_user and u.email_confirmed_at is not null)
    or private.plannix_morning_summary_due_date(checked_at,preference.delivery_time) is distinct from target_date
    or extract(isodow from target_date) not between 1 and 5
    or not exists (select 1 from private.plannix_morning_summary_year(target_user,target_year) as y
      where target_date between y.year_start and y.year_end)
    or exists (select 1 from public.plannix_holidays as h
      where h.academic_year_id=target_year and target_date between h.start_date and h.end_date)
    or device.subscription_version <> target_version
    or delivery.subscription_version <> target_version or delivery.state <> 'in_flight' then
    return null;
  end if;
  seconds_left := pg_catalog.floor(extract(epoch from
    ((target_date + preference.delivery_time + interval '15 minutes')
      - (checked_at at time zone 'Europe/London'))))::integer;
  if seconds_left < 1 then return null; end if;
  return least(seconds_left,900);
end;
$$;
revoke all on function private.plannix_morning_summary_dispatch_seconds_at(uuid,date,uuid,text,uuid,bigint,uuid,timestamptz,interval)
  from public, anon, authenticated;
create function public.plannix_morning_summary_dispatch_seconds(
  target_user uuid,target_date date,target_token uuid,target_hash text,
  target_version uuid,target_revision bigint,target_year uuid
) returns integer language sql security definer set search_path = '' as $$
  select private.plannix_morning_summary_dispatch_seconds_at(target_user,target_date,target_token,
    target_hash,target_version,target_revision,target_year,null::timestamptz);
$$;
revoke all on function public.plannix_morning_summary_dispatch_seconds(uuid,date,uuid,text,uuid,bigint,uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_morning_summary_dispatch_seconds(uuid,date,uuid,text,uuid,bigint,uuid)
  to service_role;

create function public.plannix_finish_morning_summary_device(
  target_user uuid,target_date date,target_token uuid,target_hash text,target_version uuid,target_state text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if target_state not in ('accepted','uncertain','retryable','expired','skipped') then
    raise exception using errcode='22023',message='Invalid delivery result.';
  end if;
  update private.plannix_morning_summary_deliveries as d
    set state=target_state,updated_at=pg_catalog.clock_timestamp()
    from private.plannix_morning_summary_jobs as j
    where d.user_id=target_user and d.london_date=target_date and d.endpoint_hash=target_hash
      and d.subscription_version=target_version and d.state='in_flight'
      and j.user_id=d.user_id and j.london_date=d.london_date
      and j.lease_claim_id=target_token and j.lease_until>pg_catalog.clock_timestamp();
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;
revoke all on function public.plannix_finish_morning_summary_device(uuid,date,uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.plannix_finish_morning_summary_device(uuid,date,uuid,text,uuid,text) to service_role;

create function public.plannix_finish_morning_summary_job(target_user uuid,target_date date,target_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer; can_retry boolean;
begin
  select exists (select 1 from private.plannix_morning_summary_deliveries as d
    where d.user_id=target_user and d.london_date=target_date and d.state='retryable' and d.attempts<2)
    into can_retry;
  update private.plannix_morning_summary_jobs as j
    set completed_at=case when can_retry then null else pg_catalog.clock_timestamp() end,
      lease_until=pg_catalog.clock_timestamp()
    where j.user_id=target_user and j.london_date=target_date and j.lease_claim_id=target_token;
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;
revoke all on function public.plannix_finish_morning_summary_job(uuid,date,uuid) from public, anon, authenticated;
grant execute on function public.plannix_finish_morning_summary_job(uuid,date,uuid) to service_role;

commit;
