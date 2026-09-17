alter table public.plannix_timetables
add column sessions_revision bigint not null default 0;

alter table public.plannix_timetables
add constraint chk_plannix_timetables_sessions_revision
check (sessions_revision >= 0),
add constraint uq_plannix_timetables_id_org_year
unique (id, organisation_id, academic_year_id);

create table public.plannix_timetable_session_collections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  academic_year_id uuid not null,
  timetable_id uuid not null,
  collection_type text not null,
  timetable_week_id uuid not null,
  week_start_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_session_collections_timetable
    foreign key (timetable_id, organisation_id, academic_year_id)
    references public.plannix_timetables(id, organisation_id, academic_year_id)
    on delete cascade,
  constraint fk_plannix_session_collections_week
    foreign key (timetable_week_id, timetable_id)
    references public.plannix_timetable_weeks(id, timetable_id)
    on delete restrict,
  constraint chk_plannix_session_collections_type
    check (collection_type in ('recurring', 'date_override')),
  constraint chk_plannix_session_collections_shape
    check (
      (collection_type = 'recurring' and week_start_date is null)
      or
      (collection_type = 'date_override' and week_start_date is not null)
    ),
  constraint chk_plannix_session_collections_monday
    check (week_start_date is null or extract(isodow from week_start_date) = 1),
  constraint uq_plannix_session_collections_id_scope
    unique (id, timetable_id, organisation_id, academic_year_id)
);

create unique index uq_plannix_session_collections_recurring
on public.plannix_timetable_session_collections (timetable_id, timetable_week_id)
where collection_type = 'recurring';

create unique index uq_plannix_session_collections_date
on public.plannix_timetable_session_collections (timetable_id, week_start_date)
where collection_type = 'date_override';

create trigger trg_plannix_timetable_session_collections_updated_at
before update on public.plannix_timetable_session_collections
for each row execute function public.plannix_set_updated_at();

