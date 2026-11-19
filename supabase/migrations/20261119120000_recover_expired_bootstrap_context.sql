-- CLI-owned transaction. Ordinary selection remains strictly unchanged.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Bootstrap alone may discard verified terminal credentials. This never selects
-- a user/session or grants application access. The route attempts only exact-name
-- cleanup; a later explicit request must bootstrap from the latest cookies.
-- Do not issue a replacement marker in the cleanup response: it may be late.
create function public.plannix_auth_select_bootstrap(candidates jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare result jsonb; markers jsonb; sessions jsonb; item jsonb;
  binding private.plannix_auth_browser_bindings%rowtype;
  session_record private.plannix_auth_sessions%rowtype;
  binding_ids uuid[] := '{}'; names text[] := '{}'; cleanup text[] := '{}';
begin
  result := public.plannix_auth_select(candidates);
  markers := candidates->'markers'; sessions := candidates->'sessions';
  if pg_catalog.jsonb_typeof(markers) is distinct from 'array'
    or pg_catalog.jsonb_typeof(sessions) is distinct from 'array' then return result; end if;

  -- The strict selector verifies ALL supplied secrets before emitting terminal
  -- marker cleanup. With one marker, every verified session belongs to it.
  if pg_catalog.jsonb_array_length(markers)=1
    and result->>'state' in ('expired','invalid')
    and result->'cleanup'=pg_catalog.jsonb_build_array(markers->0->>'name') then
    cleanup := pg_catalog.array_append(cleanup,markers->0->>'name');
    for item in select value from pg_catalog.jsonb_array_elements(sessions) loop
      cleanup := pg_catalog.array_append(cleanup,item->>'name');
    end loop;
    return pg_catalog.jsonb_build_object('state','terminal','cleanup',pg_catalog.to_jsonb(cleanup));
  end if;
  if pg_catalog.jsonb_array_length(markers)<>0
    or pg_catalog.jsonb_array_length(sessions) not between 1 and 8 then return result; end if;

  -- Natural browser expiry can remove the older marker while a later session
  -- cookie remains. Unknown, forged, duplicate or live orphan credentials must
  -- still fail closed, without cleanup or a replacement binding.
  for item in select value from pg_catalog.jsonb_array_elements(sessions) loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item))<>2
      or item->>'name' is null or item->>'hash' is null
      or item->>'name' !~ '^__Host-plannix-[sr]-[1-9][0-9]{0,15}$'
      or item->>'hash' !~ '^[0-9a-f]{64}$' or item->>'name'=any(names) then return result; end if;
    names := pg_catalog.array_append(names,item->>'name');
    select * into session_record from private.plannix_auth_sessions as s
      where s.generation=pg_catalog.substring(item->>'name','[0-9]+$')::bigint
        and s.secret_hash=item->>'hash'
        and s.kind=case when item->>'name' like '__Host-plannix-s-%' then 'ordinary' else 'recovery' end;
    if not found then return result; end if;
    if pg_catalog.cardinality(binding_ids)>0 and session_record.binding_id<>binding_ids[1] then
      return result; -- Never merge or discard distinct browser contexts.
    end if;
    binding_ids := pg_catalog.array_append(binding_ids,session_record.binding_id);
  end loop;
  -- Same binding-before-session order as ordinary selection and auth settlement.
  for binding in select * from private.plannix_auth_browser_bindings as b
    where b.id=any(binding_ids) order by b.generation for update loop
    if not binding.revoked and not binding.expired
      and binding.expires_at>pg_catalog.clock_timestamp() then return result; end if;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(sessions)
    order by pg_catalog.substring(value->>'name','[0-9]+$')::bigint loop
    select * into session_record from private.plannix_auth_sessions as s
      where s.generation=pg_catalog.substring(item->>'name','[0-9]+$')::bigint
        and s.secret_hash=item->>'hash' and s.binding_id=any(binding_ids)
        and s.kind=case when item->>'name' like '__Host-plannix-s-%' then 'ordinary' else 'recovery' end for update;
    if not found or not exists(select 1 from private.plannix_auth_browser_bindings as b
      where b.id=session_record.binding_id and (b.revoked or b.expired or b.expires_at<=pg_catalog.clock_timestamp())) then return result; end if;
  end loop;
  -- All credentials were reverified under the binding/session locks. Persist
  -- observed expiry before cleanup so a clock correction cannot revive it.
  if binding.id is null then return result; end if;
  if not binding.revoked then
    if private.plannix_auth_observe_expiry(binding) is distinct from true then return result; end if;
  end if;
  return pg_catalog.jsonb_build_object('state','terminal','cleanup',pg_catalog.to_jsonb(names));
end;
$$;
revoke all on function public.plannix_auth_select_bootstrap(jsonb) from public, anon, authenticated;
grant execute on function public.plannix_auth_select_bootstrap(jsonb) to service_role;
