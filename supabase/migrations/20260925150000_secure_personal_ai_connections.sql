begin;

-- Do not guess which credential to keep if a previous deployment permitted
-- several providers for one membership. The entire migration aborts safely.
lock table public.plannix_ai_connections in access exclusive mode;
do $$
begin
  if exists (select 1 from public.plannix_ai_connections group by organisation_user_id having count(*) > 1) then
    raise exception 'AI connection migration requires manual resolution of duplicate membership connections.';
  end if;
end;
$$;
alter table public.plannix_ai_connections
  drop constraint plannix_ai_connections_provider_check,
  drop constraint plannix_ai_connections_unique_user_provider,
  add constraint plannix_ai_connections_provider_check check (provider in ('openai','anthropic','google_gemini')),
  add constraint plannix_ai_connections_unique_user unique (organisation_user_id);

-- Metadata is available exclusively through ownership-checked RPCs. Revoke
-- column grants as well as table grants (PostgreSQL stores them separately).
revoke all on public.plannix_ai_connections from public, anon, authenticated;
revoke select (id,organisation_user_id,provider,api_key_last_four,preferred_model,is_active,created_at,updated_at)
  on public.plannix_ai_connections from public, anon, authenticated;
revoke all on function private.plannix_create_ai_connection(uuid,text,text,text) from public, anon, authenticated;
revoke all on function private.plannix_update_ai_secret(uuid,text) from public, anon, authenticated;
revoke all on function private.plannix_delete_ai_connection(uuid) from public, anon, authenticated;

-- Invoked only by the narrowly scoped SECURITY DEFINER wrappers below.
create function private.plannix_personal_ai_connection(operation text, selected_provider text default null, submitted_key text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  caller uuid := auth.uid();
  membership uuid;
  connection public.plannix_ai_connections%rowtype;
  new_secret uuid;
  old_secret uuid;
  clean_key text;
begin
  if caller is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if not exists (select 1 from auth.users as u where u.id=caller and u.email_confirmed_at is not null) then
    raise exception using errcode='42501', message='Email confirmation is required.';
  end if;
  if operation is null or operation not in ('read','create','replace','delete') then
    raise exception using errcode='22023', message='Invalid connection operation.';
  end if;
  -- The private mapping, not a browser-supplied organisation or membership,
  -- defines ownership. Lock the membership even when no connection exists.
  select ou.id into membership
  from private.plannix_personal_organisations as personal
  join public.plannix_organisations as org on org.id=personal.organisation_id and org.organisation_type='personal'
  join public.plannix_organisation_users as ou on ou.organisation_id=org.id and ou.user_id=caller
  where personal.user_id=caller
  for update of ou;
  if membership is null then raise exception using errcode='42501', message='Personal organisation is unavailable.'; end if;

  if operation in ('create','replace') then
    if selected_provider is null or selected_provider not in ('openai','anthropic','google_gemini') then
      raise exception using errcode='22023', message='Unsupported AI provider.';
    end if;
    clean_key := pg_catalog.btrim(submitted_key, E' \t\n\r\f\v');
    -- A key of <=4 characters would be disclosed in full by last-four masking.
    if clean_key is null or pg_catalog.length(clean_key) < 5 or pg_catalog.length(clean_key) > 4096 then
      raise exception using errcode='22023', message='API key must contain between 5 and 4096 characters.';
    end if;
  end if;
  select c.* into connection from public.plannix_ai_connections as c where c.organisation_user_id=membership;
  if operation='create' and connection.id is not null then
    raise exception using errcode='23505', message='A personal AI connection already exists.';
  end if;
  if operation='replace' and connection.id is null then
    raise exception using errcode='P0002', message='Personal AI connection was not found.';
  end if;
  if operation='delete' then
    -- Existing after-delete trigger owns Vault cleanup, including account deletion.
    delete from public.plannix_ai_connections as c where c.organisation_user_id=membership;
    return null;
  end if;
  if operation in ('create','replace') then
    old_secret := connection.vault_secret_id;
    select vault.create_secret(clean_key) into new_secret;
    if operation='create' then
      insert into public.plannix_ai_connections(organisation_user_id,provider,vault_secret_id,api_key_last_four,is_active)
      values(membership,selected_provider,new_secret,pg_catalog.right(clean_key,4),true) returning * into connection;
    else
      update public.plannix_ai_connections as c
      set provider=selected_provider, vault_secret_id=new_secret, api_key_last_four=pg_catalog.right(clean_key,4),
          preferred_model=null, is_active=true, updated_at=pg_catalog.clock_timestamp()
      where c.id=connection.id returning c.* into connection;
      delete from vault.secrets where id=old_secret;
    end if;
  end if;
  if connection.id is null then return null; end if;
  return pg_catalog.jsonb_build_object('provider',connection.provider,'lastFour',connection.api_key_last_four,'active',connection.is_active);
end;
$$;
revoke all on function private.plannix_personal_ai_connection(text,text,text) from public, anon, authenticated;

create function public.plannix_get_personal_ai_connection() returns jsonb
language sql security definer set search_path='' as $$
  select private.plannix_personal_ai_connection('read');
$$;
create function public.plannix_create_personal_ai_connection(provider text, api_key text) returns jsonb
language sql security definer set search_path='' as $$
  select private.plannix_personal_ai_connection('create',provider,api_key);
$$;
create function public.plannix_replace_personal_ai_connection(provider text, api_key text) returns jsonb
language sql security definer set search_path='' as $$
  select private.plannix_personal_ai_connection('replace',provider,api_key);
$$;
create function public.plannix_delete_personal_ai_connection() returns jsonb
language sql security definer set search_path='' as $$
  select private.plannix_personal_ai_connection('delete');
$$;
revoke all on function public.plannix_get_personal_ai_connection(),
  public.plannix_create_personal_ai_connection(text,text), public.plannix_replace_personal_ai_connection(text,text),
  public.plannix_delete_personal_ai_connection() from public, anon;
grant execute on function public.plannix_get_personal_ai_connection(),
  public.plannix_create_personal_ai_connection(text,text), public.plannix_replace_personal_ai_connection(text,text),
  public.plannix_delete_personal_ai_connection() to authenticated;
commit;
