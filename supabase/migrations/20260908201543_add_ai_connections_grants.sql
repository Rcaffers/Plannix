grant select (
  id,
  organisation_user_id,
  provider,
  api_key_last_four,
  preferred_model,
  is_active,
  created_at,
  updated_at
)
on public.plannix_ai_connections
to authenticated;