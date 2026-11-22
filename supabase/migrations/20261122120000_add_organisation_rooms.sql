-- CLI-owned transaction. Additive, nullable room references; no existing rows rewritten.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.plannix_rooms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.plannix_organisations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_plannix_rooms_name check (length(btrim(name)) between 1 and 200),
  constraint uq_plannix_rooms_org_name unique (organisation_id, name),
  constraint uq_plannix_rooms_id_org unique (id, organisation_id)
);
create trigger trg_plannix_rooms_updated_at
before update on public.plannix_rooms
for each row execute function public.plannix_set_updated_at();

alter table public.plannix_classes add column default_room_id uuid,
  add constraint fk_plannix_classes_default_room
  foreign key (default_room_id, organisation_id)
  references public.plannix_rooms(id, organisation_id) on delete no action deferrable initially deferred;
alter table public.plannix_timetable_sessions add column room_id uuid,
  add constraint fk_plannix_timetable_sessions_room
  foreign key (room_id, organisation_id)
  references public.plannix_rooms(id, organisation_id) on delete no action deferrable initially deferred;
-- Organisation -> academic year -> timetable -> session cascades have multiple
-- levels. Validate room FKs at commit so an earlier room cascade does not reject
-- sessions which the same organisation deletion will remove. Direct SQL callers
-- must confirm COMMIT (or SET CONSTRAINTS ... IMMEDIATE), not a DML row count.
-- Assignment triggers below validate and share-lock rooms for every write,
-- including direct writes and RPC upserts; this serializes against archiving.
create index idx_plannix_classes_default_room
  on public.plannix_classes(default_room_id, organisation_id) where default_room_id is not null;
create index idx_plannix_timetable_sessions_room
  on public.plannix_timetable_sessions(room_id, organisation_id) where room_id is not null;

alter table public.plannix_rooms enable row level security;
-- Revoke copied default grants as well as PUBLIC access. No table privileges for service_role.
revoke all on public.plannix_rooms from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.plannix_rooms to authenticated;
create policy "Staff roles can view organisation rooms" on public.plannix_rooms
for select to authenticated using (
  (select private.plannix_has_access_role(organisation_id, 'Organisation Admin'))
  or (select private.plannix_has_access_role(organisation_id, 'Staff'))
  or (select private.plannix_has_access_role(organisation_id, 'Read Only'))
);
create policy "Students can view rooms for their classes" on public.plannix_rooms
for select to authenticated using (
  (select private.plannix_has_access_role(organisation_id, 'Student'))
  and (
    exists (select 1 from public.plannix_classes c
      where c.organisation_id=plannix_rooms.organisation_id and c.default_room_id=plannix_rooms.id)
    or exists (select 1 from public.plannix_timetable_sessions s
      where s.organisation_id=plannix_rooms.organisation_id and s.room_id=plannix_rooms.id)
  )
);
create policy "Organisation admins can create rooms" on public.plannix_rooms
for insert to authenticated with check ((select private.plannix_is_organisation_admin(organisation_id)));
create policy "Organisation admins can update rooms" on public.plannix_rooms
for update to authenticated using ((select private.plannix_is_organisation_admin(organisation_id)))
with check ((select private.plannix_is_organisation_admin(organisation_id)));
create policy "Organisation admins can delete rooms" on public.plannix_rooms
for delete to authenticated using ((select private.plannix_is_organisation_admin(organisation_id)));

comment on table public.plannix_rooms is
  'Organisation-wide rooms. Archiving preserves existing references and dated materialisation of the same repeating placement, but rejects new assignments. No booking-conflict policy is introduced.';
comment on column public.plannix_classes.default_room_id is
  'Optional default used for new RPC placements, not a live fallback or a rewrite of existing session assignments.';
comment on column public.plannix_timetable_sessions.room_id is
  'Optional assigned room. FK prevents cross-organisation references and deletion of referenced rooms.';

