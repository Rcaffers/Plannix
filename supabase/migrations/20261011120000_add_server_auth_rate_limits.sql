begin;

-- One fixed, database-clock minute per opaque HMAC key. Browser roles cannot
-- inspect counters or call the privileged claim function.
create table private.plannix_auth_rate_counters (
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_number bigint not null,
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null,
  primary key (key_hash, window_number)
);
create index plannix_auth_rate_counters_expiry
  on private.plannix_auth_rate_counters(expires_at);
alter table private.plannix_auth_rate_counters enable row level security;
revoke all on private.plannix_auth_rate_counters from public, anon, authenticated, service_role;

create function public.plannix_auth_rate_attempt(attempts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item jsonb; key_value text; maximum integer;
  keys text[] := '{}'; window_value bigint; count_value integer;
  allowed boolean := true; retry_seconds integer; observed_at timestamptz;
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
  -- Acquire every key in stable order. Evaluate the clock only after waits.
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
  -- Work per call is bounded. Active traffic drains expired rows; operations
  -- can also run the separate privileged cleanup during quiet periods.
  delete from private.plannix_auth_rate_counters as c where c.ctid in
    (select old.ctid from private.plannix_auth_rate_counters as old
      where old.expires_at<observed_at order by old.expires_at limit 100);
  return pg_catalog.jsonb_build_object('allowed',allowed,'retry_after',retry_seconds);
end;
$$;
revoke all on function public.plannix_auth_rate_attempt(jsonb)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_rate_attempt(jsonb) to service_role;

create function public.plannix_auth_rate_cleanup(max_rows integer default 1000)
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if max_rows is null or max_rows<1 or max_rows>1000 then return 0; end if;
  delete from private.plannix_auth_rate_counters as c where c.ctid in
    (select old.ctid from private.plannix_auth_rate_counters as old
      where old.expires_at<pg_catalog.clock_timestamp()
      order by old.expires_at limit max_rows);
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.plannix_auth_rate_cleanup(integer)
  from public, anon, authenticated;
grant execute on function public.plannix_auth_rate_cleanup(integer) to service_role;

commit;
