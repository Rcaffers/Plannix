begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(id,email,email_confirmed_at)
  values ('dd000000-0000-4000-8000-000000000076','stage3-claim@example.test',pg_catalog.now());

-- A test-only delay after the first eligibility check reproduces a claim
-- crossing a deadline inside plannix_auth_begin. The transaction rolls it back.
create function private.plannix_auth_test_claim_delay() returns trigger
language plpgsql as $$
begin
  if old.id::text=pg_catalog.current_setting('test.claim_delay_intent',true) then
    perform pg_catalog.pg_sleep(0.15);
  end if;
  return new;
end;
$$;
create trigger plannix_auth_test_claim_delay before update of state
  on private.plannix_auth_transitions for each row
  when (old.state='pending' and new.state='superseded')
  execute function private.plannix_auth_test_claim_delay();

create function private.plannix_auth_test_claim_case(target text) returns jsonb
language plpgsql as $$
declare fixture_hash text := pg_catalog.repeat(target,64);
  marker text; parent uuid; child uuid; original_session uuid;
  session_name text; session_hash text := pg_catalog.repeat(target,64);
  claim jsonb; settled jsonb; retry jsonb; fixture_binding_id uuid;
  kind text := case when target='6' then 'recovery' else 'confirmation' end;
  owner uuid := 'dd000000-0000-4000-8000-000000000076';
begin
  marker := public.plannix_auth_issue_binding(fixture_hash)->>'name';
  select id into fixture_binding_id from private.plannix_auth_browser_bindings
    where marker_hash=fixture_hash;
  if target in ('4','7') then
    parent := (public.plannix_auth_begin(marker,fixture_hash,'ordinary')->>'intentId')::uuid;
    perform public.plannix_auth_settle(parent,'created',owner,session_hash,'{}','{}');
    select id,'__Host-plannix-s-' || generation into original_session,session_name
      from private.plannix_auth_sessions where binding_id=fixture_binding_id;
  end if;
  parent := (public.plannix_auth_begin(marker,fixture_hash,
    case when kind='recovery' then 'recovery' else 'ordinary' end,
    session_name,case when session_name is null then null else session_hash end)
    ->>'intentId')::uuid;
  perform public.plannix_auth_reserve_callback(marker,fixture_hash,fixture_hash,kind,parent);
  perform public.plannix_auth_attach_callback(marker,fixture_hash,fixture_hash,kind,
    pg_catalog.repeat('a',32),'{}');
  perform public.plannix_auth_ready_callback(marker,fixture_hash,fixture_hash,kind);
  if target in ('1','2','3','4','7') then
    if target in ('1','7') then
      update private.plannix_auth_callbacks
        set expires_at=pg_catalog.clock_timestamp()+interval '50 milliseconds'
        where state_hash=fixture_hash;
    elsif target='2' then
      update private.plannix_auth_transitions
        set expires_at=pg_catalog.clock_timestamp()+interval '50 milliseconds'
        where id=parent;
    elsif target='3' then
      update private.plannix_auth_browser_bindings
        set expires_at=pg_catalog.clock_timestamp()+interval '50 milliseconds'
        where id=fixture_binding_id;
    else
      update private.plannix_auth_sessions
        set expires_at=pg_catalog.clock_timestamp()+interval '50 milliseconds'
        where id=original_session;
    end if;
    perform pg_catalog.set_config('test.claim_delay_intent',parent::text,true);
  else
    perform pg_catalog.set_config('test.claim_delay_intent','',true);
  end if;
  claim := public.plannix_auth_claim_callback(marker,fixture_hash,fixture_hash,
    pg_catalog.repeat('a',32),kind,session_name,
    case when session_name is null then null else session_hash end);
  select id into child from private.plannix_auth_transitions
    where binding_id=fixture_binding_id and id<>parent and id is distinct from original_session
    order by generation desc limit 1;
  if target='8' then
    update private.plannix_auth_callbacks
      set expires_at=pg_catalog.clock_timestamp()-interval '1 second'
      where state_hash=fixture_hash;
  elsif target='9' then
    update private.plannix_auth_transitions
      set expires_at=pg_catalog.clock_timestamp()-interval '1 second'
      where id=child;
  end if;
  if child is not null then
    settled := public.plannix_auth_settle(child,'created',owner,
      fixture_hash,'{}','{}');
  end if;
  if target in ('1','2','3','4','7') then
    update private.plannix_auth_callbacks
      set expires_at=pg_catalog.clock_timestamp()+interval '1 hour'
      where state_hash=fixture_hash;
    update private.plannix_auth_transitions
      set expires_at=pg_catalog.clock_timestamp()+interval '1 hour'
      where id in (parent,child);
    update private.plannix_auth_browser_bindings
      set expires_at=pg_catalog.clock_timestamp()+interval '1 hour'
      where id=fixture_binding_id;
    retry := public.plannix_auth_claim_callback(marker,fixture_hash,fixture_hash,
      pg_catalog.repeat('a',32),kind,session_name,
      case when session_name is null then null else session_hash end);
  end if;
  return pg_catalog.jsonb_build_object(
    'claim',claim->>'state','verifier',claim ? 'verifierEnvelope',
    'settle',settled->>'state','retry',retry->>'state',
    'parent',(select state from private.plannix_auth_transitions where id=parent),
    'child',(select state from private.plannix_auth_transitions where id=child),
    'currentPreserved',(select current_session_id is not distinct from original_session
      from private.plannix_auth_browser_bindings where id=fixture_binding_id),
    'originalActive',(select not revoked and not expired
      from private.plannix_auth_sessions where id=original_session));
