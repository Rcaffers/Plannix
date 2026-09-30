begin;

-- This is intentionally separate from the existing school/organisation events model.
create table private.plannix_personal_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organisation_id uuid not null,
  academic_year_id uuid not null,
  owner_organisation_user_id uuid not null,
  event_date date not null,
  title text not null,
  start_time time without time zone,
  end_time time without time zone,
  location text,
  notes text,
  revision bigint not null default 1,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint fk_personal_event_year foreign key (academic_year_id, organisation_id)
    references public.plannix_academic_years(id, organisation_id) on delete cascade,
  constraint fk_personal_event_owner foreign key (owner_organisation_user_id, organisation_id)
    references public.plannix_organisation_users(id, organisation_id) on delete cascade,
  constraint chk_personal_event_times check ((start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and end_time > start_time
      and extract(second from start_time) = 0 and extract(second from end_time) = 0)),
  constraint chk_personal_event_revision check (revision between 1 and 9007199254740991),
  constraint chk_personal_event_lengths check (pg_catalog.length(title) between 1 and 200
    and (location is null or pg_catalog.length(location) between 1 and 200)
    and (notes is null or pg_catalog.length(notes) between 1 and 2000))
);
alter table private.plannix_personal_events enable row level security;
revoke all on table private.plannix_personal_events from public, anon, authenticated;
create index idx_personal_events_year_date on private.plannix_personal_events
  (academic_year_id, event_date, start_time, title, id);
create index idx_personal_events_owner_year on private.plannix_personal_events
  (owner_organisation_user_id, academic_year_id);

-- Text arrives as data, never markup. These Cf code points match Unicode 16
-- (Node 24's \p{Cf}); PostgreSQL's [[:cntrl:]] handles Cc. Review this list
-- when the JavaScript runtime's Unicode version changes. U+2065 is unassigned,
-- so it is intentionally excluded. Line breaks are allowed only in notes.
create function private.plannix_normalize_event_text(raw text, max_chars integer, multiline boolean)
returns text language plpgsql immutable set search_path = '' as $$
declare cleaned text; probe text;
begin
  if raw is null then return null; end if;
  if raw ~ U&'[\00AD\0600-\0605\061C\06DD\070F\0890-\0891\08E2\180E\200B-\200F\202A-\202E\2060-\2064\2066-\206F\FEFF\FFF9-\FFFB]'
    or raw ~ U&'[\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0001\+0E0020-\+0E007F]' then
    raise exception using errcode='22023', message='Event text contains unsupported characters.';
  end if;
  cleaned := pg_catalog.normalize(raw, 'NFC');
  if multiline then
    cleaned := pg_catalog.replace(pg_catalog.replace(cleaned, E'\r\n', E'\n'), E'\r', E'\n');
    cleaned := pg_catalog.replace(cleaned, E'\t', ' ');
    probe := pg_catalog.replace(cleaned, E'\n', '');
    if probe ~ '[[:cntrl:]]' then raise exception using errcode='22023', message='Event text contains unsupported characters.'; end if;
    cleaned := pg_catalog.regexp_replace(cleaned,
      U&'^[\000A\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+|[\000A\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+$', '', 'g');
  else
    if cleaned ~ '[[:cntrl:]]' or cleaned ~ '[<>`]' then
      raise exception using errcode='22023', message='Event text contains unsupported characters.';
    end if;
    cleaned := pg_catalog.btrim(pg_catalog.regexp_replace(cleaned,
      U&'[\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+', ' ', 'g'));
  end if;
  if cleaned = '' then return null; end if;
  if pg_catalog.length(cleaned) > max_chars then
    raise exception using errcode='22023', message='Event text is too long.';
  end if;
  return cleaned;
end;
$$;
revoke all on function private.plannix_normalize_event_text(text,integer,boolean) from public, anon, authenticated;

create function private.plannix_event_clock(value text)
returns time without time zone language plpgsql immutable set search_path = '' as $$
begin
  if value is null then return null; end if;
  if value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception using errcode='22023', message='Event time must use HH:MM.';
  end if;
  return value::time without time zone;
end;
$$;
revoke all on function private.plannix_event_clock(text) from public, anon, authenticated;

create function private.plannix_event_title_key(value text)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.normalize(value, 'NFC'),
    U&'[\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+', ' ', 'g')));
$$;
revoke all on function private.plannix_event_title_key(text) from public, anon, authenticated;
create unique index uq_personal_event_identity on private.plannix_personal_events
  (academic_year_id, event_date, private.plannix_event_title_key(title), start_time, end_time) nulls not distinct;

