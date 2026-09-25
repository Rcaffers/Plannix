begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,'',
 case when confirmed then now() else null end,'{"provider":"email","providers":["email"]}',
 '{"first_name":"AI","last_name":"Test"}',now(),now()
from (values
 ('91000000-0000-4000-8000-000000000001'::uuid,'ai-one@example.test',true),
 ('91000000-0000-4000-8000-000000000002'::uuid,'ai-two@example.test',true),
 ('91000000-0000-4000-8000-000000000003'::uuid,'ai-unconfirmed@example.test',false)
) as fixture(id,email,confirmed);

create function pg_temp.ai_call(who uuid, operation text, provider text default null, api_key text default null, caller_role text default 'authenticated')
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin
 perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(who::text,''),true);
 execute pg_catalog.format('set local role %I',caller_role);
 case operation
 when 'read' then select public.plannix_get_personal_ai_connection() into result;
 when 'create' then select public.plannix_create_personal_ai_connection(provider,api_key) into result;
 when 'replace' then select public.plannix_replace_personal_ai_connection(provider,api_key) into result;
 when 'delete' then select public.plannix_delete_personal_ai_connection() into result;
 when 'onboard' then perform public.plannix_ensure_personal_organisation();
 end case;
 execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;
select pg_temp.ai_call('91000000-0000-4000-8000-000000000001','onboard');
select pg_temp.ai_call('91000000-0000-4000-8000-000000000002','onboard');
create temporary table ai_owner as
select ou.id from public.plannix_organisation_users as ou join private.plannix_personal_organisations as p
on p.organisation_id=ou.organisation_id and p.user_id=ou.user_id where p.user_id='91000000-0000-4000-8000-000000000001';

-- Add an owned school membership: it must never become the credential target.
insert into public.plannix_organisations(id,name,organisation_type) values ('92000000-0000-4000-8000-000000000001','AI test school','school');
insert into public.plannix_organisation_users(id,organisation_id,user_id) values
 ('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001');

create function pg_temp.retrieve(who uuid, caller_role text default 'service_role') returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb;
begin
  execute pg_catalog.format('set local role %I',caller_role);
  select public.plannix_get_server_ai_credential(who) into result;
  execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;
select extensions.ok(has_function_privilege('service_role','public.plannix_get_server_ai_credential(uuid)','EXECUTE'),'service role execute');
select extensions.ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='public.plannix_get_server_ai_credential(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC execute revoked');
select extensions.throws_ok($$select pg_temp.retrieve('91000000-0000-4000-8000-000000000001','anon')$$,'42501',null,'anon denied');
select extensions.throws_ok($$select pg_temp.retrieve('91000000-0000-4000-8000-000000000001','authenticated')$$,'42501',null,'authenticated denied');
select extensions.throws_ok($$select pg_temp.retrieve(null)$$,'P0001','AI credential unavailable.','null user safely denied');
select extensions.throws_ok($$select pg_temp.retrieve('91000000-0000-4000-8000-000000000003')$$,'P0001','AI credential unavailable.','unconfirmed user safely denied');
select extensions.throws_ok($$select pg_temp.retrieve('91000000-0000-4000-8000-000000000001')$$,'P0001','AI credential unavailable.','missing connection safe');
-- An actual school connection must not be selected, even without a personal one.
insert into public.plannix_ai_connections(organisation_user_id,provider,vault_secret_id,api_key_last_four)
values ('93000000-0000-4000-8000-000000000001','openai',vault.create_secret('fixture-school-9999'),'9999');
select extensions.throws_ok($$select pg_temp.retrieve('91000000-0000-4000-8000-000000000001')$$,'P0001','AI credential unavailable.','school-only connection ignored');
create function pg_temp.retrieval_matrix() returns setof text language plpgsql as $$
declare provider text; who uuid := '91000000-0000-4000-8000-000000000001';
begin
 foreach provider in array array['openai','anthropic','google_gemini'] loop
  perform pg_temp.ai_call(who,'create',provider,'fixture-personal-1234');
  return next extensions.is(pg_temp.retrieve(who),jsonb_build_object('provider',provider,'apiKey','fixture-personal-1234'),provider||' retrieves exact personal Vault credential only');
  return next extensions.throws_ok($q$select pg_temp.retrieve('91000000-0000-4000-8000-000000000002')$q$,'P0001','AI credential unavailable.','another user has no credential');
  update public.plannix_ai_connections set is_active=false where organisation_user_id=(select id from ai_owner);
  return next extensions.throws_ok(format('select pg_temp.retrieve(%L)',who),'P0001','AI credential unavailable.','inactive denied');
  update public.plannix_ai_connections set is_active=true,api_key_last_four='9999' where organisation_user_id=(select id from ai_owner);
  return next extensions.throws_ok(format('select pg_temp.retrieve(%L)',who),'P0001','AI credential unavailable.','inconsistent metadata denied');
  update public.plannix_ai_connections set api_key_last_four='1234' where organisation_user_id=(select id from ai_owner);
  delete from vault.secrets where id=(select vault_secret_id from public.plannix_ai_connections where organisation_user_id=(select id from ai_owner));
  return next extensions.throws_ok(format('select pg_temp.retrieve(%L)',who),'P0001','AI credential unavailable.','missing Vault secret denied');
  perform pg_temp.ai_call(who,'delete');
 end loop;
