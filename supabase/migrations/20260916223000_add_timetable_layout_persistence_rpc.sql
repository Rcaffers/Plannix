alter table public.plannix_timetables
add column cadence text not null default 'one-week',
add column school_start_time time not null default '09:00',
add column teaching_period_minutes smallint not null default 60,
add column layout_revision bigint not null default 0,
add column is_default boolean not null default false;

alter table public.plannix_timetables
add constraint chk_plannix_timetables_cadence
check (cadence in ('one-week', 'two-week')),
add constraint chk_plannix_timetables_teaching_period_minutes
check (teaching_period_minutes between 20 and 120),
add constraint chk_plannix_timetables_layout_revision
check (layout_revision >= 0);

with ranked_timetables as (
  select
    timetable.id,
    row_number() over (
      partition by timetable.academic_year_id
      order by timetable.created_at, timetable.id
    ) as default_rank
  from public.plannix_timetables as timetable
)
update public.plannix_timetables as timetable
set is_default = ranked_timetables.default_rank = 1
from ranked_timetables
where ranked_timetables.id = timetable.id;

create unique index uq_plannix_timetables_default_academic_year
on public.plannix_timetables (academic_year_id)
where is_default;

alter table public.plannix_timetable_periods
add column period_type text not null default 'teaching',
add column sort_order integer not null default 0,
add column is_enabled boolean not null default true,
add column is_visible boolean not null default true;

alter table public.plannix_timetable_periods
drop constraint uq_plannix_timetable_periods_number;

update public.plannix_timetable_periods as period
set period_type = case when period.is_break then 'break' else 'teaching' end;

with ordered_periods as (
  select
    period.id,
    row_number() over (
      partition by period.timetable_id
      order by period.period_number, period.created_at, period.id
    ) - 1 as normalized_sort_order
  from public.plannix_timetable_periods as period
)
update public.plannix_timetable_periods as period
set sort_order = ordered_periods.normalized_sort_order
from ordered_periods
where ordered_periods.id = period.id;

do $$
begin
  if exists (
    select 1
    from public.plannix_timetable_periods as period
    group by period.timetable_id
    having count(*) > 20
      or count(*) filter (where period.period_type = 'teaching') > 12
  ) then
    raise exception using
      errcode = '23514',
      message = 'Existing timetable layouts exceed the supported period limits.';
  end if;
end;
$$;

with numbered_teaching_periods as (
  select
    period.id,
    row_number() over (
      partition by period.timetable_id
      order by period.period_number, period.created_at, period.id
    ) as normalized_period_number
  from public.plannix_timetable_periods as period
  where period.period_type = 'teaching'
)
update public.plannix_timetable_periods as period
set period_number = numbered_teaching_periods.normalized_period_number
from numbered_teaching_periods
where numbered_teaching_periods.id = period.id;

alter table public.plannix_timetable_periods
alter column period_number drop not null;

update public.plannix_timetable_periods
set period_number = null
where period_type <> 'teaching';

alter table public.plannix_timetable_periods
drop constraint chk_plannix_timetable_periods_number,
drop constraint chk_plannix_timetable_periods_times,
drop column is_break;

alter table public.plannix_timetable_periods
add constraint chk_plannix_timetable_periods_type
check (period_type in ('teaching', 'registration', 'break', 'lunch')),
add constraint chk_plannix_timetable_periods_number
check (
  (period_type = 'teaching' and period_number between 1 and 12)
  or (period_type <> 'teaching' and period_number is null)
),
add constraint chk_plannix_timetable_periods_sort_order
check (sort_order between 0 and 19),
add constraint chk_plannix_timetable_periods_state
check (
  (period_type = 'teaching' and is_enabled and is_visible)
  or period_type <> 'teaching'
),
add constraint chk_plannix_timetable_periods_times
check (
  (is_enabled and end_time > start_time)
  or (not is_enabled and period_type <> 'teaching' and end_time >= start_time)
);

create unique index uq_plannix_timetable_periods_registration
on public.plannix_timetable_periods (timetable_id)
where period_type = 'registration';