-- Called only by the authenticated, SECURITY DEFINER entry points below.
create function private.plannix_personal_event_scope(target_year uuid, lock_year boolean default false)
returns table (organisation_id uuid, membership_id uuid, year_start date, year_end date)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null or not exists (select 1 from auth.users as u
    where u.id=caller and u.email_confirmed_at is not null) then
    raise exception using errcode='42501', message='Confirmed authentication is required.';
  end if;
  if target_year is null then raise exception using errcode='22023', message='Academic year is required.'; end if;
  if lock_year then
    return query select p.organisation_id, m.id, y.start_date, y.end_date
      from private.plannix_personal_organisations as p
      join public.plannix_organisations as o on o.id=p.organisation_id and o.organisation_type='personal'
      join public.plannix_organisation_users as m on m.organisation_id=p.organisation_id and m.user_id=caller
      join public.plannix_academic_years as y on y.id=target_year and y.organisation_id=p.organisation_id
      where p.user_id=caller for update of y;
  else
    return query select p.organisation_id, m.id, y.start_date, y.end_date
      from private.plannix_personal_organisations as p
      join public.plannix_organisations as o on o.id=p.organisation_id and o.organisation_type='personal'
      join public.plannix_organisation_users as m on m.organisation_id=p.organisation_id and m.user_id=caller
      join public.plannix_academic_years as y on y.id=target_year and y.organisation_id=p.organisation_id
      where p.user_id=caller;
  end if;
  if not found then raise exception using errcode='P0002', message='Academic year was not found.'; end if;
end;
$$;
revoke all on function private.plannix_personal_event_scope(uuid,boolean) from public, anon, authenticated;

-- The year row is the single lock for event inserts and boundary changes.
create function private.plannix_check_personal_event_boundaries()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date)
    and exists (select 1 from private.plannix_personal_events as e
      where e.academic_year_id=new.id and (e.event_date < new.start_date or e.event_date > new.end_date)) then
    raise exception using errcode='P1002', message='Academic-year dates would exclude existing events.';
  end if;
  return new;
end;
$$;
revoke all on function private.plannix_check_personal_event_boundaries() from public, anon, authenticated;
create trigger trg_personal_event_year_boundaries before update of start_date,end_date
  on public.plannix_academic_years for each row
  execute function private.plannix_check_personal_event_boundaries();

create function private.plannix_event_json(e private.plannix_personal_events)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('id',e.id,'academicYearId',e.academic_year_id,
    'date',e.event_date,'title',e.title,'startTime',pg_catalog.left(e.start_time::text,5),
    'endTime',pg_catalog.left(e.end_time::text,5),'location',e.location,'notes',e.notes,'revision',e.revision);
$$;
revoke all on function private.plannix_event_json(private.plannix_personal_events) from public, anon, authenticated;

