create or replace function private.plannix_create_ai_connection(
  p_organisation_user_id uuid,
  p_api_key text,
  p_provider text default 'openai',
  p_preferred_model text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
  v_secret_id uuid;
  v_secret_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_api_key is null or length(trim(p_api_key)) = 0 then
    raise exception 'API key is required';
  end if;

if p_provider is distinct from 'openai' then
  raise exception 'Unsupported AI provider';
end if;

  if not exists (
    select 1
    from public.plannix_organisation_users ou
    where ou.id = p_organisation_user_id
      and ou.user_id = auth.uid()
  ) then
    raise exception 'Organisation membership not found or access denied';
  end if;

  if not (
  private.plannix_has_access_role(
    (
      select ou.organisation_id
      from public.plannix_organisation_users ou
      where ou.id = p_organisation_user_id
        and ou.user_id = auth.uid()
    ),
    'Organisation Admin'
  )
  or
  private.plannix_has_access_role(
    (
      select ou.organisation_id
      from public.plannix_organisation_users ou
      where ou.id = p_organisation_user_id
        and ou.user_id = auth.uid()
    ),
    'Staff'
  )
) then
  raise exception 'AI connections are only available to organisation admins and staff';
end if;

  if exists (
    select 1
    from public.plannix_ai_connections aic
    where aic.organisation_user_id = p_organisation_user_id
      and aic.provider = p_provider
  ) then
    raise exception 'AI connection already exists';
  end if;

  v_secret_name :=
    'plannix_ai_' ||
    p_provider ||
    '_' ||
    p_organisation_user_id::text;

  select vault.create_secret(
    p_api_key,
    v_secret_name,
    'Plannix user AI API key'
  )
  into v_secret_id;

  insert into public.plannix_ai_connections (
    organisation_user_id,
    provider,
    vault_secret_id,
    api_key_last_four,
    preferred_model,
    is_active
  )
  values (
    p_organisation_user_id,
    p_provider,
    v_secret_id,
    right(p_api_key, 4),
    p_preferred_model,
    true
  )
  returning id into v_connection_id;

  return v_connection_id;
end;
$$;

revoke execute on function private.plannix_create_ai_connection(
  uuid,
  text,
  text,
  text
)
from public;

revoke execute on function private.plannix_create_ai_connection(
  uuid,
  text,
  text,
  text
)
from anon;