create unique index uq_plannix_timetable_periods_lunch
on public.plannix_timetable_periods (timetable_id)
where period_type = 'lunch';

alter table public.plannix_timetable_periods
add constraint uq_plannix_timetable_periods_number
unique (timetable_id, period_number)
deferrable initially immediate;

alter table public.plannix_timetable_sessions
drop constraint fk_plannix_timetable_sessions_week,
drop constraint fk_plannix_timetable_sessions_period;

alter table public.plannix_timetable_sessions
add constraint fk_plannix_timetable_sessions_week
foreign key (timetable_week_id, timetable_id)
references public.plannix_timetable_weeks(id, timetable_id)
on delete restrict,
add constraint fk_plannix_timetable_sessions_period
foreign key (period_id, timetable_id)
references public.plannix_timetable_periods(id, timetable_id)
on delete restrict;

create or replace function public.plannix_save_timetable_layout(
  target_organisation_id uuid,
  target_academic_year_id uuid,
  target_timetable_id uuid,
  expected_revision bigint,
  target_layout jsonb
)
returns table (
  timetable_id uuid,
  revision bigint,
  weeks jsonb,
  periods jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_user_id uuid;
  academic_year_start date;
  academic_year_end date;
  saved_timetable_id uuid;
  current_revision bigint;
  layout_name text;
  layout_cadence text;
  layout_school_start time;
  layout_teaching_minutes smallint;
  period_entry jsonb;
  normalized_periods jsonb := '[]'::jsonb;
  intended_period_ids uuid[] := array[]::uuid[];
  intended_teaching_numbers integer[] := array[]::integer[];
  period_id uuid;
  supplied_period_id uuid;
  period_kind text;
  period_label text;
  period_start time;
  period_end time;
  period_enabled boolean;
  period_visible boolean;
  teaching_number integer;
  teaching_count integer := 0;
  break_count integer := 0;
  registration_count integer := 0;
  lunch_count integer := 0;
  period_position integer;
  week_a_id uuid;
  week_b_id uuid;
  authoritative_weeks jsonb;
  authoritative_periods jsonb;
begin
  caller_user_id := auth.uid();

  if caller_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if not (select private.plannix_is_confirmed_user()) then
    raise exception using errcode = '42501', message = 'Email confirmation is required.';
  end if;

  if target_organisation_id is null
     or not (select private.plannix_is_organisation_admin(target_organisation_id)) then
    raise exception using errcode = '42501', message = 'Organisation Admin access is required.';
  end if;

  if target_academic_year_id is null then
    raise exception using errcode = '22023', message = 'Academic year is required.';
  end if;

  if expected_revision is null or expected_revision < 0 then
    raise exception using errcode = '22023', message = 'Expected revision must be a nonnegative integer.';
  end if;

  if target_layout is null or pg_catalog.jsonb_typeof(target_layout) <> 'object'
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(target_layout) as supplied_key(key_name)
       where supplied_key.key_name not in (
         'name', 'cadence', 'schoolStartTime', 'teachingPeriodMinutes', 'periods'
       )
     )
     or not (target_layout ?& array[
       'name', 'cadence', 'schoolStartTime', 'teachingPeriodMinutes', 'periods'
     ]) then
    raise exception using errcode = '22023', message = 'Timetable layout fields are invalid.';
  end if;

  layout_name := pg_catalog.btrim(target_layout ->> 'name');
  layout_cadence := target_layout ->> 'cadence';

  if layout_name is null or pg_catalog.length(layout_name) < 1
     or pg_catalog.length(layout_name) > 200 then
    raise exception using errcode = '22023', message = 'Timetable name must contain between 1 and 200 characters.';
  end if;

  if layout_cadence not in ('one-week', 'two-week') then
    raise exception using errcode = '22023', message = 'Timetable cadence is invalid.';
  end if;

  begin
    layout_school_start := (target_layout ->> 'schoolStartTime')::time;
    if pg_catalog.jsonb_typeof(target_layout -> 'teachingPeriodMinutes') <> 'number'
       or (target_layout ->> 'teachingPeriodMinutes') !~ '^[0-9]+$' then
      raise invalid_parameter_value;
    end if;
    layout_teaching_minutes := (target_layout ->> 'teachingPeriodMinutes')::smallint;
  exception
    when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range
      or invalid_parameter_value then
      raise exception using errcode = '22023', message = 'Timetable time configuration is invalid.';
  end;

  if layout_teaching_minutes < 20 or layout_teaching_minutes > 120 then
    raise exception using errcode = '22023', message = 'Teaching period duration must be from 20 to 120 minutes.';
  end if;

  if pg_catalog.jsonb_typeof(target_layout -> 'periods') <> 'array'
     or pg_catalog.jsonb_array_length(target_layout -> 'periods') > 20 then
    raise exception using errcode = '22023', message = 'Periods must be an array containing no more than 20 rows.';
  end if;

  select academic_year.start_date, academic_year.end_date
  into academic_year_start, academic_year_end
  from public.plannix_academic_years as academic_year
  where academic_year.id = target_academic_year_id
    and academic_year.organisation_id = target_organisation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Academic year was not found.';
  end if;

  if target_timetable_id is null then
    select timetable.id, timetable.layout_revision
    into saved_timetable_id, current_revision
    from public.plannix_timetables as timetable
    where timetable.academic_year_id = target_academic_year_id
      and timetable.organisation_id = target_organisation_id
      and timetable.is_default
    for update;

    if saved_timetable_id is null then
      if expected_revision <> 0 then
        raise exception using errcode = '40001', message = 'TIMETABLE_LAYOUT_REVISION_CONFLICT';
      end if;

      insert into public.plannix_timetables (
        organisation_id, academic_year_id, name, days_per_week,
        active_from, active_to, cadence, school_start_time,
        teaching_period_minutes, layout_revision, is_default
      ) values (
        target_organisation_id, target_academic_year_id, layout_name, 5,
        academic_year_start, academic_year_end, layout_cadence, layout_school_start,
        layout_teaching_minutes, 0, true
      )
      returning id, layout_revision into saved_timetable_id, current_revision;
    end if;
  else
    select timetable.id, timetable.layout_revision
    into saved_timetable_id, current_revision
    from public.plannix_timetables as timetable
    where timetable.id = target_timetable_id
      and timetable.academic_year_id = target_academic_year_id
      and timetable.organisation_id = target_organisation_id
      and timetable.is_default
    for update;

    if saved_timetable_id is null then
      raise exception using errcode = 'P0002', message = 'Default timetable was not found.';
    end if;
  end if;

  if current_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'TIMETABLE_LAYOUT_REVISION_CONFLICT';
  end if;

  for period_entry in
    select period_value
    from pg_catalog.jsonb_array_elements(target_layout -> 'periods') as period_values(period_value)
  loop
    if pg_catalog.jsonb_typeof(period_entry) <> 'object'
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(period_entry) as supplied_key(key_name)
         where supplied_key.key_name not in (
           'id', 'type', 'label', 'startTime', 'endTime', 'enabled', 'visible', 'periodNumber'
         )
       )
       or not (period_entry ?& array['type', 'label', 'startTime', 'endTime', 'enabled', 'visible']) then
      raise exception using errcode = '22023', message = 'A timetable period contains invalid fields.';
    end if;

    period_kind := period_entry ->> 'type';
    period_label := pg_catalog.btrim(period_entry ->> 'label');
    if period_kind not in ('teaching', 'registration', 'break', 'lunch')
       or period_label is null or pg_catalog.length(period_label) < 1
       or pg_catalog.length(period_label) > 100
       or pg_catalog.jsonb_typeof(period_entry -> 'enabled') <> 'boolean'
       or pg_catalog.jsonb_typeof(period_entry -> 'visible') <> 'boolean' then
      raise exception using errcode = '22023', message = 'A timetable period is invalid.';
    end if;

    period_enabled := (period_entry ->> 'enabled')::boolean;
    period_visible := (period_entry ->> 'visible')::boolean;

    begin
      period_start := (period_entry ->> 'startTime')::time;
      period_end := (period_entry ->> 'endTime')::time;
      supplied_period_id := case
        when period_entry ? 'id' then (period_entry ->> 'id')::uuid
        else null
      end;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception using errcode = '22023', message = 'Period identifiers and times must be valid.';
    end;

    if period_kind = 'teaching' then
      teaching_count := teaching_count + 1;
      if not (period_entry ? 'periodNumber')
         or pg_catalog.jsonb_typeof(period_entry -> 'periodNumber') <> 'number'
         or (period_entry ->> 'periodNumber') !~ '^[0-9]+$' then
        raise exception using errcode = '22023', message = 'Teaching period numbers must be integers from 1 to 12.';
      end if;
      teaching_number := (period_entry ->> 'periodNumber')::integer;
      if teaching_number < 1 or teaching_number > 12
         or teaching_number = any(intended_teaching_numbers)
         or not period_enabled or not period_visible then
        raise exception using errcode = '22023', message = 'Teaching periods must be enabled, visible and uniquely numbered from 1 to 12.';
      end if;
      intended_teaching_numbers := pg_catalog.array_append(intended_teaching_numbers, teaching_number);
    else
      if period_entry ? 'periodNumber' and period_entry -> 'periodNumber' <> 'null'::jsonb then
        raise exception using errcode = '22023', message = 'Non-teaching periods cannot have a period number.';
      end if;
      teaching_number := null;
      if period_kind = 'registration' then registration_count := registration_count + 1; end if;
      if period_kind = 'break' then break_count := break_count + 1; end if;
      if period_kind = 'lunch' then lunch_count := lunch_count + 1; end if;
    end if;

    if supplied_period_id is not null then
      if not exists (
        select 1
        from public.plannix_timetable_periods as existing_period
        where existing_period.id = supplied_period_id
          and existing_period.timetable_id = saved_timetable_id
          and (
            period_kind <> 'teaching'
            or (
              existing_period.period_type = 'teaching'
              and existing_period.period_number = teaching_number
            )
          )
      ) then
        raise exception using errcode = '42501', message = 'A period ID belongs to another timetable.';
      end if;
      period_id := supplied_period_id;
    elsif period_kind = 'teaching' then
      select existing_period.id
      into period_id
      from public.plannix_timetable_periods as existing_period
      where existing_period.timetable_id = saved_timetable_id
        and existing_period.period_type = 'teaching'
        and existing_period.period_number = teaching_number;

      if period_id is null then
        period_id := gen_random_uuid();
      end if;
    else
      period_id := gen_random_uuid();
    end if;

    if period_id = any(intended_period_ids) then
      raise exception using errcode = '22023', message = 'Period IDs must be unique.';
    end if;

    if (period_enabled and period_end <= period_start)
       or (not period_enabled and (period_kind = 'teaching' or period_end < period_start)) then
      raise exception using errcode = '22023', message = 'Period times are invalid.';
    end if;

    intended_period_ids := pg_catalog.array_append(intended_period_ids, period_id);
    normalized_periods := normalized_periods || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', period_id,
        'type', period_kind,
        'label', period_label,
        'startTime', period_start,
        'endTime', period_end,
        'enabled', period_enabled,
        'visible', period_visible,
        'periodNumber', teaching_number
      )
    );
  end loop;

  if teaching_count < 1 or teaching_count > 12
     or registration_count > 1 or break_count > 6 or lunch_count > 1 then
    raise exception using errcode = '22023', message = 'Timetable period counts are invalid.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(normalized_periods) as left_period(value)
    join pg_catalog.jsonb_array_elements(normalized_periods) as right_period(value)
      on (left_period.value ->> 'id') < (right_period.value ->> 'id')
    where (left_period.value ->> 'type') = 'teaching'
      and (
        (right_period.value ->> 'type') = 'teaching'
        or (
          (right_period.value ->> 'type') <> 'teaching'
          and (right_period.value ->> 'enabled')::boolean
        )
      )
      and (left_period.value ->> 'startTime')::time < (right_period.value ->> 'endTime')::time
      and (right_period.value ->> 'startTime')::time < (left_period.value ->> 'endTime')::time
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(normalized_periods) as left_period(value)
    join pg_catalog.jsonb_array_elements(normalized_periods) as right_period(value)
      on (left_period.value ->> 'id') < (right_period.value ->> 'id')
    where (right_period.value ->> 'type') = 'teaching'
      and (left_period.value ->> 'type') <> 'teaching'
      and (left_period.value ->> 'enabled')::boolean
      and (left_period.value ->> 'startTime')::time < (right_period.value ->> 'endTime')::time
      and (right_period.value ->> 'startTime')::time < (left_period.value ->> 'endTime')::time
  ) then
    raise exception using errcode = '22023', message = 'Teaching periods cannot overlap teaching or enabled blocking periods.';
  end if;

  if exists (
    select 1
    from public.plannix_timetable_sessions as timetable_session
    join public.plannix_timetable_periods as existing_period
      on existing_period.id = timetable_session.period_id
    where existing_period.timetable_id = saved_timetable_id
      and (
        not (existing_period.id = any(intended_period_ids))
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(normalized_periods) as intended_period(value)
          where (intended_period.value ->> 'id')::uuid = existing_period.id
            and (
              intended_period.value ->> 'type' <> 'teaching'
              or not (intended_period.value ->> 'enabled')::boolean
            )
        )
      )
  ) then
    raise exception using errcode = '23503', message = 'TIMETABLE_LAYOUT_PERIOD_IN_USE';
  end if;

  update public.plannix_timetables as timetable
  set name = layout_name,
      days_per_week = 5,
      active_from = academic_year_start,
      active_to = academic_year_end,
      cadence = layout_cadence,
      school_start_time = layout_school_start,
      teaching_period_minutes = layout_teaching_minutes
  where timetable.id = saved_timetable_id;

  insert into public.plannix_timetable_weeks (timetable_id, code, name, sort_order)
  values (saved_timetable_id, 'A', 'Week A', 0)
  on conflict on constraint uq_plannix_timetable_weeks_code
  do update set name = excluded.name, sort_order = excluded.sort_order
  returning id into week_a_id;

  if layout_cadence = 'two-week' then
    insert into public.plannix_timetable_weeks (timetable_id, code, name, sort_order)
    values (saved_timetable_id, 'B', 'Week B', 1)
    on conflict on constraint uq_plannix_timetable_weeks_code
    do update set name = excluded.name, sort_order = excluded.sort_order
    returning id into week_b_id;
  else
    select timetable_week.id into week_b_id
    from public.plannix_timetable_weeks as timetable_week
    where timetable_week.timetable_id = saved_timetable_id
      and timetable_week.code = 'B';

    if week_b_id is not null and exists (
      select 1 from public.plannix_timetable_sessions as timetable_session
      where timetable_session.timetable_week_id = week_b_id
    ) then
      raise exception using errcode = '23503', message = 'TIMETABLE_LAYOUT_WEEK_IN_USE';
    end if;

    delete from public.plannix_timetable_weeks as timetable_week
    where timetable_week.timetable_id = saved_timetable_id
      and timetable_week.code = 'B';
  end if;

  if exists (
    select 1 from public.plannix_timetable_sessions as timetable_session
    join public.plannix_timetable_weeks as timetable_week
      on timetable_week.id = timetable_session.timetable_week_id
    where timetable_week.timetable_id = saved_timetable_id
      and timetable_week.code not in ('A', 'B')
  ) then
    raise exception using errcode = '23503', message = 'TIMETABLE_LAYOUT_WEEK_IN_USE';
  end if;

  delete from public.plannix_timetable_weeks as timetable_week
  where timetable_week.timetable_id = saved_timetable_id
    and timetable_week.code not in ('A', 'B');

  set constraints public.uq_plannix_timetable_periods_number deferred;

  for period_entry in select value from pg_catalog.jsonb_array_elements(normalized_periods)
  loop
    period_id := (period_entry ->> 'id')::uuid;
    period_kind := period_entry ->> 'type';
    period_label := period_entry ->> 'label';
    period_start := (period_entry ->> 'startTime')::time;
    period_end := (period_entry ->> 'endTime')::time;
    period_enabled := (period_entry ->> 'enabled')::boolean;
    period_visible := (period_entry ->> 'visible')::boolean;
    teaching_number := nullif(period_entry ->> 'periodNumber', '')::integer;

    select count(*)::integer
    into period_position
    from pg_catalog.jsonb_array_elements(normalized_periods) as ordered_period(value)
    where (ordered_period.value ->> 'startTime')::time < period_start
       or (
         (ordered_period.value ->> 'startTime')::time = period_start
         and case ordered_period.value ->> 'type'
           when 'teaching' then 0 when 'registration' then 1 when 'break' then 2 else 3 end
           < case period_kind
             when 'teaching' then 0 when 'registration' then 1 when 'break' then 2 else 3 end
       )
       or (
         (ordered_period.value ->> 'startTime')::time = period_start
         and ordered_period.value ->> 'type' = period_kind
         and (ordered_period.value ->> 'id') < period_id::text
       );

    if exists (
      select 1 from public.plannix_timetable_periods as existing_period
      where existing_period.id = period_id
    ) then
      update public.plannix_timetable_periods as existing_period
      set period_number = teaching_number,
          label = period_label,
          start_time = period_start,
          end_time = period_end,
          period_type = period_kind,
          sort_order = period_position,
          is_enabled = period_enabled,
          is_visible = period_visible
      where existing_period.id = period_id
        and existing_period.timetable_id = saved_timetable_id;
    else
      insert into public.plannix_timetable_periods (
        id, timetable_id, period_number, label, start_time, end_time,
        period_type, sort_order, is_enabled, is_visible
      ) values (
        period_id, saved_timetable_id, teaching_number, period_label, period_start, period_end,
        period_kind, period_position, period_enabled, period_visible
      );
    end if;
  end loop;

  delete from public.plannix_timetable_periods as existing_period
  where existing_period.timetable_id = saved_timetable_id
    and not (existing_period.id = any(intended_period_ids));

  update public.plannix_timetables as timetable
  set layout_revision = timetable.layout_revision + 1
  where timetable.id = saved_timetable_id
  returning timetable.layout_revision into current_revision;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', timetable_week.id,
        'code', timetable_week.code,
        'name', timetable_week.name
      ) order by timetable_week.sort_order, timetable_week.id
    ),
    '[]'::jsonb
  ) into authoritative_weeks
  from public.plannix_timetable_weeks as timetable_week
  where timetable_week.timetable_id = saved_timetable_id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', saved_period.id,
        'type', saved_period.period_type,
        'label', saved_period.label,
        'startTime', pg_catalog.to_char(saved_period.start_time, 'HH24:MI'),
        'endTime', pg_catalog.to_char(saved_period.end_time, 'HH24:MI'),
        'enabled', saved_period.is_enabled,
        'visible', saved_period.is_visible,
        'periodNumber', saved_period.period_number
      ) order by saved_period.sort_order, saved_period.id
    ),
    '[]'::jsonb
  ) into authoritative_periods
  from public.plannix_timetable_periods as saved_period
  where saved_period.timetable_id = saved_timetable_id;

  return query
  select saved_timetable_id, current_revision, authoritative_weeks, authoritative_periods;
end;
$$;

revoke all
on function public.plannix_save_timetable_layout(uuid, uuid, uuid, bigint, jsonb)
from public, anon;

grant execute
on function public.plannix_save_timetable_layout(uuid, uuid, uuid, bigint, jsonb)
to authenticated;

comment on function public.plannix_save_timetable_layout(uuid, uuid, uuid, bigint, jsonb) is
  'Transactionally reconciles one default timetable layout using confirmed Organisation Admin identity, stable relational rows and revision concurrency.';