do $$
begin
  if exists (
    select 1
    from public.plannix_timetable_sessions as timetable_session
    join public.plannix_timetable_weeks as timetable_week
      on timetable_week.id = timetable_session.timetable_week_id
     and timetable_week.timetable_id = timetable_session.timetable_id
    where timetable_session.day_number not between 1 and 5
       or timetable_week.code not in ('A', 'B')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Existing timetable sessions cannot be assigned unambiguously to Week A or Week B.';
  end if;
end;
$$;

insert into public.plannix_timetable_session_collections (
  organisation_id, academic_year_id, timetable_id,
  collection_type, timetable_week_id, week_start_date
)
select distinct
  timetable_session.organisation_id,
  timetable_session.academic_year_id,
  timetable_session.timetable_id,
  'recurring',
  timetable_session.timetable_week_id,
  null::date
from public.plannix_timetable_sessions as timetable_session
order by timetable_session.timetable_id, timetable_session.timetable_week_id;

alter table public.plannix_timetable_sessions
add column collection_id uuid;

update public.plannix_timetable_sessions as timetable_session
set collection_id = session_collection.id
from public.plannix_timetable_session_collections as session_collection
where session_collection.collection_type = 'recurring'
  and session_collection.timetable_id = timetable_session.timetable_id
  and session_collection.timetable_week_id = timetable_session.timetable_week_id;

do $$
begin
  if exists (
    select 1 from public.plannix_timetable_sessions where collection_id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Existing timetable sessions could not be assigned to recurring collections.';
  end if;
end;
$$;

alter table public.plannix_timetable_sessions
drop constraint uq_plannix_timetable_session_slot,
alter column collection_id set not null,
drop constraint chk_plannix_timetable_sessions_day;

alter table public.plannix_timetable_sessions
add constraint fk_plannix_timetable_sessions_collection
foreign key (collection_id, timetable_id, organisation_id, academic_year_id)
references public.plannix_timetable_session_collections(
  id, timetable_id, organisation_id, academic_year_id
)
on delete cascade,
add constraint chk_plannix_timetable_sessions_day
check (day_number between 1 and 5),
add constraint chk_plannix_timetable_sessions_title
check (title is null or length(title) <= 200),
add constraint chk_plannix_timetable_sessions_notes
check (notes is null or length(notes) <= 5000),
add constraint uq_plannix_timetable_session_slot
unique (collection_id, day_number, period_id);

create index idx_plannix_session_collections_timetable
on public.plannix_timetable_session_collections(timetable_id);

create index idx_plannix_timetable_sessions_collection
on public.plannix_timetable_sessions(collection_id);

alter table public.plannix_timetable_session_collections enable row level security;

grant select, insert, update, delete
on public.plannix_timetable_session_collections
to authenticated;

create policy "Staff roles can view timetable session collections"
on public.plannix_timetable_session_collections
for select to authenticated
using (
  (select private.plannix_has_access_role(organisation_id, 'Organisation Admin'))
  or (select private.plannix_has_access_role(organisation_id, 'Staff'))
  or (select private.plannix_has_access_role(organisation_id, 'Read Only'))
);

create policy "Students can view timetable session collections"
on public.plannix_timetable_session_collections
for select to authenticated
using (
  (select private.plannix_has_access_role(organisation_id, 'Student'))
  and exists (
    select 1
    from public.plannix_timetable_sessions as timetable_session
    where timetable_session.collection_id = plannix_timetable_session_collections.id
      and (select private.plannix_student_is_in_class(
        timetable_session.class_id,
        plannix_timetable_session_collections.organisation_id
      ))
  )
);

create policy "Organisation admins can create timetable session collections"
on public.plannix_timetable_session_collections
for insert to authenticated
with check ((select private.plannix_is_organisation_admin(organisation_id)));

create policy "Organisation admins can update timetable session collections"
on public.plannix_timetable_session_collections
for update to authenticated
using ((select private.plannix_is_organisation_admin(organisation_id)))
with check ((select private.plannix_is_organisation_admin(organisation_id)));

create policy "Organisation admins can delete timetable session collections"
on public.plannix_timetable_session_collections
for delete to authenticated
using ((select private.plannix_is_organisation_admin(organisation_id)));

create or replace function private.plannix_resolve_timetable_week(
  target_timetable_id uuid,
  target_week_start_date date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  timetable_record record;
  first_calendar_monday date;
  first_teaching_monday date;
  teaching_week_count integer;
  desired_code text;
  resolved_week_id uuid;
begin
  select timetable.academic_year_id, timetable.cadence,
         academic_year.start_date, academic_year.end_date,
         timetable.active_from, timetable.active_to
  into timetable_record
  from public.plannix_timetables as timetable
  join public.plannix_academic_years as academic_year
    on academic_year.id = timetable.academic_year_id
   and academic_year.organisation_id = timetable.organisation_id
  where timetable.id = target_timetable_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Timetable was not found.';
  end if;
  if target_week_start_date is null
     or extract(isodow from target_week_start_date) <> 1
     or target_week_start_date + 4 < greatest(timetable_record.start_date, timetable_record.active_from)
     or target_week_start_date > least(timetable_record.end_date, timetable_record.active_to) then
    raise exception using errcode = '22023', message = 'Week start date is outside the timetable.';
  end if;

  first_calendar_monday := timetable_record.start_date
    - (extract(isodow from timetable_record.start_date)::integer - 1);

  select candidate.week_monday
  into first_teaching_monday
  from pg_catalog.generate_series(
    first_calendar_monday,
    timetable_record.end_date,
    interval '7 days'
  ) as candidate_series(candidate_timestamp)
  cross join lateral (
    select candidate_series.candidate_timestamp::date as week_monday
  ) as candidate
  where exists (
    select 1
    from pg_catalog.generate_series(0, 4) as day_offset(day_number)
    where candidate.week_monday + day_offset.day_number between timetable_record.start_date and timetable_record.end_date
      and not exists (
        select 1
        from public.plannix_holidays as holiday
        where holiday.academic_year_id = timetable_record.academic_year_id
          and candidate.week_monday + day_offset.day_number between holiday.start_date and holiday.end_date
      )
  )
  order by candidate.week_monday
  limit 1;

  if first_teaching_monday is null or target_week_start_date < first_teaching_monday then
    raise exception using errcode = '22023', message = 'Week start date precedes the first teaching week.';
  end if;

  select count(*)::integer
  into teaching_week_count
  from pg_catalog.generate_series(
    first_teaching_monday,
    target_week_start_date,
    interval '7 days'
  ) as candidate_series(candidate_timestamp)
  cross join lateral (
    select candidate_series.candidate_timestamp::date as week_monday
  ) as candidate
  where exists (
    select 1
    from pg_catalog.generate_series(0, 4) as day_offset(day_number)
    where candidate.week_monday + day_offset.day_number between timetable_record.start_date and timetable_record.end_date
      and not exists (
        select 1
        from public.plannix_holidays as holiday
        where holiday.academic_year_id = timetable_record.academic_year_id
          and candidate.week_monday + day_offset.day_number between holiday.start_date and holiday.end_date
      )
  );

  desired_code := case
    when timetable_record.cadence = 'one-week' then 'A'
    when mod(teaching_week_count - 1, 2) = 0 then 'A'
    else 'B'
  end;

  select timetable_week.id into resolved_week_id
  from public.plannix_timetable_weeks as timetable_week
  where timetable_week.timetable_id = target_timetable_id
    and timetable_week.code = desired_code;

  if resolved_week_id is null then
    raise exception using errcode = 'P0002', message = 'Required timetable week was not found.';
  end if;
  return resolved_week_id;
end;
$$;

revoke all on function private.plannix_resolve_timetable_week(uuid, date) from public, anon;
grant execute on function private.plannix_resolve_timetable_week(uuid, date) to authenticated;

create or replace function private.plannix_validate_session_collection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  timetable_start date;
  timetable_end date;
  required_week_id uuid;
begin
  select greatest(timetable.active_from, academic_year.start_date),
         least(timetable.active_to, academic_year.end_date)
  into timetable_start, timetable_end
  from public.plannix_timetables as timetable
  join public.plannix_academic_years as academic_year
    on academic_year.id = timetable.academic_year_id
   and academic_year.organisation_id = timetable.organisation_id
  where timetable.id = new.timetable_id
    and timetable.organisation_id = new.organisation_id
    and timetable.academic_year_id = new.academic_year_id;
  if not found then
    raise exception using errcode='23503', message='Session collection timetable scope is invalid.';
  end if;
  if new.collection_type = 'date_override' then
    if new.week_start_date + 4 < timetable_start or new.week_start_date > timetable_end then
      raise exception using errcode='23514', message='Session override week is outside the timetable.';
    end if;
    required_week_id := private.plannix_resolve_timetable_week(new.timetable_id,new.week_start_date);
    if new.timetable_week_id <> required_week_id then
      raise exception using errcode='23514', message='Session override repeating week is invalid.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.plannix_validate_session_collection() from public,anon;
grant execute on function private.plannix_validate_session_collection() to authenticated;

create trigger trg_plannix_validate_session_collection
before insert or update on public.plannix_timetable_session_collections
for each row execute function private.plannix_validate_session_collection();

create or replace function private.plannix_assign_session_collection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  collection_week_id uuid;
begin
  if new.collection_id is null then
    insert into public.plannix_timetable_session_collections (
      organisation_id,
      academic_year_id,
      timetable_id,
      collection_type,
      timetable_week_id
    ) values (
      new.organisation_id,
      new.academic_year_id,
      new.timetable_id,
      'recurring',
      new.timetable_week_id
    )
    on conflict (timetable_id, timetable_week_id)
      where collection_type = 'recurring'
    do update set timetable_week_id = excluded.timetable_week_id
    returning id into new.collection_id;
  end if;

  select session_collection.timetable_week_id
  into collection_week_id
  from public.plannix_timetable_session_collections as session_collection
  where session_collection.id = new.collection_id
    and session_collection.timetable_id = new.timetable_id
    and session_collection.organisation_id = new.organisation_id
    and session_collection.academic_year_id = new.academic_year_id;

  if collection_week_id is null or collection_week_id <> new.timetable_week_id then
    raise exception using
      errcode = '23514',
      message = 'Timetable session collection and week do not match.';
  end if;
  return new;
end;
$$;

revoke all on function private.plannix_assign_session_collection() from public, anon;
grant execute on function private.plannix_assign_session_collection() to authenticated;

create trigger trg_plannix_assign_session_collection
before insert or update of collection_id, timetable_week_id, timetable_id,
  organisation_id, academic_year_id
on public.plannix_timetable_sessions
for each row execute function private.plannix_assign_session_collection();

create or replace function private.plannix_session_json(
  target_collection_id uuid,
  inherited boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
stable
as $$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'id', case when inherited then null else timetable_session.id end,
        'day', timetable_session.day_number - 1,
        'periodId', timetable_session.period_id,
        'classId', timetable_session.class_id,
        'title', case when inherited then '' else coalesce(timetable_session.title, '') end,
        'notes', case when inherited then '' else coalesce(timetable_session.notes, '') end
      )) order by timetable_session.day_number, timetable_period.sort_order, timetable_session.id
    ),
    '[]'::jsonb
  )
  from public.plannix_timetable_sessions as timetable_session
  join public.plannix_timetable_periods as timetable_period
    on timetable_period.id = timetable_session.period_id
  where timetable_session.collection_id = target_collection_id;