-- AFTER triggers validate final row values and the actual INSERT/UPDATE outcome,
-- including ON CONFLICT; a later BEFORE trigger cannot rewrite a checked value.
-- Trigger functions run as the writer; room reads remain RLS scoped. SHARE,
-- unlike KEY SHARE, conflicts with an is_active UPDATE. A waiter sees the
-- committed active state before deciding whether a new reference is permitted.
create function private.plannix_validate_class_room()
returns trigger language plpgsql security invoker set search_path='' as $$
declare active_room boolean; retained boolean := false;
begin
  if new.default_room_id is null then return new; end if;
  select r.is_active into active_room from public.plannix_rooms r
  where r.id=new.default_room_id and r.organisation_id=new.organisation_id for share;
  if not found then
    raise exception using errcode='23503',message='Default room is unavailable for this organisation.';
  end if;
  if tg_op='UPDATE' then
    retained := old.organisation_id=new.organisation_id and old.default_room_id=new.default_room_id;
  end if;
  if not active_room and not coalesce(retained,false) then
    raise exception using errcode='23514',message='Archived rooms cannot be newly assigned.';
  end if;
  return new;
end;
$$;
create function private.plannix_validate_session_room()
returns trigger language plpgsql security invoker set search_path='' as $$
declare active_room boolean; retained boolean := false;
begin
  if new.room_id is null then return new; end if;
  select r.is_active into active_room from public.plannix_rooms r
  where r.id=new.room_id and r.organisation_id=new.organisation_id for share;
  if not found then
    raise exception using errcode='23503',message='Session room is unavailable for this organisation.';
  end if;
  if tg_op='UPDATE' then
    retained := old.organisation_id=new.organisation_id and old.collection_id=new.collection_id
      and old.room_id=new.room_id;
  else
      -- A dated row is a materialised version of an already assigned repeating
      -- location, not a new room choice. No arbitrary cross-collection copy is
      -- authorised: organisation, year, timetable, week, day, period and class match.
      retained := exists(
        select 1 from public.plannix_timetable_session_collections target
        join public.plannix_timetable_session_collections repeating
          on repeating.timetable_id=target.timetable_id
          and repeating.organisation_id=target.organisation_id
          and repeating.academic_year_id=target.academic_year_id
          and repeating.timetable_week_id=target.timetable_week_id
          and repeating.collection_type='recurring'
        join public.plannix_timetable_sessions s on s.collection_id=repeating.id
        where target.id=new.collection_id and target.collection_type='date_override'
          and target.organisation_id=new.organisation_id and target.academic_year_id=new.academic_year_id
          and target.timetable_id=new.timetable_id and target.timetable_week_id=new.timetable_week_id
          and s.day_number=new.day_number and s.period_id=new.period_id and s.class_id=new.class_id
          and s.room_id=new.room_id);
  end if;
  if not active_room and not coalesce(retained,false) then
    raise exception using errcode='23514',message='Archived rooms cannot be newly assigned.';
  end if;
  return new;
end;
$$;
revoke all on function private.plannix_validate_class_room(),private.plannix_validate_session_room()
from public,anon,authenticated,service_role;
create trigger trg_plannix_classes_room_assignment
after insert or update of default_room_id,organisation_id on public.plannix_classes
for each row execute function private.plannix_validate_class_room();
create trigger trg_plannix_sessions_room_assignment
after insert or update of room_id,organisation_id,collection_id on public.plannix_timetable_sessions
for each row execute function private.plannix_validate_session_room();

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
  class_default_room_id uuid;
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
         where supplied_key.key_name not in ('id', 'name', 'frequency', 'defaultRoomId')
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

    -- Missing means preserve, JSON null explicitly clears. New classes default to null.
    if class_entry ? 'defaultRoomId' then
      if jsonb_typeof(class_entry->'defaultRoomId') not in ('string','null') then
        raise exception using errcode='22023',message='Default room must be a UUID or null.';
      end if;
      begin class_default_room_id := (class_entry->>'defaultRoomId')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode='22023',message='Default room must be a UUID or null.';
      end;
    else
      select c.default_room_id into class_default_room_id from public.plannix_classes c
      where c.id=class_id and c.organisation_id=target_organisation_id
        and c.academic_year_id=target_academic_year_id;
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
      'defaultRoomId', class_default_room_id,
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
    class_default_room_id := (class_entry ->> 'defaultRoomId')::uuid;

    begin
      insert into public.plannix_classes (
        id, organisation_id, academic_year_id, name, frequency, sort_order, default_room_id
      )
      values (
        class_id, target_organisation_id, target_academic_year_id,
        class_name, class_frequency, class_index, class_default_room_id
      )
      on conflict (id) do update
      set
        name = excluded.name,
        frequency = excluded.frequency,
        sort_order = excluded.sort_order,
        default_room_id = excluded.default_room_id,
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
      jsonb_strip_nulls(jsonb_build_object(
        'id', saved_class.id,
        'name', saved_class.name,
        'frequency', saved_class.frequency,
        'defaultRoomId', saved_class.default_room_id
      )) order by saved_class.sort_order, saved_class.id
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