end;
$$;

select pg_catalog.set_config('test.claim_callback',
  private.plannix_auth_test_claim_case('1')::text,true);
select extensions.is(pg_catalog.current_setting('test.claim_callback')::jsonb->>'claim','invalid',
  'callback deadline crossed during exchange creation rejects claim');
select extensions.is(pg_catalog.current_setting('test.claim_callback')::jsonb->>'settle','expired',
  'provisional exchange cannot settle after callback cutoff');
select extensions.is(pg_catalog.current_setting('test.claim_callback')::jsonb->>'parent','expired',
  'callback cutoff terminally expires initiation');
select extensions.is(pg_catalog.current_setting('test.claim_callback')::jsonb->>'retry','invalid',
  'later deadline extension cannot revive callback');

select pg_catalog.set_config('test.claim_parent',
  private.plannix_auth_test_claim_case('2')::text,true);
select extensions.is(pg_catalog.current_setting('test.claim_parent')::jsonb->>'claim','invalid',
  'initiating transition cutoff during exchange creation rejects claim');
select extensions.is(pg_catalog.current_setting('test.claim_parent')::jsonb->>'settle','expired',
  'provisional exchange cannot settle after initiating cutoff');
select extensions.is(pg_catalog.current_setting('test.claim_parent')::jsonb->>'retry','invalid',
  'expired initiation remains terminal after deadline extension');

select pg_catalog.set_config('test.claim_binding',
  private.plannix_auth_test_claim_case('3')::text,true);
select extensions.is(pg_catalog.current_setting('test.claim_binding')::jsonb->>'claim','invalid',
  'binding cutoff during exchange creation rejects claim');
select extensions.is(pg_catalog.current_setting('test.claim_binding')::jsonb->>'settle','expired',
  'provisional exchange cannot settle after binding cutoff');
select extensions.is(pg_catalog.current_setting('test.claim_binding')::jsonb->>'retry','invalid',
  'observed binding expiry cannot revive');

select pg_catalog.set_config('test.claim_session',
  private.plannix_auth_test_claim_case('4')::text,true);
select extensions.is(pg_catalog.current_setting('test.claim_session')::jsonb->>'claim','invalid',
  'initiating session cutoff during exchange creation rejects claim');
select extensions.is(pg_catalog.current_setting('test.claim_session')::jsonb->>'settle','expired',
  'provisional exchange cannot settle after session cutoff');
select extensions.is(pg_catalog.current_setting('test.claim_session')::jsonb->>'currentPreserved','true',
  'failed replacement retains authoritative session identity');

select pg_catalog.set_config('test.claim_signed_in',
  private.plannix_auth_test_claim_case('7')::text,true);