$$;

revoke all on function private.plannix_session_json(uuid, boolean) from public, anon;
grant execute on function private.plannix_session_json(uuid, boolean) to authenticated;

create or replace function public.plannix_get_recurring_timetable_sessions(
  target_organisation_id uuid,
  target_academic_year_id uuid,
  target_timetable_id uuid
)
returns table (revision bigint, weeks jsonb)
language plpgsql
security invoker
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if not (select private.plannix_is_confirmed_user()) then raise exception using errcode='42501',message='Email confirmation is required.'; end if;
  return query select timetable.sessions_revision,
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'weekId', timetable_week.id,
      'code', timetable_week.code,
      'collectionId', session_collection.id,
      'sessions', case when session_collection.id is null then '[]'::jsonb
        else private.plannix_session_json(session_collection.id, false) end
    ) order by timetable_week.sort_order, timetable_week.id), '[]'::jsonb)
  from public.plannix_timetables as timetable
  join public.plannix_timetable_weeks as timetable_week
    on timetable_week.timetable_id = timetable.id
   and timetable_week.code in ('A', 'B')
  left join public.plannix_timetable_session_collections as session_collection
    on session_collection.timetable_id = timetable.id
   and session_collection.timetable_week_id = timetable_week.id
   and session_collection.collection_type = 'recurring'
  where timetable.id = target_timetable_id
    and timetable.organisation_id = target_organisation_id
    and timetable.academic_year_id = target_academic_year_id
  group by timetable.id, timetable.sessions_revision;