create function public.plannix_list_personal_events(target_academic_year_id uuid, date_from date default null, date_to date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare scope record; result jsonb;
begin
  select * into strict scope from private.plannix_personal_event_scope(target_academic_year_id, false);
  if (date_from is null) <> (date_to is null) or (date_from is not null and
    (date_from > date_to or date_to - date_from > 31)) then
    raise exception using errcode='22023', message='Event date filters are invalid.';
  end if;
  select coalesce(pg_catalog.jsonb_agg(private.plannix_event_json(e)
    order by e.event_date, (e.start_time is not null), e.start_time, private.plannix_event_title_key(e.title), e.id), '[]'::jsonb)
    into result from private.plannix_personal_events as e
    where e.academic_year_id=target_academic_year_id and e.organisation_id=scope.organisation_id
      and e.owner_organisation_user_id=scope.membership_id
      and (date_from is null or e.event_date between date_from and date_to);
  return result;
end;
$$;

create function public.plannix_create_personal_event(target_academic_year_id uuid, target_date date,
  target_title text, target_start_time text, target_end_time text,
  target_location text, target_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare scope record; clean_title text; clean_location text; clean_notes text;
  start_at time without time zone; end_at time without time zone; saved private.plannix_personal_events;
begin
  select * into strict scope from private.plannix_personal_event_scope(target_academic_year_id, true);
  if target_date is null or scope.year_start is null or scope.year_end is null
    or target_date not between scope.year_start and scope.year_end then
    raise exception using errcode='22023', message='Event date must be within the academic year.';
  end if;
  start_at := private.plannix_event_clock(target_start_time);
  end_at := private.plannix_event_clock(target_end_time);
  if (start_at is null) <> (end_at is null) or
    (start_at is not null and end_at <= start_at) then
    raise exception using errcode='22023', message='Event times must be paired and increasing.';
  end if;
  clean_title := private.plannix_normalize_event_text(target_title,200,false);
  clean_location := private.plannix_normalize_event_text(target_location,200,false);
  clean_notes := private.plannix_normalize_event_text(target_notes,2000,true);
  if clean_title is null or (target_location is not null and clean_location is null and pg_catalog.btrim(target_location) <> '') then
    raise exception using errcode='22023', message='Event title or location is invalid.';
  end if;
  if (select pg_catalog.count(*) from private.plannix_personal_events as e
    where e.academic_year_id=target_academic_year_id) >= 500 then
    raise exception using errcode='P1001', message='Academic year may contain no more than 500 events.';
  end if;
  insert into private.plannix_personal_events (organisation_id,academic_year_id,owner_organisation_user_id,
    event_date,title,start_time,end_time,location,notes)
  values (scope.organisation_id,target_academic_year_id,scope.membership_id,target_date,clean_title,
    start_at,end_at,clean_location,clean_notes) returning * into saved;
  return private.plannix_event_json(saved);
end;
$$;

create function public.plannix_update_personal_event(target_event_id uuid, expected_revision bigint,
  target_date date, target_title text, target_start_time text,
  target_end_time text, target_location text, target_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare year_id uuid; scope record; start_at time without time zone; end_at time without time zone;
  saved private.plannix_personal_events;
begin
  if target_event_id is null or expected_revision is null or expected_revision < 1 then
    raise exception using errcode='22023', message='Event ID and revision are required.';
  end if;
  select e.academic_year_id into year_id from private.plannix_personal_events as e where e.id=target_event_id;
  if year_id is null then raise exception using errcode='P0002', message='Event was not found.'; end if;
  -- Lock year before event; creates, updates and year-boundary changes share this order.
  select * into strict scope from private.plannix_personal_event_scope(year_id, true);
  if target_date is null or target_date not between scope.year_start and scope.year_end then
    raise exception using errcode='22023', message='Event date must be within the academic year.';
  end if;
  start_at := private.plannix_event_clock(target_start_time);
  end_at := private.plannix_event_clock(target_end_time);
  if (start_at is null) <> (end_at is null) or
    (start_at is not null and end_at <= start_at) then
    raise exception using errcode='22023', message='Event times must be paired and increasing.';
  end if;
  update private.plannix_personal_events as e set event_date=target_date,
    title=private.plannix_normalize_event_text(target_title,200,false),
    start_time=start_at,end_time=end_at,
    location=private.plannix_normalize_event_text(target_location,200,false),
    notes=private.plannix_normalize_event_text(target_notes,2000,true),
    revision=e.revision+1,updated_at=pg_catalog.now()
    where e.id=target_event_id and e.academic_year_id=year_id
      and e.organisation_id=scope.organisation_id and e.owner_organisation_user_id=scope.membership_id
      and e.revision=expected_revision returning * into saved;
  if found then return private.plannix_event_json(saved); end if;
  if exists (select 1 from private.plannix_personal_events as e where e.id=target_event_id
    and e.academic_year_id=year_id and e.organisation_id=scope.organisation_id
    and e.owner_organisation_user_id=scope.membership_id) then
    raise exception using errcode='40001', message='Event changed since it was loaded.';
  end if;
  raise exception using errcode='P0002', message='Event was not found.';
end;
$$;

create function public.plannix_delete_personal_event(target_event_id uuid, expected_revision bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare year_id uuid; scope record;
begin
  if target_event_id is null or expected_revision is null or expected_revision < 1 then
    raise exception using errcode='22023', message='Event ID and revision are required.';
  end if;
  select e.academic_year_id into year_id from private.plannix_personal_events as e where e.id=target_event_id;
  if year_id is null then raise exception using errcode='P0002', message='Event was not found.'; end if;
  select * into strict scope from private.plannix_personal_event_scope(year_id, true);
  delete from private.plannix_personal_events as e where e.id=target_event_id and e.academic_year_id=year_id
    and e.organisation_id=scope.organisation_id and e.owner_organisation_user_id=scope.membership_id
    and e.revision=expected_revision;
  if found then return true; end if;
  if exists (select 1 from private.plannix_personal_events as e where e.id=target_event_id
    and e.academic_year_id=year_id and e.organisation_id=scope.organisation_id
    and e.owner_organisation_user_id=scope.membership_id) then
    raise exception using errcode='40001', message='Event changed since it was loaded.';
  end if;
  raise exception using errcode='P0002', message='Event was not found.';
end;
$$;

revoke all on function public.plannix_list_personal_events(uuid,date,date),
  public.plannix_create_personal_event(uuid,date,text,text,text,text,text),
  public.plannix_update_personal_event(uuid,bigint,date,text,text,text,text,text),
  public.plannix_delete_personal_event(uuid,bigint) from public, anon;
grant execute on function public.plannix_list_personal_events(uuid,date,date),
  public.plannix_create_personal_event(uuid,date,text,text,text,text,text),
  public.plannix_update_personal_event(uuid,bigint,date,text,text,text,text,text),
  public.plannix_delete_personal_event(uuid,bigint) to authenticated;

comment on table private.plannix_personal_events is 'Personal, single-day events owned through the authoritative personal organisation mapping. Dates and times are local calendar values; no UTC conversion occurs.';
commit;
