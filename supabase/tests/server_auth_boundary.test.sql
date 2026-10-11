begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to service_role;
select extensions.no_plan();

select extensions.ok(not has_table_privilege('anon','private.plannix_auth_callbacks','SELECT,INSERT,UPDATE,DELETE'),
  'browser roles cannot access PKCE callback state');
select extensions.ok(not has_table_privilege('service_role','private.plannix_auth_callbacks','SELECT,INSERT,UPDATE,DELETE'),
  'service role cannot bypass callback RPCs');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_auth_select(jsonb)','EXECUTE'),
  'browser cannot select private session cookies');
select extensions.ok(has_function_privilege('service_role','public.plannix_auth_claim_refresh(text,text,text,text,bigint)','EXECUTE'),
  'service role can claim refresh through RPC');

insert into auth.users(id,email,email_confirmed_at)
  values ('dd000000-0000-4000-8000-000000000099','stage3@example.test',pg_catalog.now());
set local role service_role;
select extensions.is(public.plannix_auth_issue_binding(pg_catalog.repeat('a',64))->>'state','issued',
  'first synthetic marker issued');
select extensions.is(public.plannix_auth_issue_binding(pg_catalog.repeat('b',64))->>'state','issued',
  'second synthetic marker issued');
reset role;
select pg_catalog.set_config('test.marker_a','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('a',64);
select pg_catalog.set_config('test.marker_b','__Host-plannix-b-' || generation,true)
  from private.plannix_auth_browser_bindings where marker_hash=pg_catalog.repeat('b',64);
set local role service_role;
select extensions.is(public.plannix_auth_select(pg_catalog.jsonb_build_object('markers',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('name',pg_catalog.current_setting('test.marker_a'),
    'hash',pg_catalog.repeat('a',64)),pg_catalog.jsonb_build_object('name','__Host-plannix-b-999',
    'hash',pg_catalog.repeat('f',64))), 'sessions','[]'::jsonb))->>'state','invalid',
  'forged extra marker fails without selecting');
reset role;
select extensions.is((select revoked from private.plannix_auth_browser_bindings
  where marker_hash=pg_catalog.repeat('a',64)),false,'forgery did not revoke the valid marker');

set local role service_role;
select extensions.is(public.plannix_auth_select(pg_catalog.jsonb_build_object('markers',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('name',pg_catalog.current_setting('test.marker_a'),
    'hash',pg_catalog.repeat('a',64)),pg_catalog.jsonb_build_object('name',pg_catalog.current_setting('test.marker_b'),
    'hash',pg_catalog.repeat('b',64))), 'sessions','[]'::jsonb))->>'markerName',
  pg_catalog.current_setting('test.marker_b'),'newest verified marker wins');
reset role;
select extensions.is((select revoked from private.plannix_auth_browser_bindings
  where marker_hash=pg_catalog.repeat('a',64)),true,'older marker becomes permanently non-authoritative');

set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),'recovery')->>'state','started','recovery initiation owns a transition');
reset role;
select pg_catalog.set_config('test.callback_intent',t.id::text,true)
  from private.plannix_auth_transitions as t join private.plannix_auth_browser_bindings as b
    on b.id=t.binding_id where b.marker_hash=pg_catalog.repeat('b',64) and t.state='pending';
set local role service_role;
select extensions.is(public.plannix_auth_reserve_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('c',64),'recovery',
  pg_catalog.current_setting('test.callback_intent')::uuid)
  ->>'state','reserved','verified binding reserves callback before provider call');
select extensions.is(public.plannix_auth_claim_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('c',64),pg_catalog.repeat('d',32),'recovery',null,null)
  ->>'state','invalid','pending callback cannot be claimed');
select extensions.is(public.plannix_auth_attach_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('c',64),'recovery',pg_catalog.repeat('d',32),'{"v":1}')
  ->>'state','attached','provider verifier attaches only to reserved callback');
select extensions.is(public.plannix_auth_claim_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('c',64),pg_catalog.repeat('d',32),'recovery',null,null)
  ->>'state','invalid','attached but unconfirmed callback remains unclaimable');
select extensions.is(public.plannix_auth_ready_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('c',64),'recovery')
  ->>'state','ready','confirmed provider initiation makes callback claimable');
select extensions.is(public.plannix_auth_claim_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('c',64),pg_catalog.repeat('d',32),'recovery',null,null)
  ->>'state','claimed','callback is claimed once');
select extensions.is(public.plannix_auth_claim_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('c',64),pg_catalog.repeat('d',32),'recovery',null,null)
  ->>'state','invalid','callback replay rejected');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),'recovery')->>'state','started','new initiation supersedes claimed exchange');
reset role;
select pg_catalog.set_config('test.callback_intent2',t.id::text,true)
  from private.plannix_auth_transitions as t join private.plannix_auth_browser_bindings as b
    on b.id=t.binding_id where b.marker_hash=pg_catalog.repeat('b',64) and t.state='pending';