end;
$$;

create or replace function public.plannix_get_dated_timetable_sessions(
  target_organisation_id uuid,
  target_academic_year_id uuid,
  target_timetable_id uuid,
  target_week_start_date date
)
returns table (
  revision bigint,
  week_start_date date,
  repeating_week_id uuid,
  source text,
  override_exists boolean,
  collection_id uuid,
  sessions jsonb
)
language plpgsql
security invoker
set search_path = ''
stable
as $$
declare
  derived_week_id uuid;
  dated_collection_id uuid;
  recurring_collection_id uuid;
  current_revision bigint;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if not (select private.plannix_is_confirmed_user()) then raise exception using errcode='42501',message='Email confirmation is required.'; end if;
  select timetable.sessions_revision into current_revision
  from public.plannix_timetables as timetable
  where timetable.id = target_timetable_id
    and timetable.organisation_id = target_organisation_id
    and timetable.academic_year_id = target_academic_year_id;
  if not found then return; end if;

  derived_week_id := private.plannix_resolve_timetable_week(target_timetable_id, target_week_start_date);
  select session_collection.id into dated_collection_id
  from public.plannix_timetable_session_collections as session_collection
  where session_collection.timetable_id = target_timetable_id
    and session_collection.collection_type = 'date_override'
    and session_collection.week_start_date = target_week_start_date;

  if dated_collection_id is not null then
    return query select current_revision, target_week_start_date, derived_week_id,
      'override'::text, true, dated_collection_id,
      private.plannix_session_json(dated_collection_id, false);
  else
    select session_collection.id into recurring_collection_id
    from public.plannix_timetable_session_collections as session_collection
    where session_collection.timetable_id = target_timetable_id
      and session_collection.collection_type = 'recurring'
      and session_collection.timetable_week_id = derived_week_id;
    return query select current_revision, target_week_start_date, derived_week_id,
      'recurring'::text, false, null::uuid,
      case when recurring_collection_id is null then '[]'::jsonb
        else private.plannix_session_json(recurring_collection_id, true) end;
  end if;
end;
$$;

