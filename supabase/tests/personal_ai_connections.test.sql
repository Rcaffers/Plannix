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

select extensions.is(pg_temp.ai_call('91000000-0000-4000-8000-000000000001','read'),null::jsonb,'disconnected metadata is null');
select extensions.throws_ok($$select pg_temp.ai_call(null,'read',null,null,'anon')$$,'42501',null,'anon cannot invoke metadata RPC');
select extensions.throws_ok($$select pg_temp.ai_call(null,'create','openai','test-credential')$$,'42501',null,'missing UID denied even with authenticated role');
select extensions.throws_ok($$select pg_temp.ai_call('91000000-0000-4000-8000-000000000003','create','openai','test-credential')$$,'42501','Email confirmation is required.','unconfirmed caller denied directly');
select extensions.throws_ok($$select pg_temp.ai_call('91000000-0000-4000-8000-000000000001','create','other','test-credential')$$,'22023','Unsupported AI provider.','unsupported provider rejected');
select extensions.throws_ok($$select pg_temp.ai_call('91000000-0000-4000-8000-000000000001','create','openai','   ')$$,'22023',null,'empty key rejected');
select extensions.throws_ok($$select pg_temp.ai_call('91000000-0000-4000-8000-000000000001','create','google_gemini',repeat('x',4097))$$,'22023',null,'oversized key rejected');
select extensions.throws_ok($$select pg_temp.ai_call('91000000-0000-4000-8000-000000000001','create','google_gemini','abcd')$$,'22023',null,'keys that would be fully disclosed by last-four masking rejected');

-- Inject a failure after a new Vault secret is created and the connection
-- row is updated. The entire RPC must roll back, including that new secret.
create function pg_temp.reject_connection_replacement() returns trigger language plpgsql as $$
begin
 if old.vault_secret_id::text=current_setting('plannix.test_old_secret',true) then raise exception 'Test replacement failure'; end if;
 return new;
end;
$$;
create trigger test_ai_vault_failure after update on public.plannix_ai_connections for each row execute function pg_temp.reject_connection_replacement();

create function pg_temp.provider_matrix() returns setof text language plpgsql as $$
declare
 source text; destination text; result jsonb; original public.plannix_ai_connections%rowtype;
 current_connection public.plannix_ai_connections%rowtype; original_secret uuid; secret_count bigint;
 owner_id uuid := (select id from ai_owner); who uuid := '91000000-0000-4000-8000-000000000001';
 credential text; command text;
begin
 foreach source in array array['openai','anthropic','google_gemini'] loop
  result := pg_temp.ai_call(who,'create',source,'  fixture-key-without-provider-prefix-1234  ');
  select * into original from public.plannix_ai_connections where organisation_user_id=owner_id;
  return next extensions.is(result,jsonb_build_object('provider',source,'lastFour','1234','active',true),source||' returns only safe metadata');
  return next extensions.is((select decrypted_secret from vault.decrypted_secrets where id=original.vault_secret_id),'fixture-key-without-provider-prefix-1234',source||' trimmed full key lives in Vault');
  return next extensions.ok(position('fixture-key-without-provider-prefix' in to_jsonb(original)::text)=0,source||' public row never contains full key');
  return next extensions.is((select count(*) from public.plannix_ai_connections where organisation_user_id='93000000-0000-4000-8000-000000000001'),0::bigint,'school membership untouched');
  return next extensions.throws_ok(format($q$select pg_temp.ai_call(%L,'create',%L,'duplicate-key')$q$,who,source),'23505',null,'duplicate create rejected');
  return next extensions.throws_ok(format($q$insert into public.plannix_ai_connections(organisation_user_id,provider,vault_secret_id) values (%L,'anthropic',%L)$q$,owner_id,original.vault_secret_id),'23505',null,'one connection constraint cannot be bypassed');
  return next extensions.is(pg_temp.ai_call('91000000-0000-4000-8000-000000000002','read'),null::jsonb,'another user cannot read owner metadata');
  perform pg_temp.ai_call('91000000-0000-4000-8000-000000000002','delete');
  return next extensions.ok(exists(select 1 from public.plannix_ai_connections where id=original.id),'another user cannot delete owner connection');
  foreach destination in array array['openai','anthropic','google_gemini'] loop
   -- Reset source so all nine ordered pairs, including same-provider rotation, execute.
   perform pg_temp.ai_call(who,'replace',source,'fixture-original-key-1234');
   select * into original from public.plannix_ai_connections where organisation_user_id=owner_id;
   original_secret := original.vault_secret_id;
   select count(*) into secret_count from vault.secrets;
   perform set_config('plannix.test_old_secret',original_secret::text,true);
   command := format($q$select pg_temp.ai_call(%L,'replace',%L,'fixture-replacement-key-5678')$q$,who,destination);
   return next extensions.throws_ok(command,'P0001','Test replacement failure',source||' -> '||destination||' injected failure rolls back');
   return next extensions.is((select to_jsonb(c) from public.plannix_ai_connections c where c.id=original.id),to_jsonb(original),'failed switch preserves complete original row');
   return next extensions.is((select decrypted_secret from vault.decrypted_secrets where id=original_secret),'fixture-original-key-1234','failed switch preserves original secret');
   return next extensions.is((select count(*) from vault.secrets),secret_count,'failed switch leaks no new Vault secret');
   perform set_config('plannix.test_old_secret','',true);
   result := pg_temp.ai_call(who,'replace',destination,'fixture-replacement-key-5678');
   select * into current_connection from public.plannix_ai_connections where organisation_user_id=owner_id;
   return next extensions.is(result,jsonb_build_object('provider',destination,'lastFour','5678','active',true),source||' -> '||destination||' succeeds');
   return next extensions.is(current_connection.id,original.id,'switch retains connection identity');
   return next extensions.ok(not exists(select 1 from vault.secrets where id=original_secret),'switch deletes old secret');
   return next extensions.is((select decrypted_secret from vault.decrypted_secrets where id=current_connection.vault_secret_id),'fixture-replacement-key-5678','replacement secret stored only in Vault');
   return next extensions.is((select count(*) from public.plannix_ai_connections where organisation_user_id=owner_id),1::bigint,'switch leaves exactly one connection');
  end loop;
  original_secret := current_connection.vault_secret_id;
  perform pg_temp.ai_call(who,'delete');
  return next extensions.ok(not exists(select 1 from public.plannix_ai_connections where organisation_user_id=owner_id),'disconnect removes connection');
  return next extensions.ok(not exists(select 1 from vault.secrets where id=original_secret),'disconnect trigger removes secret');
 end loop;
