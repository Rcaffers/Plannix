-- ============================================================
-- PRIVATE RLS HELPER FUNCTIONS
-- ============================================================

create schema if not exists private;

create or replace function private.plannix_is_organisation_member(
  target_organisation_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.plannix_organisation_users ou
    where ou.organisation_id = target_organisation_id
      and ou.user_id = (select auth.uid())
  );
$$;

revoke execute
on function private.plannix_is_organisation_member(uuid)
from public;

grant usage on schema private to authenticated;

grant execute
on function private.plannix_is_organisation_member(uuid)
to authenticated;

-- ============================================================
-- SHARED ORGANISATION PROFILE HELPER
-- ============================================================

create or replace function private.plannix_shares_organisation_with_user(
  target_user_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.plannix_organisation_users current_ou
    join public.plannix_organisation_users target_ou
      on target_ou.organisation_id = current_ou.organisation_id
    where current_ou.user_id = (select auth.uid())
      and target_ou.user_id = target_user_id
  );
$$;

revoke execute
on function private.plannix_shares_organisation_with_user(uuid)
from public;

grant execute
on function private.plannix_shares_organisation_with_user(uuid)
to authenticated;

-- ============================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================

alter table public.plannix_users enable row level security;
alter table public.plannix_organisations enable row level security;
alter table public.plannix_organisation_users enable row level security;
alter table public.plannix_access_roles enable row level security;
alter table public.plannix_organisation_user_access_roles enable row level security;

alter table public.plannix_departments enable row level security;
alter table public.plannix_department_users enable row level security;

alter table public.plannix_positions enable row level security;
alter table public.plannix_organisation_position_users enable row level security;
alter table public.plannix_department_positions enable row level security;
alter table public.plannix_department_position_users enable row level security;

alter table public.plannix_academic_years enable row level security;
alter table public.plannix_terms enable row level security;
alter table public.plannix_holidays enable row level security;

alter table public.plannix_year_groups enable row level security;
alter table public.plannix_year_group_positions enable row level security;
alter table public.plannix_year_group_position_users enable row level security;

alter table public.plannix_students enable row level security;
alter table public.plannix_student_year_groups enable row level security;

alter table public.plannix_subjects enable row level security;

alter table public.plannix_classes enable row level security;
alter table public.plannix_class_teachers enable row level security;
alter table public.plannix_class_subjects enable row level security;
alter table public.plannix_class_students enable row level security;

alter table public.plannix_timetables enable row level security;
alter table public.plannix_timetable_weeks enable row level security;
alter table public.plannix_timetable_periods enable row level security;
alter table public.plannix_timetable_sessions enable row level security;
alter table public.plannix_session_teachers enable row level security;

alter table public.plannix_events enable row level security;
alter table public.plannix_event_classes enable row level security;
alter table public.plannix_event_users enable row level security;

-- ============================================================
-- USER PROFILE POLICIES
-- ============================================================

-- A signed-in user can view their own Plannix profile.
create policy "Users can view their own profile"
on public.plannix_users
for select
to authenticated
using (
  id = (select auth.uid())
);

-- Users can also view profiles belonging to people who share
-- one of their organisations.
create policy "Users can view profiles in their organisations"
on public.plannix_users
for select
to authenticated
using (
  (select private.plannix_shares_organisation_with_user(id))
);

-- A signed-in user can update their own Plannix profile.
create policy "Users can update their own profile"
on public.plannix_users
for update
to authenticated
using (
  id = (select auth.uid())
)
with check (
  id = (select auth.uid())
);

-- ============================================================
-- ORGANISATION USER POLICIES
-- ============================================================

-- A signed-in user can view their own organisation memberships.
--
-- For example, if Rob belongs to:
--   Organisation A
--   Organisation B
--
-- this allows his account to retrieve those membership rows.
create policy "Users can view their own organisation memberships"
on public.plannix_organisation_users
for select
to authenticated
using (
  user_id = (select auth.uid())
);

