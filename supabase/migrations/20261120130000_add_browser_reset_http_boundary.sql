-- CLI-owned transaction; no previously applied migration is changed.
set local lock_timeout = '5s';
set local statement_timeout = '120s';
-- Only proof/context hashes, the generation and expiry are retained; no secrets.
create table private.plannix_auth_used_reset_proofs (
  proof_hash text primary key check (proof_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  generation bigint not null,
  context_hash bytea not null check (pg_catalog.octet_length(context_hash)=32)
);
alter table private.plannix_auth_used_reset_proofs enable row level security;
revoke all on private.plannix_auth_used_reset_proofs from public,anon,authenticated,service_role;

create function public.plannix_auth_check_orphan_generation(candidates jsonb)
returns jsonb language plpgsql security definer as $$
declare item jsonb; target_generation bigint; allocated bigint; called boolean;
begin
  -- A function SET clause would restore ALL local GUCs on return, cancelling
  -- the transaction timer before commit. Set the safe path at transaction scope.
  perform pg_catalog.set_config('search_path','',true);
  perform pg_catalog.set_config('lock_timeout','250ms',true);
  -- Fail closed on pre-17 targets; the timer remains local until transaction end.
  perform pg_catalog.set_config('transaction_timeout','1000ms',true);
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed'
    or pg_catalog.jsonb_typeof(candidates) is distinct from 'object' then
    return pg_catalog.jsonb_build_object('state','ineligible');
  end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(candidates))<>2
    or pg_catalog.jsonb_typeof(candidates->'markers') is distinct from 'array'
    or pg_catalog.jsonb_typeof(candidates->'sessions') is distinct from 'array' then
    return pg_catalog.jsonb_build_object('state','ineligible');
  end if;
  if pg_catalog.jsonb_array_length(candidates->'markers')<>0
    or pg_catalog.jsonb_array_length(candidates->'sessions')<>1 then
    return pg_catalog.jsonb_build_object('state','ineligible');
  end if;
  item := candidates->'sessions'->0;
  if pg_catalog.jsonb_typeof(item) is distinct from 'object' then
    return pg_catalog.jsonb_build_object('state','ineligible');
  end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item))<>2
    or item->>'name' is null or item->>'hash' is null
    or item->>'name' !~ '^__Host-plannix-s-[1-9][0-9]{0,15}$'
    or item->>'hash' !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('state','ineligible');
  end if;
  target_generation := pg_catalog.substring(item->>'name','[0-9]+$')::bigint;

  -- No waiting behind a binding/session row lock: NOWAIT avoids reversing the
  -- normal writers' row-lock order. On conflict the subtransaction releases ALL
  -- acquired locks and the caller must leave the cookie untouched.
  lock table private.plannix_auth_browser_bindings in share mode nowait;
  lock table private.plannix_auth_transitions in share mode nowait;
  lock table private.plannix_auth_sessions in share mode nowait;
  -- VOLATILE + READ COMMITTED: these statements get fresh snapshots after locks.
  -- Reject changed sequence configuration rather than assuming allocation order.
  if not exists(select 1 from pg_catalog.pg_sequence
    where seqrelid='private.plannix_auth_generation_seq'::regclass
      and seqincrement=1 and seqmin=1 and seqcache=1 and not seqcycle) then
    return pg_catalog.jsonb_build_object('state','unavailable');
  end if;
  select last_value,is_called into allocated,called from private.plannix_auth_generation_seq;
  if not called or target_generation>allocated
    or exists(select 1 from private.plannix_auth_browser_bindings where generation=target_generation)
    or exists(select 1 from private.plannix_auth_transitions where generation=target_generation)
    or exists(select 1 from private.plannix_auth_sessions where generation=target_generation) then
    return pg_catalog.jsonb_build_object('state','ineligible');
  end if;
  return pg_catalog.jsonb_build_object('state','eligible');
exception when lock_not_available then
  return pg_catalog.jsonb_build_object('state','unavailable');
end;
$$;

revoke all on function public.plannix_auth_check_orphan_generation(jsonb) from public,anon,authenticated;
grant execute on function public.plannix_auth_check_orphan_generation(jsonb) to service_role;

create function public.plannix_auth_reset_orphan_generation(
  candidates jsonb, proof_hash text, proof_expires_at timestamptz)