set local role service_role;
select extensions.is(public.plannix_auth_reserve_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('f',64),'recovery',
  pg_catalog.current_setting('test.callback_intent2')::uuid)
  ->>'state','reserved','second callback reserves');
select extensions.is(public.plannix_auth_cancel_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('f',64),'recovery')
  ->>'state','cancelled','failed initiation is terminal');
select extensions.is(public.plannix_auth_attach_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('f',64),'recovery',pg_catalog.repeat('d',32),'{"v":1}')
  ->>'state','invalid','late provider verifier cannot revive cancellation');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),'ordinary')->>'state','started','signup initiation starts');
reset role;
select pg_catalog.set_config('test.stale_intent',t.id::text,true)
  from private.plannix_auth_transitions as t join private.plannix_auth_browser_bindings as b
    on b.id=t.binding_id where b.marker_hash=pg_catalog.repeat('b',64) and t.state='pending';
set local role service_role;
select extensions.is(public.plannix_auth_reserve_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('9',64),'confirmation',
  pg_catalog.current_setting('test.stale_intent')::uuid)->>'state','reserved',
  'confirmation state is bound to its initiating transition');
select extensions.is(public.plannix_auth_attach_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('9',64),'confirmation',pg_catalog.repeat('d',32),'{"v":1}')
  ->>'state','attached','old verifier attached before newer login');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),'ordinary')->>'state','started','new login supersedes old signup');
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.stale_intent')::uuid,
  'failed')->>'state','superseded','old initiation cannot settle after newer login');
select extensions.is(public.plannix_auth_ready_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('9',64),'confirmation')
  ->>'state','invalid','superseded callback cannot become ready');
select extensions.is(public.plannix_auth_claim_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('9',64),pg_catalog.repeat('d',32),
  'confirmation',null,null)->>'state','invalid','superseded callback cannot claim');
reset role;
select pg_catalog.set_config('test.failed_intent',t.id::text,true)
  from private.plannix_auth_transitions as t join private.plannix_auth_browser_bindings as b
    on b.id=t.binding_id where b.marker_hash=pg_catalog.repeat('b',64) and t.state='pending';
set local role service_role;
select extensions.is(public.plannix_auth_reserve_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('7',64),'confirmation',
  pg_catalog.current_setting('test.failed_intent')::uuid)->>'state','reserved',
  'failed initiation callback starts reserved');
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.failed_intent')::uuid,
  'failed')->>'state','failed','initiating transition fails');
select extensions.is(public.plannix_auth_ready_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('7',64),'confirmation')
  ->>'state','invalid','failed initiation cannot become ready');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),'ordinary')->>'state','started','expiry fixture starts');
reset role;
select pg_catalog.set_config('test.expired_intent',t.id::text,true)
  from private.plannix_auth_transitions as t join private.plannix_auth_browser_bindings as b
    on b.id=t.binding_id where b.marker_hash=pg_catalog.repeat('b',64) and t.state='pending';
set local role service_role;
select extensions.is(public.plannix_auth_reserve_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('6',64),'confirmation',
  pg_catalog.current_setting('test.expired_intent')::uuid)->>'state','reserved',
  'expiring initiation callback starts reserved');
reset role;
update private.plannix_auth_transitions set expires_at=pg_catalog.clock_timestamp()-interval '1 second'
  where id=pg_catalog.current_setting('test.expired_intent')::uuid;
set local role service_role;
select extensions.is(public.plannix_auth_ready_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('6',64),'confirmation')
  ->>'state','invalid','expired initiation cannot become ready');
reset role;
select extensions.is((select state from private.plannix_auth_transitions
  where id=pg_catalog.current_setting('test.expired_intent')::uuid),'expired',
  'observed callback initiation expiry is terminal');
update private.plannix_auth_transitions set expires_at=pg_catalog.clock_timestamp()+interval '1 hour'
  where id=pg_catalog.current_setting('test.expired_intent')::uuid;
set local role service_role;
select extensions.is(public.plannix_auth_attach_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('6',64),'confirmation',pg_catalog.repeat('d',32),'{"v":1}')
  ->>'state','invalid','later deadline extension cannot revive expired initiation');
reset role;
set local role service_role;
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),'ordinary')->>'state','started','next legitimate confirmation starts');
reset role;
select pg_catalog.set_config('test.ready_intent',t.id::text,true)
  from private.plannix_auth_transitions as t join private.plannix_auth_browser_bindings as b
    on b.id=t.binding_id where b.marker_hash=pg_catalog.repeat('b',64) and t.state='pending';
set local role service_role;
select extensions.is(public.plannix_auth_reserve_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('8',64),'confirmation',
  pg_catalog.current_setting('test.ready_intent')::uuid)->>'state','reserved',
  'second confirmation reservation succeeds');
select extensions.is(public.plannix_auth_attach_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('8',64),'confirmation',pg_catalog.repeat('d',32),'{"v":1}')
  ->>'state','attached','second confirmation verifier attached');
