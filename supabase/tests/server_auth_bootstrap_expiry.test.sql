begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();
select extensions.ok(not has_function_privilege('anon','public.plannix_auth_select_bootstrap(jsonb)','EXECUTE'),'anon cannot recover bootstrap');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_auth_select_bootstrap(jsonb)','EXECUTE'),'browser cannot recover bootstrap');
select extensions.ok(has_function_privilege('service_role','public.plannix_auth_select_bootstrap(jsonb)','EXECUTE'),'server can recover bootstrap');
select extensions.ok((select prosecdef and proconfig @> array['search_path=""','lock_timeout=2s'] from pg_proc where oid='public.plannix_auth_select_bootstrap(jsonb)'::regprocedure),'definer uses empty search path and bounded lock wait');
select extensions.ok((select proowner=(select proowner from pg_proc where oid='public.plannix_auth_select(jsonb)'::regprocedure) from pg_proc where oid='public.plannix_auth_select_bootstrap(jsonb)'::regprocedure),'bootstrap has the established privileged auth owner');
select extensions.ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid='public.plannix_auth_select_bootstrap(jsonb)'::regprocedure and a.privilege_type='EXECUTE'
 and a.grantee not in (p.proowner,'service_role'::regrole)),'no unexpected explicit EXECUTE grants including PUBLIC');
insert into auth.users(id,email,email_confirmed_at) values
 ('dd000000-0000-4000-8000-000000000091','bootstrap-fixture@example.test',now());
insert into private.plannix_auth_browser_bindings(marker_hash,expires_at) values
 (repeat('a',64),now()-interval '1 hour'),(repeat('b',64),now()+interval '1 day');
insert into private.plannix_auth_sessions(id,generation,binding_id,kind,owner_id,secret_hash,access_envelope,refresh_envelope,expires_at)
 select gen_random_uuid(),nextval('private.plannix_auth_generation_seq'),id,'ordinary','dd000000-0000-4000-8000-000000000091',repeat('c',64),'{}','{}',now()+interval '1 day'
 from private.plannix_auth_browser_bindings where marker_hash=repeat('a',64);
insert into private.plannix_auth_sessions(id,generation,binding_id,kind,owner_id,secret_hash,access_envelope,refresh_envelope,expires_at)
 select gen_random_uuid(),nextval('private.plannix_auth_generation_seq'),id,'ordinary','dd000000-0000-4000-8000-000000000091',repeat('d',64),'{}','{}',now()+interval '1 day'
 from private.plannix_auth_browser_bindings where marker_hash=repeat('b',64);
update private.plannix_auth_browser_bindings b set current_session_id=s.id
 from private.plannix_auth_sessions s where s.binding_id=b.id;
create temporary table bootstrap_inputs as select
 jsonb_build_object('markers','[]'::jsonb,'sessions',jsonb_build_array(jsonb_build_object('name','__Host-plannix-s-'||generation,'hash',secret_hash))) as candidates,
 binding_id from private.plannix_auth_sessions where secret_hash in (repeat('c',64),repeat('d',64));
select extensions.is(public.plannix_auth_select(candidates)->>'state','invalid','ordinary selection still rejects expired or live orphan') from bootstrap_inputs;
select extensions.is(public.plannix_auth_select_bootstrap(i.candidates)->>'state',
 case when b.marker_hash=repeat('a',64) then 'terminal' else 'invalid' end,
 'only verified terminal binding permits anonymous bootstrap recovery')
 from bootstrap_inputs i join private.plannix_auth_browser_bindings b on b.id=i.binding_id;
select extensions.ok((select expired and revoked from private.plannix_auth_browser_bindings where marker_hash=repeat('a',64)), 'orphan recovery persists observed binding expiry');
select extensions.ok((select revoked from private.plannix_auth_sessions where secret_hash=repeat('c',64)), 'terminal current session is revoked before cleanup');
update private.plannix_auth_browser_bindings set expires_at=now()+interval '1 day' where marker_hash=repeat('a',64);
select extensions.is(public.plannix_auth_select_bootstrap(i.candidates)->>'state','terminal','moving expiry back into the future cannot revive observed terminal context')
 from bootstrap_inputs i join private.plannix_auth_browser_bindings b on b.id=i.binding_id where b.marker_hash=repeat('a',64);
