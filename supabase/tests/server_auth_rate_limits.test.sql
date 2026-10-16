begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to service_role;
select extensions.plan(14);

select extensions.ok(not has_table_privilege('anon','private.plannix_auth_rate_counters','SELECT'),
  'anonymous clients cannot read rate counters');
select extensions.ok(not has_table_privilege('authenticated','private.plannix_auth_rate_counters','SELECT'),
  'authenticated clients cannot read rate counters');
select extensions.ok(not has_table_privilege('service_role','private.plannix_auth_rate_counters','SELECT'),
  'service role uses the RPC, not table reads');
select extensions.ok(not has_function_privilege('anon','public.plannix_auth_rate_attempt(jsonb)','EXECUTE'),
  'anonymous clients cannot claim rate buckets');
select extensions.ok(not has_function_privilege('authenticated','public.plannix_auth_rate_attempt(jsonb)','EXECUTE'),
  'authenticated clients cannot claim rate buckets');
select extensions.ok(has_function_privilege('service_role','public.plannix_auth_rate_attempt(jsonb)','EXECUTE'),
  'service role may claim rate buckets');

set local role service_role;
select extensions.is((public.plannix_auth_rate_attempt('[{"key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","maximum":1}]'::jsonb)->>'allowed')::boolean,
  true,'first atomic attempt is allowed');
select extensions.is((public.plannix_auth_rate_attempt('[{"key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","maximum":1}]'::jsonb)->>'allowed')::boolean,
  false,'second attempt is denied');
select extensions.is(public.plannix_auth_rate_attempt('[{"key":"bad","maximum":1}]'::jsonb)->>'state',
  'invalid','malformed key is rejected');
select extensions.is(public.plannix_auth_rate_attempt('[{"key":null,"maximum":1}]'::jsonb)->>'state',
  'invalid','null key is rejected');
reset role;

select extensions.is((select attempts from private.plannix_auth_rate_counters
    where key_hash=repeat('a',64) order by window_number desc limit 1),
  2,'denied attempts still count atomically');
select extensions.ok((select count(*) from private.plannix_auth_rate_counters
  where key_hash=repeat('a',64))=1,'one fixed-window row exists for one key');
insert into private.plannix_auth_rate_counters(key_hash,window_number,attempts,expires_at)
values (repeat('c',64),floor(extract(epoch from clock_timestamp())/60)::bigint-1,
  100,clock_timestamp()+interval '1 minute');
set local role service_role;
select extensions.is((public.plannix_auth_rate_attempt('[{"key":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","maximum":1}]'::jsonb)->>'allowed')::boolean,
  true,'prior fixed window cannot block a new window');
reset role;
update private.plannix_auth_rate_counters set expires_at=clock_timestamp()-interval '1 second'
  where key_hash=repeat('c',64);
select extensions.ok(public.plannix_auth_rate_cleanup(1000)>=2,
  'bounded cleanup removes expired rows');

select * from extensions.finish();
rollback;
