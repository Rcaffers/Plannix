-- Keep uniqueness immediate except while reconciling
-- one validated final collection, then force validation before the RPC returns.
begin;
alter table public.plannix_timetable_sessions
  drop constraint uq_plannix_timetable_session_slot,
  add constraint uq_plannix_timetable_session_slot
    unique (collection_id, day_number, period_id) deferrable initially immediate;

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
  set constraints public.uq_plannix_timetable_session_slot deferred;
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
  set constraints public.uq_plannix_timetable_session_slot immediate;
  return private.plannix_session_json(target_collection_id, false);
end;
$$;


commit;
