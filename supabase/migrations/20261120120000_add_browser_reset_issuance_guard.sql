-- CLI-owned transaction. Install before any reset UI/server integration.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Permanent, owner-only negative authority. Never prune: sequence reset/explicit
-- insertion must not make a retired cookie name valid again.
create table private.plannix_auth_retired_generations (
  generation bigint primary key check (generation between 1 and 9999999999999999),
  retired_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table private.plannix_auth_retired_generations enable row level security;
revoke all on private.plannix_auth_retired_generations from public, anon, authenticated, service_role;

create function private.plannix_auth_reject_retired_generation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- A repeatable-read writer could otherwise miss a retirement committed after
  -- its transaction snapshot. Ordinary auth uses READ COMMITTED. Fail closed
  -- for unsupported isolation rather than permitting stale issuance.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='P2011', message='Authentication issuance isolation is unsupported.';
  end if;
  if exists(select 1 from private.plannix_auth_retired_generations r
    where r.generation=new.generation) then
    raise exception using errcode='P2010', message='Authentication generation is retired.';
  end if;
  return new;
end;
$$;
revoke all on function private.plannix_auth_reject_retired_generation() from public, anon, authenticated, service_role;

-- Table locks held by the guard conflict with every INSERT/UPDATE, even before
-- these BEFORE triggers run. Existing writers need no new advisory-lock order.
create trigger plannix_auth_binding_retirement_fence
before insert or update of generation on private.plannix_auth_browser_bindings
for each row execute function private.plannix_auth_reject_retired_generation();
create trigger plannix_auth_transition_retirement_fence
before insert or update of generation on private.plannix_auth_transitions
for each row execute function private.plannix_auth_reject_retired_generation();
create trigger plannix_auth_session_retirement_fence
before insert or update of generation on private.plannix_auth_sessions
for each row execute function private.plannix_auth_reject_retired_generation();

-- This does not verify a secret, authenticate, revoke a session or clear cookies.
-- The future HTTP boundary must parse the CURRENT cookie collection, bind an
-- explicit reset proof to it, and call this only for the explicit reset action.
create function public.plannix_auth_retire_orphan_generation(candidates jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '250ms' as $$
declare item jsonb; target_generation bigint; allocated bigint; called boolean;
begin
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
  insert into private.plannix_auth_retired_generations(generation) values(target_generation)
    on conflict do nothing;
  return pg_catalog.jsonb_build_object('state','retired');
exception when lock_not_available then
  return pg_catalog.jsonb_build_object('state','unavailable');
end;
$$;
revoke all on function public.plannix_auth_retire_orphan_generation(jsonb) from public, anon, authenticated;
grant execute on function public.plannix_auth_retire_orphan_generation(jsonb) to service_role;
