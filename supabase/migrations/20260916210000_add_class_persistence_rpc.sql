alter table public.plannix_classes
add column frequency smallint;

update public.plannix_classes
set frequency = 1
where frequency is null;

alter table public.plannix_classes
alter column frequency set default 1,
alter column frequency set not null;

do $$
begin
  if exists (
    select 1
    from public.plannix_classes as class_row
    where length(trim(class_row.name)) > 200
  ) then
    raise exception 'Existing class names exceed the supported 200-character limit.';
  end if;

  if exists (
    select 1
    from public.plannix_classes as class_row
    group by class_row.academic_year_id
    having count(*) > 60
  ) then
    raise exception 'An existing academic year contains more than 60 classes.';
  end if;
end;
$$;

with ordered_classes as (
  select
    class_row.id,
    row_number() over (
      partition by class_row.academic_year_id
      order by class_row.sort_order, class_row.created_at, class_row.id
    ) - 1 as normalized_sort_order
  from public.plannix_classes as class_row
)
update public.plannix_classes as class_row
set sort_order = ordered_classes.normalized_sort_order
from ordered_classes
where ordered_classes.id = class_row.id;

alter table public.plannix_classes
add constraint chk_plannix_classes_frequency
check (frequency between 1 and 50),
add constraint chk_plannix_classes_sort_order
check (sort_order between 0 and 59),
add constraint chk_plannix_classes_name_length
check (length(trim(name)) between 1 and 200);

alter table public.plannix_academic_years
add column classes_revision bigint not null default 0,
add constraint chk_plannix_academic_years_classes_revision
check (classes_revision >= 0);