-- ============================================================
-- ORGANISATION POLICIES
-- ============================================================

-- Users can see an organisation only when they are a member of it.
create policy "Members can view their organisations"
on public.plannix_organisations
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(id))
);

-- ============================================================
-- ORGANISATION-SCOPED READ POLICIES
-- ============================================================

-- Departments
create policy "Members can view organisation departments"
on public.plannix_departments
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

-- Positions
create policy "Members can view organisation positions"
on public.plannix_positions
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

-- Academic Years
create policy "Members can view organisation academic years"
on public.plannix_academic_years
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

-- Year Groups
create policy "Members can view organisation year groups"
on public.plannix_year_groups
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

-- Students
create policy "Members can view organisation students"
on public.plannix_students
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

-- Subjects
create policy "Members can view organisation subjects"
on public.plannix_subjects
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

-- Classes
create policy "Members can view organisation classes"
on public.plannix_classes
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

-- Timetables
create policy "Members can view organisation timetables"
on public.plannix_timetables
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

-- Events
create policy "Members can view organisation events"
on public.plannix_events
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

-- ============================================================
-- ORGANISATION-SCOPED RELATIONSHIP TABLE READ POLICIES
-- ============================================================

create policy "Members can view organisation access role assignments"
on public.plannix_organisation_user_access_roles
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_organisation_users ou
    where ou.id = plannix_organisation_user_access_roles.organisation_user_id
      and (
        select private.plannix_is_organisation_member(
          ou.organisation_id
        )
      )
  )
);

create policy "Members can view organisation department users"
on public.plannix_department_users
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation position users"
on public.plannix_organisation_position_users
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation department positions"
on public.plannix_department_positions
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation department position users"
on public.plannix_department_position_users
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation year group positions"
on public.plannix_year_group_positions
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation year group position users"
on public.plannix_year_group_position_users
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation student year groups"
on public.plannix_student_year_groups
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation class teachers"
on public.plannix_class_teachers
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation class subjects"
on public.plannix_class_subjects
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation class students"
on public.plannix_class_students
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation timetable sessions"
on public.plannix_timetable_sessions
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation session teachers"
on public.plannix_session_teachers
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation event classes"
on public.plannix_event_classes
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

create policy "Members can view organisation event users"
on public.plannix_event_users
for select
to authenticated
using (
  (select private.plannix_is_organisation_member(organisation_id))
);

-- ============================================================
-- GLOBAL ACCESS ROLE READ POLICY
-- ============================================================

-- Access roles are shared seed/reference data rather than being
-- owned by a single organisation.
create policy "Authenticated users can view access roles"
on public.plannix_access_roles
for select
to authenticated
using (true);


-- ============================================================
-- CHILD TABLE READ POLICIES
-- ============================================================

-- Terms inherit organisation access through their academic year.
create policy "Members can view organisation terms"
on public.plannix_terms
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_academic_years ay
    where ay.id = plannix_terms.academic_year_id
      and (select private.plannix_is_organisation_member(ay.organisation_id))
  )
);

-- Holidays inherit organisation access through their academic year.
create policy "Members can view organisation holidays"
on public.plannix_holidays
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_academic_years ay
    where ay.id = plannix_holidays.academic_year_id
      and (select private.plannix_is_organisation_member(ay.organisation_id))
  )
);

-- Timetable weeks inherit organisation access through their timetable.
create policy "Members can view organisation timetable weeks"
on public.plannix_timetable_weeks
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = plannix_timetable_weeks.timetable_id
      and (select private.plannix_is_organisation_member(t.organisation_id))
  )
);

-- Timetable periods inherit organisation access through their timetable.
create policy "Members can view organisation timetable periods"
on public.plannix_timetable_periods
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = plannix_timetable_periods.timetable_id
      and (select private.plannix_is_organisation_member(t.organisation_id))
  )
);