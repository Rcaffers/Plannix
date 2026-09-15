create or replace function private.plannix_is_confirmed_user()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = (select auth.uid())
      and auth_user.email_confirmed_at is not null
  );
$$;

revoke all
on function private.plannix_is_confirmed_user()
from public, anon;

grant execute
on function private.plannix_is_confirmed_user()
to authenticated;

create or replace function public.plannix_save_academic_year(
  target_organisation_id uuid,
  target_academic_year_id uuid,
  target_name text,
  target_start_date date,
  target_end_date date,
  target_holidays jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_user_id uuid;
  saved_academic_year_id uuid;
  holiday_entry jsonb;
  holiday_id uuid;
  holiday_name text;
  holiday_start_date date;
  holiday_end_date date;
  intended_holiday_ids uuid[] := array[]::uuid[];
begin
  caller_user_id := auth.uid();

  if caller_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if not (select private.plannix_is_confirmed_user()) then
    raise exception using
      errcode = '42501',
      message = 'Email confirmation is required.';
  end if;

  if target_organisation_id is null
     or not (select private.plannix_is_organisation_admin(target_organisation_id)) then
    raise exception using
      errcode = '42501',
      message = 'Organisation Admin access is required.';
  end if;

  target_name := pg_catalog.btrim(target_name);
  if target_name is null or pg_catalog.length(target_name) < 1
     or pg_catalog.length(target_name) > 200 then
    raise exception using
      errcode = '22023',
      message = 'Academic-year name must contain between 1 and 200 characters.';
  end if;

  if target_start_date is null or target_end_date is null
     or target_end_date <= target_start_date then
    raise exception using
      errcode = '22023',
      message = 'Academic-year dates are invalid.';
  end if;

  if target_holidays is null or pg_catalog.jsonb_typeof(target_holidays) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Holidays must be an array.';
  end if;

  if pg_catalog.jsonb_array_length(target_holidays) > 100 then
    raise exception using
      errcode = '22023',
      message = 'No more than 100 holidays may be saved.';
  end if;

  if exists (
    select 1
    from (
      select holiday_value ->> 'id' as supplied_id
      from pg_catalog.jsonb_array_elements(target_holidays) as holiday_values(holiday_value)
      where nullif(pg_catalog.btrim(holiday_value ->> 'id'), '') is not null
      group by holiday_value ->> 'id'
      having count(*) > 1
    ) as duplicate_holiday_ids
  ) then
    raise exception using
      errcode = '22023',
      message = 'Holiday IDs must be unique.';
  end if;

  if target_academic_year_id is null then
    insert into public.plannix_academic_years (
      organisation_id,
      name,
      start_date,
      end_date
    )
    values (
      target_organisation_id,
      target_name,
      target_start_date,
      target_end_date
    )
    returning id into saved_academic_year_id;
  else
    update public.plannix_academic_years as academic_year
    set name = target_name,
        start_date = target_start_date,
        end_date = target_end_date
    where academic_year.id = target_academic_year_id
      and academic_year.organisation_id = target_organisation_id
    returning academic_year.id into saved_academic_year_id;

    if saved_academic_year_id is null then
      raise exception using
        errcode = '22023',
        message = 'The academic year does not belong to the selected organisation.';
    end if;
  end if;

  for holiday_entry in
    select holiday_value
    from pg_catalog.jsonb_array_elements(target_holidays) as holiday_values(holiday_value)
  loop
    if pg_catalog.jsonb_typeof(holiday_entry) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'Each holiday must be an object.';
    end if;

    holiday_name := pg_catalog.btrim(holiday_entry ->> 'name');
    if holiday_name is null or pg_catalog.length(holiday_name) < 1
       or pg_catalog.length(holiday_name) > 200 then
      raise exception using
        errcode = '22023',
        message = 'Holiday names must contain between 1 and 200 characters.';
    end if;

    begin
      holiday_start_date := (holiday_entry ->> 'start_date')::date;
      holiday_end_date := (holiday_entry ->> 'end_date')::date;
      holiday_id := coalesce(
        nullif(pg_catalog.btrim(holiday_entry ->> 'id'), '')::uuid,
        gen_random_uuid()
      );
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception using
          errcode = '22023',
          message = 'Holiday identifiers and dates must be valid.';
    end;

    if holiday_start_date is null or holiday_end_date is null
       or holiday_end_date < holiday_start_date
       or holiday_start_date < target_start_date
       or holiday_end_date > target_end_date then
      raise exception using
        errcode = '22023',
        message = 'Holiday dates must fall within the academic year.';
    end if;

    if holiday_id = any(intended_holiday_ids) then
      raise exception using
        errcode = '22023',
        message = 'Holiday IDs must be unique.';
    end if;

    if exists (
      select 1
      from public.plannix_holidays as existing_holiday
      where existing_holiday.id = holiday_id
        and existing_holiday.academic_year_id <> saved_academic_year_id
    ) then
      raise exception using
        errcode = '22023',
        message = 'A holiday ID belongs to another academic year.';
    end if;

    update public.plannix_holidays as existing_holiday
    set name = holiday_name,
        start_date = holiday_start_date,
        end_date = holiday_end_date
    where existing_holiday.id = holiday_id
      and existing_holiday.academic_year_id = saved_academic_year_id;

    if not found then
      insert into public.plannix_holidays (
        id,
        academic_year_id,
        name,
        start_date,
        end_date
      )
      values (
        holiday_id,
        saved_academic_year_id,
        holiday_name,
        holiday_start_date,
        holiday_end_date
      );
    end if;

    intended_holiday_ids := pg_catalog.array_append(intended_holiday_ids, holiday_id);
  end loop;

  delete from public.plannix_holidays as omitted_holiday
  where omitted_holiday.academic_year_id = saved_academic_year_id
    and not (omitted_holiday.id = any(intended_holiday_ids));

  return saved_academic_year_id;
end;
$$;

revoke all
on function public.plannix_save_academic_year(uuid, uuid, text, date, date, jsonb)
from public, anon;

grant execute
on function public.plannix_save_academic_year(uuid, uuid, text, date, date, jsonb)
to authenticated;

comment on function public.plannix_save_academic_year(uuid, uuid, text, date, date, jsonb) is
  'Transactionally creates or updates one academic year and reconciles its complete holiday collection for the confirmed Organisation Admin caller.';