create or replace function private.plannix_reconcile_session_collection(
  target_organisation_id uuid,
  target_academic_year_id uuid,
  target_timetable_id uuid,
  target_collection_id uuid,
  target_sessions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  session_entry jsonb;
  supplied_session_id uuid;
  saved_session_id uuid;
  session_day integer;
  session_period_id uuid;
  session_class_id uuid;
  session_title text;
  session_notes text;
  intended_ids uuid[] := array[]::uuid[];
  intended_slots text[] := array[]::text[];
begin
  if target_sessions is null or pg_catalog.jsonb_typeof(target_sessions) <> 'array'
     or pg_catalog.jsonb_array_length(target_sessions) > 60 then
    raise exception using errcode = '22023', message = 'Sessions must be an array containing no more than 60 entries.';
  end if;
  for session_entry in select value from pg_catalog.jsonb_array_elements(target_sessions)
  loop
    if pg_catalog.jsonb_typeof(session_entry) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(session_entry) as key(name)
         where key.name not in ('id', 'day', 'periodId', 'classId', 'title', 'notes'))
       or not (session_entry ?& array['day', 'periodId', 'classId', 'title', 'notes']) then
      raise exception using errcode = '22023', message = 'A timetable session contains invalid fields.';
    end if;
    begin
      supplied_session_id := case when session_entry ? 'id' then (session_entry ->> 'id')::uuid else null end;
      session_day := (session_entry ->> 'day')::integer + 1;
      session_period_id := (session_entry ->> 'periodId')::uuid;
      session_class_id := (session_entry ->> 'classId')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'Session identifiers and day numbers are invalid.';
    end;
    if pg_catalog.jsonb_typeof(session_entry -> 'day') <> 'number'
       or (session_entry ->> 'day') !~ '^[0-4]$' then
      raise exception using errcode = '22023', message = 'Session day must be an integer from 0 to 4.';
    end if;
    session_title := pg_catalog.btrim(session_entry ->> 'title');
    session_notes := pg_catalog.btrim(session_entry ->> 'notes');
    if pg_catalog.jsonb_typeof(session_entry -> 'title') <> 'string'
       or pg_catalog.jsonb_typeof(session_entry -> 'notes') <> 'string'
       or pg_catalog.length(session_title) > 200 or pg_catalog.length(session_notes) > 5000 then
      raise exception using errcode = '22023', message = 'Session title or notes are too long.';
    end if;
    if (session_entry ->> 'day') || ':' || session_period_id::text = any(intended_slots) then
      raise exception using errcode = '22023', message = 'Timetable session slots must be unique.';
    end if;
    if supplied_session_id is not null and not exists (
      select 1 from public.plannix_timetable_sessions as existing_session
      where existing_session.id = supplied_session_id
        and existing_session.collection_id = target_collection_id
    ) then
      raise exception using errcode = '42501', message = 'A session ID belongs to another collection.';
    end if;
    if supplied_session_id is null then
      select existing_session.id
      into saved_session_id
      from public.plannix_timetable_sessions as existing_session
      where existing_session.collection_id = target_collection_id
        and existing_session.day_number = session_day
        and existing_session.period_id = session_period_id;
    else
      saved_session_id := supplied_session_id;
    end if;
    saved_session_id := coalesce(saved_session_id, gen_random_uuid());
    if saved_session_id = any(intended_ids) then
      raise exception using errcode = '22023', message = 'Session IDs must be unique.';
    end if;
    if exists (
      select 1 from public.plannix_timetable_periods as timetable_period
      where timetable_period.id = session_period_id
        and timetable_period.timetable_id = target_timetable_id
        and (timetable_period.period_type <> 'teaching' or not timetable_period.is_enabled)
    ) or not exists (
      select 1 from public.plannix_timetable_periods as timetable_period
      where timetable_period.id = session_period_id
        and timetable_period.timetable_id = target_timetable_id
        and timetable_period.period_type = 'teaching'
        and timetable_period.is_enabled
    ) then
      raise exception using errcode = '22023', message = 'Session period must be an enabled teaching period.';
    end if;
    if not exists (
      select 1 from public.plannix_classes as class_entry
      where class_entry.id = session_class_id
        and class_entry.organisation_id = target_organisation_id
        and class_entry.academic_year_id = target_academic_year_id
    ) then
      raise exception using errcode = '22023', message = 'Session class is unavailable for this academic year.';
    end if;
    insert into public.plannix_timetable_sessions (
      id, collection_id, timetable_id, timetable_week_id, class_id, period_id,
      academic_year_id, organisation_id, day_number, title, notes
    ) values (
      saved_session_id, target_collection_id, target_timetable_id,
      (
        select session_collection.timetable_week_id
        from public.plannix_timetable_session_collections as session_collection
        where session_collection.id = target_collection_id
      ),
      session_class_id, session_period_id, target_academic_year_id,
      target_organisation_id, session_day, nullif(session_title, ''), nullif(session_notes, '')
    ) on conflict (id) do update set
      timetable_week_id = excluded.timetable_week_id,
      class_id = excluded.class_id,
      period_id = excluded.period_id,
      day_number = excluded.day_number,
      title = excluded.title,
      notes = excluded.notes
    where plannix_timetable_sessions.collection_id = target_collection_id;
    intended_ids := pg_catalog.array_append(intended_ids, saved_session_id);
    intended_slots := pg_catalog.array_append(
      intended_slots,
      (session_entry ->> 'day') || ':' || session_period_id::text
    );
  end loop;
  delete from public.plannix_timetable_sessions as omitted_session
  where omitted_session.collection_id = target_collection_id
    and not (omitted_session.id = any(intended_ids));
  return private.plannix_session_json(target_collection_id, false);