end;
$$;
select * from pg_temp.provider_matrix();

select extensions.ok(not has_column_privilege('authenticated','public.plannix_ai_connections','vault_secret_id','SELECT'),'Vault ID cannot be selected');
select extensions.ok(not has_column_privilege('authenticated','public.plannix_ai_connections','provider','SELECT'),'direct metadata read cannot bypass personal scope');
select extensions.ok(not has_function_privilege('authenticated','private.plannix_create_ai_connection(uuid,text,text,text)','EXECUTE'),'legacy create grant revoked');
select extensions.ok(not has_function_privilege('authenticated','private.plannix_update_ai_secret(uuid,text)','EXECUTE'),'legacy replacement grant revoked');
select extensions.ok(not has_function_privilege('authenticated','private.plannix_delete_ai_connection(uuid)','EXECUTE'),'legacy cross-membership delete grant revoked');
select extensions.ok(not has_function_privilege('authenticated','private.plannix_personal_ai_connection(text,text,text)','EXECUTE'),'private helper not callable directly');
select extensions.ok(to_regprocedure('public.plannix_create_personal_ai_connection(uuid,text,text)') is null,'no membership ID is accepted by the public RPC');
create function pg_temp.sql_as(who uuid, statement text) returns void
language plpgsql set search_path='' as $$
begin
 perform pg_catalog.set_config('request.jwt.claim.sub',who::text,true);
 execute 'set local role authenticated';
 execute statement;
 execute 'reset role';
exception when others then execute 'reset role'; raise;
end;
$$;
select extensions.throws_ok($$select pg_temp.sql_as('91000000-0000-4000-8000-000000000001','select vault_secret_id from public.plannix_ai_connections')$$,'42501',null,'actual direct Vault ID read is forbidden');
select extensions.throws_ok($$select pg_temp.sql_as('91000000-0000-4000-8000-000000000001','select decrypted_secret from vault.decrypted_secrets')$$,'42501',null,'authenticated users cannot decrypt Vault directly');
select extensions.throws_ok($$select pg_temp.sql_as('91000000-0000-4000-8000-000000000001','select private.plannix_delete_ai_connection(''93000000-0000-4000-8000-000000000001'')')$$,'42501',null,'legacy ID-based mutation is actually denied');
select extensions.throws_ok($$select pg_temp.ai_call('91000000-0000-4000-8000-000000000002','replace','openai','fixture-key-1234')$$,'P0002',null,'another caller cannot replace a connection they do not own');
select * from extensions.finish();
rollback;