end;
$$;
select * from pg_temp.retrieval_matrix();

-- Both confirmed users were onboarded above through the authoritative mapping.
-- Exercise two simultaneously populated personal connections under normal constraints.
select extensions.is((select count(distinct organisation_id) from private.plannix_personal_organisations
 where user_id in ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')),2::bigint,'users have distinct authoritative personal organisations');
select extensions.is((select count(distinct m.id) from private.plannix_personal_organisations p
 join public.plannix_organisation_users m on m.organisation_id=p.organisation_id and m.user_id=p.user_id
 where p.user_id in ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002')),2::bigint,'users have distinct personal memberships');
select pg_temp.ai_call('91000000-0000-4000-8000-000000000001','create','openai','test-fixture-aaaa');
select pg_temp.ai_call('91000000-0000-4000-8000-000000000002','create','google_gemini','test-fixture-bbbb');
select extensions.is(pg_temp.retrieve('91000000-0000-4000-8000-000000000001'),
 jsonb_build_object('provider','openai','apiKey','test-fixture-aaaa'),'first UUID returns only its own provider and credential');
select extensions.is(pg_temp.retrieve('91000000-0000-4000-8000-000000000002'),
 jsonb_build_object('provider','google_gemini','apiKey','test-fixture-bbbb'),'second UUID returns only its own provider and credential');
select extensions.isnt(pg_temp.retrieve('91000000-0000-4000-8000-000000000001'),
 jsonb_build_object('provider','google_gemini','apiKey','test-fixture-bbbb'),'first UUID cannot resolve second connection');
select extensions.isnt(pg_temp.retrieve('91000000-0000-4000-8000-000000000002'),
 jsonb_build_object('provider','openai','apiKey','test-fixture-aaaa'),'second UUID cannot resolve first connection');
select pg_temp.ai_call('91000000-0000-4000-8000-000000000001','delete');
select pg_temp.ai_call('91000000-0000-4000-8000-000000000002','delete');

select extensions.ok(not has_table_privilege('authenticated','public.plannix_ai_connections','SELECT,INSERT,UPDATE,DELETE'),'no direct connection grants');
select extensions.ok(not has_column_privilege('authenticated','public.plannix_ai_connections','vault_secret_id','SELECT'),'no Vault ID column grant');
select extensions.ok(not has_table_privilege('authenticated','vault.decrypted_secrets','SELECT'),'no authenticated Vault grant');
select extensions.ok(not has_table_privilege('anon','vault.decrypted_secrets','SELECT'),'no anon Vault grant');
-- Deliberately simulate corrupt legacy state inside this rolled-back test.
select pg_temp.ai_call('91000000-0000-4000-8000-000000000001','create','openai','fixture-personal-1234');
alter table public.plannix_ai_connections drop constraint plannix_ai_connections_unique_user;
insert into public.plannix_ai_connections(organisation_user_id,provider,vault_secret_id,api_key_last_four)
select organisation_user_id,provider,vault_secret_id,api_key_last_four from public.plannix_ai_connections where organisation_user_id=(select id from ai_owner);
select extensions.throws_ok($$select pg_temp.retrieve('91000000-0000-4000-8000-000000000001')$$,'P0001','AI credential unavailable.','duplicate state is rejected rather than selected arbitrarily');
select * from extensions.finish();
rollback;
