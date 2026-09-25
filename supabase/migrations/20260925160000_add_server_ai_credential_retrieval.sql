begin;

-- Trusted server callers only: never grant this RPC to browser roles.
create or replace function public.plannix_get_server_ai_credential(validated_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  resolved record;
begin
  if validated_user_id is null or not exists (
    select 1 from auth.users as u where u.id=validated_user_id and u.email_confirmed_at is not null
  ) then
    raise exception using errcode='42501', message='AI credential unavailable.';
  end if;
  -- STRICT rejects absent or ambiguous state; no arbitrary LIMIT 1 selection.
  select c.provider, c.is_active, c.api_key_last_four, s.decrypted_secret
  into strict resolved
  from private.plannix_personal_organisations as personal
  join public.plannix_organisations as org
    on org.id=personal.organisation_id and org.organisation_type='personal'
  join public.plannix_organisation_users as membership
    on membership.organisation_id=org.id and membership.user_id=validated_user_id
  join public.plannix_ai_connections as c on c.organisation_user_id=membership.id
  left join vault.decrypted_secrets as s on s.id=c.vault_secret_id
  where personal.user_id=validated_user_id;

  if resolved.is_active is distinct from true
    or resolved.provider not in ('openai','anthropic','google_gemini')
    or resolved.decrypted_secret is null
    or pg_catalog.length(resolved.decrypted_secret) not between 5 and 4096
    or resolved.api_key_last_four is distinct from pg_catalog.right(resolved.decrypted_secret,4) then
    raise exception using errcode='P0001', message='AI credential unavailable.';
  end if;
  return pg_catalog.jsonb_build_object('provider',resolved.provider,'apiKey',resolved.decrypted_secret);
exception
  when others then
    -- Never propagate Vault diagnostics, submitted IDs or decrypted values.
    raise exception using errcode='P0001', message='AI credential unavailable.';
end;
$$;
revoke all on function public.plannix_get_server_ai_credential(uuid) from public, anon, authenticated;
grant execute on function public.plannix_get_server_ai_credential(uuid) to service_role;
commit;