end;
$$;

revoke all on function private.plannix_reconcile_session_collection(uuid, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function private.plannix_reconcile_session_collection(uuid, uuid, uuid, uuid, jsonb) to authenticated;

create or replace function public.plannix_apply_timetable_session_batch(
  target_organisation_id uuid,
  target_academic_year_id uuid,
  target_timetable_id uuid,
  expected_revision bigint,
  target_mutations jsonb
)
returns table (revision bigint, collections jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_user_id uuid;
  current_revision bigint;
  mutation_entry jsonb;
  mutation_type text;
  mutation_week_id uuid;
  mutation_date date;
  derived_week_id uuid;
  saved_collection_id uuid;
  mutation_sessions jsonb;
  result_collections jsonb := '[]'::jsonb;
  intended_collection_keys text[] := array[]::text[];
  mutation_collection_key text;
begin
  caller_user_id := auth.uid();
  if caller_user_id is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if not (select private.plannix_is_confirmed_user()) then raise exception using errcode='42501', message='Email confirmation is required.'; end if;
  if target_organisation_id is null or not (select private.plannix_is_organisation_admin(target_organisation_id)) then
    raise exception using errcode='42501', message='Organisation Admin access is required.';
  end if;
  if expected_revision is null or expected_revision < 0 then raise exception using errcode='22023', message='Expected revision must be nonnegative.'; end if;
  if target_mutations is null or pg_catalog.jsonb_typeof(target_mutations) <> 'array'
     or pg_catalog.jsonb_array_length(target_mutations) < 1
     or pg_catalog.jsonb_array_length(target_mutations) > 20 then
    raise exception using errcode='22023', message='Mutations must contain from 1 to 20 collection replacements.';
  end if;
  select timetable.sessions_revision into current_revision
  from public.plannix_timetables as timetable
  where timetable.id=target_timetable_id and timetable.organisation_id=target_organisation_id
    and timetable.academic_year_id=target_academic_year_id
  for update;
  if not found then raise exception using errcode='P0002', message='Timetable was not found.'; end if;
  if current_revision <> expected_revision then raise exception using errcode='40001', message='TIMETABLE_SESSIONS_REVISION_CONFLICT'; end if;

  for mutation_entry in select value from pg_catalog.jsonb_array_elements(target_mutations)
  loop
    if pg_catalog.jsonb_typeof(mutation_entry) <> 'object'
       or exists (select 1 from pg_catalog.jsonb_object_keys(mutation_entry) as key(name)
          where key.name not in ('type','weekId','weekStartDate','sessions'))
       or not (mutation_entry ?& array['type','sessions']) then
      raise exception using errcode='22023', message='A session mutation contains invalid fields.';
    end if;
    mutation_type := mutation_entry ->> 'type';
    mutation_sessions := mutation_entry -> 'sessions';
    if mutation_type = 'recurring' then
      if not (mutation_entry ? 'weekId') or mutation_entry ? 'weekStartDate' then
        raise exception using errcode='22023', message='Recurring mutations require only a week ID.';
      end if;
      begin mutation_week_id := (mutation_entry ->> 'weekId')::uuid;
      exception when others then raise exception using errcode='22023', message='Recurring week ID is invalid.'; end;
      if not exists (select 1 from public.plannix_timetable_weeks as timetable_week
        where timetable_week.id=mutation_week_id and timetable_week.timetable_id=target_timetable_id
          and timetable_week.code in ('A','B')) then
        raise exception using errcode='42501', message='Recurring week belongs to another timetable.';
      end if;
      mutation_collection_key := 'recurring:' || mutation_week_id::text;
      insert into public.plannix_timetable_session_collections (
        organisation_id, academic_year_id, timetable_id, collection_type, timetable_week_id
      ) values (target_organisation_id,target_academic_year_id,target_timetable_id,'recurring',mutation_week_id)
      on conflict (timetable_id,timetable_week_id) where collection_type='recurring'
      do update set timetable_week_id=excluded.timetable_week_id
      returning id into saved_collection_id;
    elsif mutation_type = 'date_override' then
      if not (mutation_entry ? 'weekStartDate') or mutation_entry ? 'weekId' then
        raise exception using errcode='22023', message='Dated mutations require only a week start date.';
      end if;
      begin mutation_date := (mutation_entry ->> 'weekStartDate')::date;
      exception when others then raise exception using errcode='22023', message='Week start date is invalid.'; end;
      derived_week_id := private.plannix_resolve_timetable_week(target_timetable_id,mutation_date);
      mutation_collection_key := 'date_override:' || mutation_date::text;
      insert into public.plannix_timetable_session_collections (
        organisation_id,academic_year_id,timetable_id,collection_type,timetable_week_id,week_start_date
      ) values (target_organisation_id,target_academic_year_id,target_timetable_id,'date_override',derived_week_id,mutation_date)
      on conflict (timetable_id,week_start_date) where collection_type='date_override'
      do update set timetable_week_id=excluded.timetable_week_id
      returning id into saved_collection_id;
    else
      raise exception using errcode='22023', message='Session mutation type is invalid.';
    end if;
    if mutation_collection_key = any(intended_collection_keys) then
      raise exception using errcode='22023', message='Session mutation targets must be unique.';
    end if;
    intended_collection_keys := pg_catalog.array_append(
      intended_collection_keys,
      mutation_collection_key
    );
    result_collections := result_collections || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'type',mutation_type,'collectionId',saved_collection_id,
      'weekId',coalesce(mutation_week_id,derived_week_id),
      'weekStartDate',mutation_date,
      'sessions',private.plannix_reconcile_session_collection(
        target_organisation_id,target_academic_year_id,target_timetable_id,saved_collection_id,mutation_sessions
      )
    ));
    mutation_week_id := null; mutation_date := null; derived_week_id := null;
    mutation_collection_key := null;
  end loop;

  if exists (
    select 1
    from public.plannix_timetable_sessions as timetable_session
    join public.plannix_timetable_session_collections as session_collection
      on session_collection.id=timetable_session.collection_id
    join public.plannix_classes as class_entry on class_entry.id=timetable_session.class_id
    where session_collection.timetable_id=target_timetable_id
      and session_collection.collection_type='recurring'
    group by timetable_session.class_id,class_entry.frequency
    having count(*) > class_entry.frequency
  ) then
    raise exception using errcode='23514', message='TIMETABLE_CLASS_FREQUENCY_EXCEEDED';
  end if;

  update public.plannix_timetables as timetable set sessions_revision=timetable.sessions_revision+1
  where timetable.id=target_timetable_id returning timetable.sessions_revision into current_revision;
  return query select current_revision,result_collections;
