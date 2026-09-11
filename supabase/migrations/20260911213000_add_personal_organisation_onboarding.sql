create table private.plannix_personal_organisations (
  user_id uuid primary key,
  organisation_id uuid not null unique,
  organisation_type text not null default 'personal',
  created_at timestamptz not null default now(),

  constraint fk_plannix_personal_organisations_user
    foreign key (user_id)
    references public.plannix_users(id)
    on delete cascade,

  constraint chk_plannix_personal_organisations_type
    check (organisation_type = 'personal'),

  constraint fk_plannix_personal_organisations_organisation
    foreign key (organisation_id, organisation_type)
    references public.plannix_organisations(id, organisation_type)
    on delete cascade
);

-- This marker is private implementation state. Clients bootstrap their personal
-- organisation only through the narrowly scoped function below.
revoke all privileges
on table private.plannix_personal_organisations
from public, anon, authenticated;

create or replace function public.plannix_ensure_personal_organisation()
returns table (
  organisation_id uuid,
  organisation_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_first_name text;
  v_last_name text;
  v_access_role_id uuid;
  v_organisation_id uuid;
  v_organisation_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = v_user_id
      and auth_user.email_confirmed_at is not null
  ) then
    raise exception using
      errcode = '42501',
      message = 'Email confirmation is required.';
  end if;

  -- Locking the caller's profile serializes concurrent onboarding attempts for
  -- that user. The marker constraints remain a second line of defence.
  select profile.first_name, profile.last_name
  into v_first_name, v_last_name
  from public.plannix_users as profile
  where profile.id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'The user profile is not ready.';
  end if;

  select access_role.id
  into v_access_role_id
  from public.plannix_access_roles as access_role
  where access_role.name = 'Organisation Admin';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'The Organisation Admin role is unavailable.';
  end if;

  select personal_organisation.organisation_id
  into v_organisation_id
  from private.plannix_personal_organisations as personal_organisation
  where personal_organisation.user_id = v_user_id;

  if v_organisation_id is null then
    insert into public.plannix_organisations (
      name,
      organisation_type
    )
    values (
      v_first_name || ' ' || v_last_name || '''s organisation',
      'personal'
    )
    returning id into v_organisation_id;

    insert into private.plannix_personal_organisations (
      user_id,
      organisation_id
    )
    values (
      v_user_id,
      v_organisation_id
    );
  end if;

  insert into public.plannix_organisation_users (
    organisation_id,
    user_id
  )
  values (
    v_organisation_id,
    v_user_id
  )
  on conflict on constraint uq_plannix_organisation_users
  do update set user_id = excluded.user_id
  returning id into v_organisation_user_id;

  insert into public.plannix_organisation_user_access_roles (
    organisation_user_id,
    access_role_id
  )
  values (
    v_organisation_user_id,
    v_access_role_id
  )
  on conflict on constraint uq_plannix_organisation_user_access_roles
  do nothing;

  return query
  select v_organisation_id, v_organisation_user_id;
end;
$$;

-- PostgreSQL grants function execution to PUBLIC by default. Keep this RPC
-- available only to authenticated callers; it performs its own UID and email
-- confirmation checks as an additional boundary.
revoke all
on function public.plannix_ensure_personal_organisation()
from public;

revoke all
on function public.plannix_ensure_personal_organisation()
from anon;

grant execute
on function public.plannix_ensure_personal_organisation()
to authenticated;

comment on table private.plannix_personal_organisations is
  'Authoritative private mapping between a user and the personal organisation created by onboarding.';

comment on function public.plannix_ensure_personal_organisation() is
  'Idempotently provisions the confirmed caller personal organisation, membership, and Organisation Admin role.';

-- Account deletion is intentionally outside this migration. Deleting an auth
-- user cascades through plannix_users and removes this private marker, but it
-- does not delete the organisation. Account deletion must later remove the
-- owned personal organisation transactionally before deleting the user.