select extensions.is(jsonb_array_length(public.plannix_auth_select_bootstrap(i.candidates)->'cleanup'),1,'orphan cleanup contains exactly its supplied name')
 from bootstrap_inputs i join private.plannix_auth_browser_bindings b on b.id=i.binding_id where b.marker_hash=repeat('a',64);
select extensions.is(public.plannix_auth_select_bootstrap(jsonb_set(candidates,'{sessions,0,hash}',to_jsonb(repeat('f',64))))->>'state','invalid','forged orphan secret stays rejected') from bootstrap_inputs;
select extensions.is(public.plannix_auth_select_bootstrap(jsonb_set(candidates,'{sessions}',(candidates->'sessions')||(candidates->'sessions')))->>'state','invalid','duplicate names stay rejected') from bootstrap_inputs;
select extensions.is(public.plannix_auth_select_bootstrap(jsonb_build_object('markers','[]'::jsonb,'sessions',
 (select jsonb_agg(item) from bootstrap_inputs i cross join lateral jsonb_array_elements(i.candidates->'sessions') item)))->>'state','invalid','a live binding mixed with terminal cookies cannot be discarded');
select extensions.is(public.plannix_auth_select_bootstrap(jsonb_set(i.candidates,'{markers}',jsonb_build_array(jsonb_build_object('name','__Host-plannix-b-'||b.generation,'hash',b.marker_hash))))->>'state','terminal','verified expired marker and sessions recover together')
 from bootstrap_inputs i join private.plannix_auth_browser_bindings b on b.id=i.binding_id where b.marker_hash=repeat('a',64);
select extensions.is(jsonb_array_length(public.plannix_auth_select_bootstrap(jsonb_set(i.candidates,'{markers}',jsonb_build_array(jsonb_build_object('name','__Host-plannix-b-'||b.generation,'hash',b.marker_hash))))->'cleanup'),2,'both old cookie names are cleaned together')
 from bootstrap_inputs i join private.plannix_auth_browser_bindings b on b.id=i.binding_id where b.marker_hash=repeat('a',64);
select extensions.is(public.plannix_auth_select_bootstrap('{"markers":[],"sessions":[["malformed"]]}'::jsonb)->>'state','invalid','malformed session objects stay rejected');
select extensions.is(public.plannix_auth_select_bootstrap('{"markers":[],"sessions":[{"name":null,"hash":null}]}'::jsonb)->>'state','invalid','null cookie fields stay rejected');
select extensions.is(public.plannix_auth_select_bootstrap(jsonb_set(candidates,'{sessions,0,name}',to_jsonb(replace(candidates#>>'{sessions,0,name}','-s-','-r-'))))->>'state','invalid','wrong recovery/ordinary kind stays rejected') from bootstrap_inputs;
select extensions.ok(not exists(select 1 from private.plannix_auth_browser_bindings where marker_hash=repeat('b',64) and (revoked or expired)), 'live binding remains unchanged by rejected or terminal cleanup');
select extensions.is(public.plannix_auth_select_bootstrap(jsonb_build_object('markers',jsonb_build_array(jsonb_build_object('name','__Host-plannix-b-'||b.generation,'hash',b.marker_hash)),
 'sessions',(select jsonb_agg(item) from bootstrap_inputs i cross join lateral jsonb_array_elements(i.candidates->'sessions') item)))->>'state','invalid','a newer live marker cannot be replaced by an older orphan')
 from private.plannix_auth_browser_bindings b where b.marker_hash=repeat('b',64);
select extensions.is((select count(*)::integer from private.plannix_auth_sessions),2,'bootstrap selection creates no authenticated session');
update private.plannix_auth_browser_bindings set expires_at=now()-interval '1 hour' where marker_hash=repeat('b',64);
select extensions.is(public.plannix_auth_select_bootstrap(jsonb_build_object('markers','[]'::jsonb,'sessions',
 (select jsonb_agg(item) from bootstrap_inputs i cross join lateral jsonb_array_elements(i.candidates->'sessions') item)))->>'state','invalid','distinct terminal families cannot be combined for recovery');
select extensions.ok(not (public.plannix_auth_select_bootstrap(jsonb_build_object('markers','[]'::jsonb,'sessions',
 (select jsonb_agg(item) from bootstrap_inputs i cross join lateral jsonb_array_elements(i.candidates->'sessions') item))) ? 'cleanup'),'mixed terminal families receive no cleanup');
select * from extensions.finish();
rollback;