end;
$$;

create or replace function public.plannix_save_recurring_timetable_sessions(
  target_organisation_id uuid,target_academic_year_id uuid,target_timetable_id uuid,
  target_week_id uuid,expected_revision bigint,target_sessions jsonb
)
returns table (revision bigint, collection_id uuid, sessions jsonb)
language sql security invoker set search_path='' as $$
  select batch.revision,(entry.value->>'collectionId')::uuid,entry.value->'sessions'
  from public.plannix_apply_timetable_session_batch(
    target_organisation_id,target_academic_year_id,target_timetable_id,expected_revision,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('type','recurring','weekId',target_week_id,'sessions',target_sessions))
  ) as batch
  cross join lateral pg_catalog.jsonb_array_elements(batch.collections) as entry(value);
$$;

create or replace function public.plannix_save_dated_timetable_sessions(
  target_organisation_id uuid,target_academic_year_id uuid,target_timetable_id uuid,
  target_week_start_date date,expected_revision bigint,target_sessions jsonb
)
returns table (revision bigint, collection_id uuid, repeating_week_id uuid, sessions jsonb)
language sql security invoker set search_path='' as $$
  select batch.revision,(entry.value->>'collectionId')::uuid,(entry.value->>'weekId')::uuid,entry.value->'sessions'
  from public.plannix_apply_timetable_session_batch(
    target_organisation_id,target_academic_year_id,target_timetable_id,expected_revision,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('type','date_override','weekStartDate',target_week_start_date,'sessions',target_sessions))
  ) as batch
  cross join lateral pg_catalog.jsonb_array_elements(batch.collections) as entry(value);