select extensions.is(public.plannix_auth_ready_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('8',64),'confirmation')
  ->>'state','ready','legitimate confirmation remains usable while latest');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),'ordinary')->>'state','started','new login supersedes ready callback');
select extensions.is(public.plannix_auth_claim_callback(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.repeat('8',64),pg_catalog.repeat('d',32),
  'confirmation',null,null)->>'state','invalid','ready callback cannot bypass supersession');
select extensions.is(public.plannix_auth_begin(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),'ordinary')->>'state','started','newest marker begins session');
reset role;
select pg_catalog.set_config('test.intent',t.id::text,true)
  from private.plannix_auth_transitions as t join private.plannix_auth_browser_bindings as b
    on b.id=t.binding_id where b.marker_hash=pg_catalog.repeat('b',64) and t.state='pending';
set local role service_role;
select extensions.is(public.plannix_auth_settle(pg_catalog.current_setting('test.intent')::uuid,
  'created','dd000000-0000-4000-8000-000000000099',pg_catalog.repeat('e',64),'{"v":1}','{"v":1}')
  ->>'state','created','current session fixture created');
reset role;
select pg_catalog.set_config('test.session','__Host-plannix-s-' || generation,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('e',64);
set local role service_role;
select extensions.is(public.plannix_auth_select(pg_catalog.jsonb_build_object('markers',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('name',pg_catalog.current_setting('test.marker_b'),
    'hash',pg_catalog.repeat('b',64))), 'sessions',pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('name',pg_catalog.current_setting('test.session'),
    'hash',pg_catalog.repeat('e',64)))))->>'sessionName',
  pg_catalog.current_setting('test.session'),'selector returns only current verified session');
select extensions.is(public.plannix_auth_claim_refresh(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.current_setting('test.session'),pg_catalog.repeat('e',64),1)
  ->>'state','claimed','first worker claims refresh');
select extensions.is(public.plannix_auth_claim_refresh(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.current_setting('test.session'),pg_catalog.repeat('e',64),1)
  ->>'state','busy','second worker cannot claim same version');
reset role;
select pg_catalog.set_config('test.refresh_claim',refresh_claim::text,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('e',64);
select pg_catalog.set_config('test.session_id',id::text,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('e',64);
set local role service_role;
select extensions.is(public.plannix_auth_finish_refresh(pg_catalog.current_setting('test.refresh_claim')::uuid,
  pg_catalog.current_setting('test.session_id')::uuid,1,'{"v":2}','{"v":2}')
  ->>'state','refreshed','claimed version advances once');
select extensions.is(public.plannix_auth_finish_refresh(pg_catalog.current_setting('test.refresh_claim')::uuid,
  pg_catalog.current_setting('test.session_id')::uuid,1,'{"v":3}','{"v":3}')
  ->>'state','conflict','stale refresh cannot overwrite newer tokens');
reset role;
select extensions.is((select token_version from private.plannix_auth_sessions
  where secret_hash=pg_catalog.repeat('e',64)),2::bigint,'token version advanced exactly once');
set local role service_role;
select extensions.is(public.plannix_auth_claim_refresh(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.current_setting('test.session'),pg_catalog.repeat('e',64),2)
  ->>'state','claimed','next refresh claim is created');
reset role;
select pg_catalog.set_config('test.expiring_claim',refresh_claim::text,true)
  from private.plannix_auth_sessions where secret_hash=pg_catalog.repeat('e',64);
update private.plannix_auth_browser_bindings set expires_at=pg_catalog.clock_timestamp()-interval '1 second'
  where marker_hash=pg_catalog.repeat('b',64);
set local role service_role;
select extensions.is(public.plannix_auth_finish_refresh(pg_catalog.current_setting('test.expiring_claim')::uuid,
  pg_catalog.current_setting('test.session_id')::uuid,2,'{"v":3}','{"v":3}')
  ->>'state','conflict','binding expiry at refresh settlement rejects replacement');
reset role;
select extensions.is((select expired from private.plannix_auth_browser_bindings
  where marker_hash=pg_catalog.repeat('b',64)),true,
  'refresh settlement records terminal binding expiry');
update private.plannix_auth_browser_bindings set expires_at=pg_catalog.clock_timestamp()+interval '1 day'
  where marker_hash=pg_catalog.repeat('b',64);
set local role service_role;
select extensions.is(public.plannix_auth_claim_refresh(pg_catalog.current_setting('test.marker_b'),
  pg_catalog.repeat('b',64),pg_catalog.current_setting('test.session'),pg_catalog.repeat('e',64),2)
  ->>'state','rejected','later clock-equivalent expiry extension cannot revive refresh');
reset role;
select extensions.is((select token_version from private.plannix_auth_sessions
  where secret_hash=pg_catalog.repeat('e',64)),2::bigint,'expired refresh left token version unchanged');
select * from extensions.finish();
rollback;