-- Current HTTP/client validators intentionally reject extra legacy session JSON keys.
-- Keep that response unchanged, even when a room exists. Future room-aware callers
-- read this separate, RLS-scoped mapping after a save; no credential or definer bypass.
create function public.plannix_get_timetable_room_assignments(
  target_organisation_id uuid,
  target_academic_year_id uuid,
  target_timetable_id uuid
)
returns table (
  session_id uuid, collection_id uuid, collection_type text,
  timetable_week_id uuid, week_start_date date,
  day integer, period_id uuid, room_id uuid
)
language plpgsql security invoker set search_path = '' stable as $$
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='Authentication is required.';
  end if;
  if not (select private.plannix_is_confirmed_user()) then
    raise exception using errcode='42501',message='Email confirmation is required.';
  end if;
  return query select s.id,s.collection_id,c.collection_type,c.timetable_week_id,
    c.week_start_date,s.day_number-1,s.period_id,s.room_id
  from public.plannix_timetable_sessions s
  join public.plannix_timetable_session_collections c on c.id=s.collection_id
  join public.plannix_timetable_periods p on p.id=s.period_id
  where s.organisation_id=target_organisation_id
    and s.academic_year_id=target_academic_year_id and s.timetable_id=target_timetable_id
  order by c.collection_type,c.week_start_date,c.timetable_week_id,s.day_number,p.sort_order,s.id;
end;
$$;
revoke all on function public.plannix_get_timetable_room_assignments(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.plannix_get_timetable_room_assignments(uuid,uuid,uuid) to authenticated;

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
  session_room_id uuid;
  inherited_room_found boolean;
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
         where key.name not in ('id', 'day', 'periodId', 'classId', 'title', 'notes', 'roomId'))
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
    -- Resolve room before assigning a new ID. Legacy full-collection saves must
    -- not clear an existing room merely because their payload omits the field.
    if session_entry ? 'roomId' then
      if pg_catalog.jsonb_typeof(session_entry->'roomId') not in ('string','null') then
        raise exception using errcode='22023',message='Session room must be a UUID or null.';
      end if;
      begin session_room_id := (session_entry->>'roomId')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode='22023',message='Session room must be a UUID or null.';
      end;
    elsif saved_session_id is not null then
      select s.room_id into session_room_id from public.plannix_timetable_sessions s
      where s.id=saved_session_id and s.collection_id=target_collection_id;
    else
      -- Older dated clients omit inherited IDs and new fields. Copy the effective
      -- recurring assignment (including an explicit absence), not today's default.
      select s.room_id into session_room_id
      from public.plannix_timetable_session_collections target
      join public.plannix_timetable_session_collections repeating
        on repeating.timetable_id=target.timetable_id
        and repeating.timetable_week_id=target.timetable_week_id
        and repeating.collection_type='recurring'
      join public.plannix_timetable_sessions s on s.collection_id=repeating.id
      where target.id=target_collection_id and target.collection_type='date_override'
        and s.day_number=session_day and s.period_id=session_period_id and s.class_id=session_class_id;
      inherited_room_found := found;
      if not inherited_room_found then
        select c.default_room_id into session_room_id from public.plannix_classes c
        where c.id=session_class_id and c.organisation_id=target_organisation_id
          and c.academic_year_id=target_academic_year_id;
      end if;
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
      academic_year_id, organisation_id, day_number, title, notes, room_id
    ) values (
      saved_session_id, target_collection_id, target_timetable_id,
      (
        select session_collection.timetable_week_id
        from public.plannix_timetable_session_collections as session_collection
        where session_collection.id = target_collection_id
      ),
      session_class_id, session_period_id, target_academic_year_id,
      target_organisation_id, session_day, nullif(session_title, ''), nullif(session_notes, ''), session_room_id
    ) on conflict (id) do update set
      timetable_week_id = excluded.timetable_week_id,
      class_id = excluded.class_id,
      room_id = excluded.room_id,
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

-- Existing signatures, invoker security, revision locks and permissions are retained.
revoke all on function public.plannix_save_classes(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.plannix_save_classes(uuid,uuid,bigint,jsonb) to authenticated;
revoke all on function private.plannix_reconcile_session_collection(uuid,uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function private.plannix_reconcile_session_collection(uuid,uuid,uuid,uuid,jsonb) to authenticated;