$$;

create or replace function public.plannix_remove_dated_timetable_override(
  target_organisation_id uuid,target_academic_year_id uuid,target_timetable_id uuid,
  target_week_start_date date,expected_revision bigint
)
returns table (revision bigint, week_start_date date, repeating_week_id uuid, source text,
  override_exists boolean, collection_id uuid, sessions jsonb)
language plpgsql security invoker set search_path='' as $$
declare current_revision bigint;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if not (select private.plannix_is_confirmed_user()) then raise exception using errcode='42501',message='Email confirmation is required.'; end if;
  if not (select private.plannix_is_organisation_admin(target_organisation_id)) then raise exception using errcode='42501',message='Organisation Admin access is required.'; end if;
  select timetable.sessions_revision into current_revision from public.plannix_timetables as timetable
  where timetable.id=target_timetable_id and timetable.organisation_id=target_organisation_id
    and timetable.academic_year_id=target_academic_year_id for update;
  if not found then raise exception using errcode='P0002',message='Timetable was not found.'; end if;
  if current_revision<>expected_revision then raise exception using errcode='40001',message='TIMETABLE_SESSIONS_REVISION_CONFLICT'; end if;
  perform private.plannix_resolve_timetable_week(target_timetable_id,target_week_start_date);
  delete from public.plannix_timetable_session_collections as session_collection
  where session_collection.timetable_id=target_timetable_id
    and session_collection.collection_type='date_override'
    and session_collection.week_start_date=target_week_start_date;
  update public.plannix_timetables as timetable set sessions_revision=timetable.sessions_revision+1
  where timetable.id=target_timetable_id returning timetable.sessions_revision into current_revision;
  return query select * from public.plannix_get_dated_timetable_sessions(
    target_organisation_id,target_academic_year_id,target_timetable_id,target_week_start_date
  );
end;
$$;

revoke all on function public.plannix_get_recurring_timetable_sessions(uuid,uuid,uuid) from public,anon;
revoke all on function public.plannix_get_dated_timetable_sessions(uuid,uuid,uuid,date) from public,anon;
revoke all on function public.plannix_apply_timetable_session_batch(uuid,uuid,uuid,bigint,jsonb) from public,anon;
revoke all on function public.plannix_save_recurring_timetable_sessions(uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon;
revoke all on function public.plannix_save_dated_timetable_sessions(uuid,uuid,uuid,date,bigint,jsonb) from public,anon;
revoke all on function public.plannix_remove_dated_timetable_override(uuid,uuid,uuid,date,bigint) from public,anon;

grant execute on function public.plannix_get_recurring_timetable_sessions(uuid,uuid,uuid) to authenticated;
grant execute on function public.plannix_get_dated_timetable_sessions(uuid,uuid,uuid,date) to authenticated;
grant execute on function public.plannix_apply_timetable_session_batch(uuid,uuid,uuid,bigint,jsonb) to authenticated;
grant execute on function public.plannix_save_recurring_timetable_sessions(uuid,uuid,uuid,uuid,bigint,jsonb) to authenticated;
grant execute on function public.plannix_save_dated_timetable_sessions(uuid,uuid,uuid,date,bigint,jsonb) to authenticated;
grant execute on function public.plannix_remove_dated_timetable_override(uuid,uuid,uuid,date,bigint) to authenticated;
