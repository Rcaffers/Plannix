begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
select extensions.plan(23);

select extensions.ok(not has_table_privilege('anon','private.plannix_auth_rate_control','SELECT'),
  'anonymous clients cannot inspect rate control');
select extensions.ok(not has_table_privilege('service_role','private.plannix_auth_rate_control','SELECT'),
  'service role cannot inspect rate control');
select extensions.ok(not has_table_privilege('service_role','private.plannix_auth_rate_control','UPDATE'),
  'service role cannot change rate control');
select extensions.ok(not has_function_privilege('service_role','public.plannix_auth_rate_attempt(jsonb)','EXECUTE'),
  'legacy one-argument claim is unavailable');
select extensions.ok(has_function_privilege('service_role','public.plannix_auth_rate_attempt(jsonb,bigint,text)','EXECUTE'),
  'service role may use epoch-checked claim');
select extensions.ok(not has_function_privilege('anon','public.plannix_auth_rate_attempt(jsonb,bigint,text)','EXECUTE'),
  'anonymous users cannot claim');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_auth_rate_attempt(jsonb,bigint,text)','EXECUTE'),
  'authenticated users cannot claim');
select extensions.ok(not has_function_privilege('service_role','private.plannix_auth_rate_pause()','EXECUTE'),
  'web service cannot pause');
select extensions.ok(not has_function_privilege('service_role','private.plannix_auth_rate_prepare_epoch(text)','EXECUTE'),
  'web service cannot change epoch');
select extensions.ok(not has_function_privilege('service_role','private.plannix_auth_rate_resume(bigint)','EXECUTE'),
  'web service cannot resume');
select extensions.ok(not (select active from private.plannix_auth_rate_control),
  'migration starts closed');

set local role service_role;
select extensions.is(public.plannix_auth_rate_attempt('[{"key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","maximum":1}]'::jsonb,1,repeat('a',64))->>'state',
  'unavailable','paused claim fails closed');
reset role;
select extensions.is(private.plannix_auth_rate_prepare_epoch(repeat('a',64)),1::bigint,
  'first prepared epoch is one');
select extensions.is(private.plannix_auth_rate_resume(1),false,
  'resume requires a full database-clock wait');
update private.plannix_auth_rate_control set paused_at=clock_timestamp()-interval '61 seconds';
select extensions.is(private.plannix_auth_rate_resume(1),true,
  'operator may resume after the database-clock wait');
set local role service_role;
select extensions.is(public.plannix_auth_rate_attempt('[{"key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","maximum":1}]'::jsonb,0,repeat('a',64))->>'state',
  'unavailable','wrong epoch does not claim');
select extensions.is(public.plannix_auth_rate_attempt('[{"key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","maximum":1}]'::jsonb,1,repeat('c',64))->>'state',
  'unavailable','new epoch with old key tag cannot claim');
select extensions.is((public.plannix_auth_rate_attempt('[{"key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","maximum":1}]'::jsonb,1,repeat('a',64))->>'allowed')::boolean,
  true,'active epoch claims once');
reset role;
select extensions.is((select attempts from private.plannix_auth_rate_counters where key_hash=repeat('b',64)),
  1,'only active claim touched the counter');
select extensions.ok(private.plannix_auth_rate_pause() is not null,
  'operator pause completes');
select extensions.is(private.plannix_auth_rate_prepare_epoch(repeat('c',64)),2::bigint,
  'rotation uses a never-reused higher epoch');
update private.plannix_auth_rate_control set paused_at=clock_timestamp()-interval '61 seconds';
select extensions.is(private.plannix_auth_rate_resume(2),true,
  'new epoch can resume after wait');
set local role service_role;
select extensions.is(public.plannix_auth_rate_attempt('[{"key":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","maximum":1}]'::jsonb,1,repeat('a',64))->>'state',
  'unavailable','old replica cannot resume claims');
reset role;
select * from extensions.finish();
rollback;
