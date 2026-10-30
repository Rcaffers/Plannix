begin;

-- This additive migration deliberately starts closed. The old one-argument
-- RPC cannot bypass the shared pause after installation.
create table private.plannix_auth_rate_control (
  singleton boolean primary key default true check (singleton),
  epoch bigint not null default 0 check (epoch >= 0),
  key_tag text check (key_tag ~ '^[0-9a-f]{64}$'),
  active boolean not null default false,
  paused_at timestamptz not null default pg_catalog.clock_timestamp()
);
insert into private.plannix_auth_rate_control(singleton) values (true);
alter table private.plannix_auth_rate_control enable row level security;
revoke all on private.plannix_auth_rate_control from public, anon, authenticated, service_role;
revoke execute on function public.plannix_auth_rate_attempt(jsonb) from service_role;

-- Operator-only SQL functions. They are intentionally outside exposed API
-- schemas and are not callable by the web service role.
create function private.plannix_auth_rate_pause()
returns timestamptz language plpgsql set search_path = '' as $$
declare result timestamptz;
begin
  update private.plannix_auth_rate_control
    set active = false,
      paused_at = case when active then pg_catalog.clock_timestamp() else paused_at end
    where singleton returning paused_at into result;
  if result is null then raise exception 'Rate control is unavailable'; end if;
  return result;
end;
$$;

create function private.plannix_auth_rate_prepare_epoch(new_key_tag text)
returns bigint language plpgsql set search_path = '' as $$
declare result bigint;
begin
  if new_key_tag is null or new_key_tag !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate key tag';
  end if;
  update private.plannix_auth_rate_control
    set epoch = epoch + 1, key_tag = new_key_tag
    where singleton and not active and epoch < 9223372036854775807
    returning epoch into result;
  if result is null then raise exception 'Rate control is unavailable or active'; end if;
  return result;
end;
$$;

create function private.plannix_auth_rate_resume(expected_epoch bigint)
returns boolean language plpgsql set search_path = '' as $$
declare resumed boolean;
begin
  update private.plannix_auth_rate_control
    set active = true
    where singleton and not active and epoch = expected_epoch and epoch > 0
      and pg_catalog.clock_timestamp() >= paused_at + interval '60 seconds'
    returning active into resumed;
  return coalesce(resumed, false);
end;
$$;

revoke all on function private.plannix_auth_rate_pause() from public, anon, authenticated, service_role;
revoke all on function private.plannix_auth_rate_prepare_epoch(text) from public, anon, authenticated, service_role;
revoke all on function private.plannix_auth_rate_resume(bigint) from public, anon, authenticated, service_role;

create function public.plannix_auth_rate_attempt(attempts jsonb, expected_epoch bigint,
  expected_key_tag text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item jsonb; key_value text; maximum integer;
  keys text[] := '{}'; window_value bigint; count_value integer;
  allowed boolean := true; retry_seconds integer; observed_at timestamptz;
  current_epoch bigint; current_key_tag text; is_active boolean;
begin
  if pg_catalog.jsonb_typeof(attempts)<>'array'
    or pg_catalog.jsonb_array_length(attempts)<1
    or pg_catalog.jsonb_array_length(attempts)>3 then
    return pg_catalog.jsonb_build_object('state','invalid');
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(attempts) loop
    if pg_catalog.jsonb_typeof(item)<>'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item))<>2
      or coalesce(item->>'key','') !~ '^[0-9a-f]{64}$'
      or coalesce(item->>'maximum','') !~ '^[1-9][0-9]{0,2}$'
      or (item->>'maximum')::integer>300
      or item->>'key'=any(keys) then
      return pg_catalog.jsonb_build_object('state','invalid');
    end if;
    keys := pg_catalog.array_append(keys,item->>'key');
  end loop;
  -- FOR SHARE allows concurrent claims but makes pause wait for every claim
  -- transaction that already passed this point. A queued claim sees pause.
  select epoch, key_tag, active into current_epoch, current_key_tag, is_active
    from private.plannix_auth_rate_control where singleton for share;
  if current_epoch is null or not is_active or expected_epoch is null
    or current_epoch <> expected_epoch or expected_key_tag is null
    or current_key_tag <> expected_key_tag then
    return pg_catalog.jsonb_build_object('state','unavailable');
  end if;
  for key_value in select pg_catalog.unnest(keys) order by 1 loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(key_value,0));
  end loop;
  observed_at := pg_catalog.clock_timestamp();
  window_value := pg_catalog.floor(extract(epoch from observed_at)/60)::bigint;
  retry_seconds := greatest(1,least(60,
    pg_catalog.ceil((window_value+1)*60-extract(epoch from observed_at))::integer));
  for item in select value from pg_catalog.jsonb_array_elements(attempts) loop
    key_value := item->>'key'; maximum := (item->>'maximum')::integer;
    insert into private.plannix_auth_rate_counters as c
      (key_hash,window_number,attempts,expires_at)
      values (key_value,window_value,1,observed_at+interval '2 minutes')
      on conflict (key_hash,window_number) do update
        set attempts=c.attempts+1
      returning c.attempts into count_value;
    if count_value>maximum then allowed := false; end if;
  end loop;
  delete from private.plannix_auth_rate_counters as c where c.ctid in
    (select old.ctid from private.plannix_auth_rate_counters as old
      where old.expires_at<observed_at order by old.expires_at limit 100);
  return pg_catalog.jsonb_build_object('allowed',allowed,'retry_after',retry_seconds);
end;
$$;
revoke all on function public.plannix_auth_rate_attempt(jsonb,bigint,text)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_rate_attempt(jsonb,bigint,text) to service_role;

commit;
