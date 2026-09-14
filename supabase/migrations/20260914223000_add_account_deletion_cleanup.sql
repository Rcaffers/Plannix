-- Preserve shared school records when a departing user's membership is removed.
-- In both composite foreign keys, only the nullable user reference is cleared;
-- the non-null organisation scope remains unchanged.
alter table public.plannix_students
drop constraint fk_plannix_students_org_user;

alter table public.plannix_students
add constraint fk_plannix_students_org_user
foreign key (organisation_user_id, organisation_id)
references public.plannix_organisation_users(id, organisation_id)
on delete set null (organisation_user_id);

alter table public.plannix_events
alter column created_by_organisation_user_id drop not null;

alter table public.plannix_events
drop constraint fk_plannix_events_creator;

alter table public.plannix_events
add constraint fk_plannix_events_creator
foreign key (created_by_organisation_user_id, organisation_id)
references public.plannix_organisation_users(id, organisation_id)
on delete set null (created_by_organisation_user_id);

create or replace function private.plannix_cleanup_deleted_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_personal_organisation_id uuid;
begin
  -- Do not allow a school to lose its only Organisation Admin. This check is
  -- repeated transactionally at deletion time rather than relying on a UI
  -- preflight that could become stale.
  if exists (
    select 1
    from public.plannix_organisation_users as departing_membership
    join public.plannix_organisations as organisation
      on organisation.id = departing_membership.organisation_id
     and organisation.organisation_type = 'school'
    join public.plannix_organisation_user_access_roles as departing_assignment
      on departing_assignment.organisation_user_id = departing_membership.id
    join public.plannix_access_roles as departing_role
      on departing_role.id = departing_assignment.access_role_id
     and departing_role.name = 'Organisation Admin'
    where departing_membership.user_id = old.id
      and not exists (
        select 1
        from public.plannix_organisation_users as other_membership
        join public.plannix_organisation_user_access_roles as other_assignment
          on other_assignment.organisation_user_id = other_membership.id
        join public.plannix_access_roles as other_role
          on other_role.id = other_assignment.access_role_id
         and other_role.name = 'Organisation Admin'
        where other_membership.organisation_id = departing_membership.organisation_id
          and other_membership.user_id <> old.id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'PLANNIX_ACCOUNT_DELETE_LAST_SCHOOL_ADMIN';
  end if;

  -- The private marker is the only ownership authority. Never infer ownership
  -- from an organisation name, type, role, or membership count.
  select personal_organisation.organisation_id
  into v_personal_organisation_id
  from private.plannix_personal_organisations as personal_organisation
  where personal_organisation.user_id = old.id;

  if v_personal_organisation_id is null then
    if exists (
      select 1
      from public.plannix_organisation_users as membership
      join public.plannix_organisations as organisation
        on organisation.id = membership.organisation_id
       and organisation.organisation_type = 'personal'
      where membership.user_id = old.id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'PLANNIX_ACCOUNT_DELETE_PERSONAL_MARKER_MISSING';
    end if;
  else
    delete from public.plannix_organisations as organisation
    where organisation.id = v_personal_organisation_id;
  end if;

  return old;
end;
$$;

revoke all
on function private.plannix_cleanup_deleted_auth_user()
from public;

revoke all
on function private.plannix_cleanup_deleted_auth_user()
from anon;

revoke all
on function private.plannix_cleanup_deleted_auth_user()
from authenticated;

create trigger plannix_cleanup_deleted_auth_user
before delete on auth.users
for each row
execute function private.plannix_cleanup_deleted_auth_user();

comment on function private.plannix_cleanup_deleted_auth_user() is
  'Transactionally removes the marked personal organisation before an Auth user is deleted, while protecting school administration and marker integrity.';