select extensions.is(pg_catalog.current_setting('test.claim_signed_in')::jsonb->>'claim','invalid',
  'signed-in callback cutoff during exchange creation rejects claim');
select extensions.is(pg_catalog.current_setting('test.claim_signed_in')::jsonb->>'verifier','false',
  'expired signed-in claim returns no verifier');
select extensions.is(pg_catalog.current_setting('test.claim_signed_in')::jsonb->>'settle','expired',
  'expired signed-in provisional exchange cannot settle');
select extensions.is(pg_catalog.current_setting('test.claim_signed_in')::jsonb->>'currentPreserved','true',
  'expired signed-in claim retains current session identity');
select extensions.is(pg_catalog.current_setting('test.claim_signed_in')::jsonb->>'originalActive','true',
  'expired signed-in claim does not revoke valid original session');

select pg_catalog.set_config('test.claim_confirmation',
  private.plannix_auth_test_claim_case('5')::text,true);
select extensions.is(pg_catalog.current_setting('test.claim_confirmation')::jsonb->>'claim','claimed',
  'non-expired confirmation claims normally');
select extensions.is(pg_catalog.current_setting('test.claim_confirmation')::jsonb->>'settle','created',
  'valid confirmation exchange settles');
select extensions.is(pg_catalog.current_setting('test.claim_confirmation')::jsonb->>'verifier','true',
  'valid claim alone returns the verifier');

select pg_catalog.set_config('test.claim_recovery',
  private.plannix_auth_test_claim_case('6')::text,true);
select extensions.is(pg_catalog.current_setting('test.claim_recovery')::jsonb->>'claim','claimed',
  'non-expired recovery claims normally');
select extensions.is(pg_catalog.current_setting('test.claim_recovery')::jsonb->>'settle','created',
  'valid recovery exchange settles');

select pg_catalog.set_config('test.claim_after_callback_cutoff',
  private.plannix_auth_test_claim_case('8')::text,true);
select extensions.is(pg_catalog.current_setting('test.claim_after_callback_cutoff')::jsonb->>'claim','claimed',
  'callback was valid through claim completion');
select extensions.is(pg_catalog.current_setting('test.claim_after_callback_cutoff')::jsonb->>'settle','created',
  'claimed exchange may finish after original callback cutoff');

select pg_catalog.set_config('test.claim_after_exchange_cutoff',
  private.plannix_auth_test_claim_case('9')::text,true);
select extensions.is(pg_catalog.current_setting('test.claim_after_exchange_cutoff')::jsonb->>'claim','claimed',
  'exchange deadline fixture claims while callback is valid');
select extensions.is(pg_catalog.current_setting('test.claim_after_exchange_cutoff')::jsonb->>'settle','expired',
  'exchange cannot settle after its own two-minute deadline');

create function private.plannix_auth_test_early_delay() returns trigger
language plpgsql as $$
begin
  if old.state_hash=pg_catalog.current_setting('test.early_delay_state',true) then
    perform pg_catalog.pg_sleep(0.15);
  end if;
  return new;
end;
$$;
create trigger plannix_auth_test_early_delay before update of flow_id,ready_at
  on private.plannix_auth_callbacks for each row
  execute function private.plannix_auth_test_early_delay();

create function private.plannix_auth_test_early_case(phase text) returns jsonb
language plpgsql as $$
declare fixture_hash text := pg_catalog.repeat(phase,64);
  marker text; parent uuid; result jsonb; claimed jsonb;
