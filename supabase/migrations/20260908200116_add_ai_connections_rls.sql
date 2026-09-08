create policy "Users can view own AI connection"
on public.plannix_ai_connections
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_organisation_users ou
    where ou.id = plannix_ai_connections.organisation_user_id
      and ou.user_id = auth.uid()
  )
);