returns jsonb language plpgsql security definer as $$
declare outcome jsonb;
begin
  -- A function SET clause would restore ALL local GUCs on return, cancelling
  -- the transaction timer before commit. Set the safe path at transaction scope.
  perform pg_catalog.set_config('search_path','',true);
  perform pg_catalog.set_config('lock_timeout','250ms',true);
  -- Set BEFORE locks. Unlike lock_timeout, this kills an active OR idle backend
  -- at the deadline, rolling back and releasing locks even after HTTP disconnect.
  -- Do not put this setting in the function SET clause (which restores on exit).
  perform pg_catalog.set_config('transaction_timeout','1000ms',true);
  if proof_hash is null or proof_hash !~ '^[0-9a-f]{64}$'
    or proof_expires_at is null or proof_expires_at <= pg_catalog.clock_timestamp()
    or proof_expires_at > pg_catalog.clock_timestamp()+interval '2 minutes' then
    return pg_catalog.jsonb_build_object('state','ineligible');
  end if;
  if (candidates #>> '{sessions,0,name}') is null
    or (candidates #>> '{sessions,0,name}') !~ '^__Host-plannix-s-[1-9][0-9]{0,15}$' then
    return pg_catalog.jsonb_build_object('state','ineligible');
  end if;
  -- Require synchronous local WAL durability for the retirement transaction.
  perform pg_catalog.set_config('synchronous_commit','on',true);
  if pg_catalog.current_setting('fsync') <> 'on'
    or pg_catalog.current_setting('full_page_writes') <> 'on' then
    return pg_catalog.jsonb_build_object('state','unavailable');
  end if;
  -- Only expired proofs may be pruned. Their signed expiry still prevents replay.
  delete from private.plannix_auth_used_reset_proofs where expires_at < pg_catalog.clock_timestamp();
  insert into private.plannix_auth_used_reset_proofs values(proof_hash,proof_expires_at,
    pg_catalog.substring(candidates #>> '{sessions,0,name}','[0-9]+$')::bigint,
    pg_catalog.sha256(pg_catalog.convert_to(candidates::text,'UTF8')))
    on conflict do nothing;
  if not found then return pg_catalog.jsonb_build_object('state','ineligible'); end if;
  outcome := public.plannix_auth_retire_orphan_generation(candidates);
  return outcome;
end;
$$;
revoke all on function public.plannix_auth_reset_orphan_generation(jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.plannix_auth_reset_orphan_generation(jsonb,text,timestamptz) to service_role;

-- A separate RPC/transaction must observe BOTH committed rows for this attempt.
-- STABLE allows a genuinely read-only transaction and never exposes cookie data.
create function public.plannix_auth_confirm_orphan_reset(
  candidates jsonb, proof_hash text, proof_expires_at timestamptz)
returns jsonb language sql stable security definer
set search_path = '' set statement_timeout = '1s' as $$
  select pg_catalog.jsonb_build_object('state',case when exists(
    select 1 from private.plannix_auth_used_reset_proofs p
    join private.plannix_auth_retired_generations r on r.generation=p.generation
    where p.proof_hash=$2 and p.expires_at=$3
      and p.expires_at > pg_catalog.clock_timestamp()
      and p.context_hash=pg_catalog.sha256(pg_catalog.convert_to($1::text,'UTF8'))
      and ('__Host-plannix-s-' || p.generation::text)=($1 #>> '{sessions,0,name}')
  ) then 'confirmed' else 'unconfirmed' end);
$$;
revoke all on function public.plannix_auth_confirm_orphan_reset(jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.plannix_auth_confirm_orphan_reset(jsonb,text,timestamptz) to service_role;

-- SELECT-only preflight in the effective API role/transaction. No fixtures.
create function public.plannix_auth_browser_reset_preflight()
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'postgresSupported',pg_catalog.current_setting('server_version_num')::integer >= 170000,
    'fsyncEnabled',pg_catalog.current_setting('fsync')='on',
    'fullPageWritesEnabled',pg_catalog.current_setting('full_page_writes')='on',
    'synchronousCommitEnabled',pg_catalog.current_setting('synchronous_commit')<>'off',
    'primary',not pg_catalog.pg_is_in_recovery());
$$;
revoke all on function public.plannix_auth_browser_reset_preflight() from public,anon,authenticated;
grant execute on function public.plannix_auth_browser_reset_preflight() to service_role;