begin
  marker := public.plannix_auth_issue_binding(fixture_hash)->>'name';
  parent := (public.plannix_auth_begin(marker,fixture_hash,'ordinary')->>'intentId')::uuid;
  perform public.plannix_auth_reserve_callback(marker,fixture_hash,fixture_hash,
    'confirmation',parent);
  if phase='b' then
    perform public.plannix_auth_attach_callback(marker,fixture_hash,fixture_hash,
      'confirmation',pg_catalog.repeat('a',32),'{}');
    update private.plannix_auth_callbacks
      set expires_at=pg_catalog.clock_timestamp()+interval '50 milliseconds'
      where state_hash=fixture_hash;
  else
    update private.plannix_auth_transitions
      set expires_at=pg_catalog.clock_timestamp()+interval '50 milliseconds'
      where id=parent;
  end if;
  perform pg_catalog.set_config('test.early_delay_state',fixture_hash,true);
  if phase='b' then
    result := public.plannix_auth_ready_callback(marker,fixture_hash,fixture_hash,'confirmation');
  else
    result := public.plannix_auth_attach_callback(marker,fixture_hash,fixture_hash,
      'confirmation',pg_catalog.repeat('a',32),'{}');
  end if;
  claimed := public.plannix_auth_claim_callback(marker,fixture_hash,fixture_hash,
    pg_catalog.repeat('a',32),'confirmation',null,null);
  return pg_catalog.jsonb_build_object('result',result->>'state','claim',claimed->>'state',
    'parent',(select state from private.plannix_auth_transitions where id=parent),
    'cancelled',(select cancelled_at is not null from private.plannix_auth_callbacks
      where state_hash=fixture_hash));
end;
$$;

select pg_catalog.set_config('test.early_attach',
  private.plannix_auth_test_early_case('a')::text,true);
select extensions.is(pg_catalog.current_setting('test.early_attach')::jsonb->>'result','invalid',
  'attachment delayed across initiating expiry fails');
select extensions.is(pg_catalog.current_setting('test.early_attach')::jsonb->>'parent','expired',
  'delayed attachment observes terminal initiation expiry');
select extensions.is(pg_catalog.current_setting('test.early_attach')::jsonb->>'claim','invalid',
  'delayed attachment cannot later claim');

select pg_catalog.set_config('test.early_ready',
  private.plannix_auth_test_early_case('b')::text,true);
select extensions.is(pg_catalog.current_setting('test.early_ready')::jsonb->>'result','invalid',
  'readiness delayed across callback expiry fails');
select extensions.is(pg_catalog.current_setting('test.early_ready')::jsonb->>'parent','expired',
  'delayed readiness observes terminal initiation expiry');
select extensions.is(pg_catalog.current_setting('test.early_ready')::jsonb->>'claim','invalid',
  'delayed readiness cannot later claim');

create function private.plannix_auth_test_reserve_delay() returns trigger
language plpgsql as $$
begin
  if new.state_hash=pg_catalog.current_setting('test.reserve_delay_state',true) then
    perform pg_catalog.pg_sleep(0.15);
  end if;
  return new;
end;
$$;
create trigger plannix_auth_test_reserve_delay before insert
  on private.plannix_auth_callbacks for each row
  execute function private.plannix_auth_test_reserve_delay();

select pg_catalog.set_config('test.reserve_delay_state',pg_catalog.repeat('c',64),true);
select pg_catalog.set_config('test.reserve_marker',
  public.plannix_auth_issue_binding(pg_catalog.repeat('c',64))->>'name',true);
select pg_catalog.set_config('test.reserve_parent',
  public.plannix_auth_begin(pg_catalog.current_setting('test.reserve_marker'),
    pg_catalog.repeat('c',64),'ordinary')->>'intentId',true);
update private.plannix_auth_transitions
  set expires_at=pg_catalog.clock_timestamp()+interval '50 milliseconds'
  where id=pg_catalog.current_setting('test.reserve_parent')::uuid;
select extensions.is(public.plannix_auth_reserve_callback(
  pg_catalog.current_setting('test.reserve_marker'),pg_catalog.repeat('c',64),
  pg_catalog.repeat('c',64),'confirmation',
  pg_catalog.current_setting('test.reserve_parent')::uuid)->>'state','invalid',
  'reservation delayed across initiating expiry fails');
select extensions.is((select state from private.plannix_auth_transitions
  where id=pg_catalog.current_setting('test.reserve_parent')::uuid),'expired',
  'delayed reservation observes terminal initiation expiry');
select extensions.is((select cancelled_at is not null from private.plannix_auth_callbacks
  where state_hash=pg_catalog.repeat('c',64)),true,
  'delayed reservation cancels unclaimable callback state');

select * from extensions.finish();
rollback;