create or replace function public.plannix_save_classes(
  target_organisation_id uuid,
  target_academic_year_id uuid,
  expected_revision bigint,
  target_classes jsonb
)
returns table (
  revision bigint,
  classes jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_user_id uuid;
  current_revision bigint;
  class_entry jsonb;
  class_index integer := 0;
  class_id uuid;
  class_name text;
  class_frequency smallint;
  intended_class_ids uuid[] := array[]::uuid[];
  intended_class_names text[] := array[]::text[];
  normalized_classes jsonb := '[]'::jsonb;
  authoritative_classes jsonb;
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

  if target_organisation_id is null or target_academic_year_id is null then
    raise exception using
      errcode = '22023',
      message = 'Organisation and academic year are required.';
  end if;

  if expected_revision is null or expected_revision < 0 then
    raise exception using
      errcode = '22023',
      message = 'Expected revision must be a nonnegative integer.';
  end if;

  if target_classes is null or jsonb_typeof(target_classes) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Classes must be supplied as an array.';
  end if;

  if jsonb_array_length(target_classes) > 60 then
    raise exception using
      errcode = '22023',
      message = 'No more than 60 classes are allowed.';
  end if;

  if not (select private.plannix_is_organisation_admin(target_organisation_id)) then
    raise exception using
      errcode = '42501',
      message = 'Organisation Admin access is required.';
  end if;

  select academic_year.classes_revision
  into current_revision
  from public.plannix_academic_years as academic_year
  where academic_year.id = target_academic_year_id
    and academic_year.organisation_id = target_organisation_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Academic year was not found.';
  end if;

  if current_revision <> expected_revision then
    raise exception using
      errcode = '40001',
      message = 'Class collection revision conflict.';
  end if;

  for class_entry in select value from jsonb_array_elements(target_classes)
  loop
    if jsonb_typeof(class_entry) <> 'object'
       or exists (
         select 1
         from jsonb_object_keys(class_entry) as supplied_key(key_name)
         where supplied_key.key_name not in ('id', 'name', 'frequency')
       ) then
      raise exception using
        errcode = '22023',
        message = 'A class contains unexpected fields.';
    end if;

    if not (class_entry ? 'name')
       or jsonb_typeof(class_entry -> 'name') <> 'string' then
      raise exception using
        errcode = '22023',
        message = 'Every class must have a name.';
    end if;

    class_name := trim(class_entry ->> 'name');
    if length(class_name) < 1 or length(class_name) > 200 then
      raise exception using
        errcode = '22023',
        message = 'Class names must contain between 1 and 200 characters.';
    end if;

    if not (class_entry ? 'frequency')
       or jsonb_typeof(class_entry -> 'frequency') <> 'number'
       or (class_entry ->> 'frequency') !~ '^[0-9]+$' then
      raise exception using
        errcode = '22023',
        message = 'Class frequency must be an integer from 1 to 50.';
    end if;

    class_frequency := (class_entry ->> 'frequency')::smallint;
    if class_frequency < 1 or class_frequency > 50 then
      raise exception using
        errcode = '22023',
        message = 'Class frequency must be an integer from 1 to 50.';
    end if;

    if class_entry ? 'id' then
      if jsonb_typeof(class_entry -> 'id') <> 'string' then
        raise exception using errcode = '22023', message = 'Class IDs must be UUIDs.';
      end if;
      begin
        class_id := (class_entry ->> 'id')::uuid;
      exception
        when invalid_text_representation then
          raise exception using errcode = '22023', message = 'Class IDs must be UUIDs.';
      end;
    else
      class_id := gen_random_uuid();
    end if;

    if class_id = any(intended_class_ids) then
      raise exception using errcode = '22023', message = 'Class IDs must be unique.';
    end if;
    if class_name = any(intended_class_names) then
      raise exception using errcode = '23505', message = 'Class names must be unique within an academic year.';
    end if;

    intended_class_ids := array_append(intended_class_ids, class_id);
    intended_class_names := array_append(intended_class_names, class_name);
    normalized_classes := normalized_classes || jsonb_build_array(jsonb_build_object(
      'id', class_id,
      'name', class_name,
      'frequency', class_frequency,
      'sortOrder', class_index
    ));
    class_index := class_index + 1;
  end loop;

  if exists (
    select 1
    from public.plannix_classes as existing_class
    where existing_class.id = any(intended_class_ids)
      and (
        existing_class.organisation_id <> target_organisation_id
        or existing_class.academic_year_id <> target_academic_year_id
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'A class ID belongs to another academic year.';
  end if;

  if exists (
    select 1
    from public.plannix_classes as omitted_class
    join public.plannix_timetable_sessions as timetable_session
      on timetable_session.class_id = omitted_class.id
    where omitted_class.organisation_id = target_organisation_id
      and omitted_class.academic_year_id = target_academic_year_id
      and not (omitted_class.id = any(intended_class_ids))
  ) then
    raise exception using
      errcode = '23503',
      message = 'A class with timetable placements cannot be removed.';
  end if;

  update public.plannix_classes as existing_class
  set name = '__plannix_reconcile__' || existing_class.id::text
  where existing_class.organisation_id = target_organisation_id
    and existing_class.academic_year_id = target_academic_year_id
    and existing_class.id = any(intended_class_ids);

  delete from public.plannix_classes as omitted_class
  where omitted_class.organisation_id = target_organisation_id
    and omitted_class.academic_year_id = target_academic_year_id
    and not (omitted_class.id = any(intended_class_ids));

  for class_entry in select value from jsonb_array_elements(normalized_classes)
  loop
    class_id := (class_entry ->> 'id')::uuid;
    class_name := class_entry ->> 'name';
    class_frequency := (class_entry ->> 'frequency')::smallint;
    class_index := (class_entry ->> 'sortOrder')::integer;

    begin
      insert into public.plannix_classes (
        id, organisation_id, academic_year_id, name, frequency, sort_order
      )
      values (
        class_id, target_organisation_id, target_academic_year_id,
        class_name, class_frequency, class_index
      )
      on conflict (id) do update
      set
        name = excluded.name,
        frequency = excluded.frequency,
        sort_order = excluded.sort_order,
        updated_at = now();
    exception
      when insufficient_privilege then
        raise exception using
          errcode = '42501',
          message = 'A class ID belongs to another academic year.';
    end;
  end loop;

  update public.plannix_academic_years as academic_year
  set classes_revision = academic_year.classes_revision + 1
  where academic_year.id = target_academic_year_id
    and academic_year.organisation_id = target_organisation_id
  returning academic_year.classes_revision into current_revision;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', saved_class.id,
        'name', saved_class.name,
        'frequency', saved_class.frequency
      ) order by saved_class.sort_order, saved_class.id
    ),
    '[]'::jsonb
  )
  into authoritative_classes
  from public.plannix_classes as saved_class
  where saved_class.organisation_id = target_organisation_id
    and saved_class.academic_year_id = target_academic_year_id;

  return query select current_revision, authoritative_classes;
end;
$$;

revoke all
on function public.plannix_save_classes(uuid, uuid, bigint, jsonb)
from public, anon;

grant execute
on function public.plannix_save_classes(uuid, uuid, bigint, jsonb)
to authenticated;

comment on function public.plannix_save_classes(uuid, uuid, bigint, jsonb) is
  'Transactionally reconciles the complete ordered class collection for one academic year using confirmed Organisation Admin identity and revision concurrency.';
