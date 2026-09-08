create or replace function private.plannix_update_ai_secret(
  p_connection_id uuid,
  p_api_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_api_key is null or length(trim(p_api_key)) = 0 then
    raise exception 'API key is required';
  end if;

  select aic.vault_secret_id
  into v_secret_id
  from public.plannix_ai_connections aic
  join public.plannix_organisation_users ou
    on ou.id = aic.organisation_user_id
  where aic.id = p_connection_id
    and ou.user_id = auth.uid();

  if v_secret_id is null then
    raise exception 'AI connection not found or access denied';
  end if;

if not exists (
  select 1
  from public.plannix_ai_connections aic
  join public.plannix_organisation_users ou
    on ou.id = aic.organisation_user_id
  where aic.id = p_connection_id
    and ou.user_id = auth.uid()
    and (
      private.plannix_has_access_role(
        ou.organisation_id,
        'Organisation Admin'
      )
      or
      private.plannix_has_access_role(
        ou.organisation_id,
        'Staff'
      )
    )
) then
  raise exception 'AI connections are only available to organisation admins and staff';
end if;

  perform vault.update_secret(
    v_secret_id,
    p_api_key
  );

  update public.plannix_ai_connections
set
  api_key_last_four = right(p_api_key, 4),
  updated_at = now()
where id = p_connection_id;
end;
$$;



create or replace function private.plannix_delete_ai_connection(
  p_connection_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select aic.vault_secret_id
  into v_secret_id
  from public.plannix_ai_connections aic
  join public.plannix_organisation_users ou
    on ou.id = aic.organisation_user_id
  where aic.id = p_connection_id
    and ou.user_id = auth.uid();

  if v_secret_id is null then
    raise exception 'AI connection not found or access denied';
  end if;

  delete from public.plannix_ai_connections
  where id = p_connection_id;
end;
$$;

create or replace function private.plannix_cleanup_ai_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets
  where id = old.vault_secret_id;

  return old;
end;
$$;

create trigger plannix_ai_connections_cleanup_vault_secret
after delete on public.plannix_ai_connections
for each row
execute function private.plannix_cleanup_ai_vault_secret();

revoke execute on function private.plannix_cleanup_ai_vault_secret()
from public;

revoke execute on function private.plannix_cleanup_ai_vault_secret()
from anon;

revoke execute on function private.plannix_update_ai_secret(uuid, text)
from public;

revoke execute on function private.plannix_update_ai_secret(uuid, text)
from anon;

revoke execute on function private.plannix_delete_ai_connection(uuid)
from public;

revoke execute on function private.plannix_delete_ai_connection(uuid)
from anon;
