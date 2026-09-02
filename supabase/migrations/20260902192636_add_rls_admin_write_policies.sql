-- ============================================================
-- ORGANISATION ADMIN HELPER FUNCTION
-- ============================================================

create or replace function private.plannix_is_organisation_admin(
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
    join public.plannix_organisation_user_access_roles our
      on our.organisation_user_id = ou.id
    join public.plannix_access_roles ar
      on ar.id = our.access_role_id
    where ou.organisation_id = target_organisation_id
      and ou.user_id = (select auth.uid())
      and ar.name = 'Organisation Admin'
  );
$$;

revoke execute
on function private.plannix_is_organisation_admin(uuid)
from public;

grant execute
on function private.plannix_is_organisation_admin(uuid)
to authenticated;

-- ============================================================
-- ORGANISATION ADMIN WRITE POLICIES
-- ============================================================

-- Organisation Admins can update organisations they administer.
create policy "Organisation admins can update their organisation"
on public.plannix_organisations
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(id))
)
with check (
  (select private.plannix_is_organisation_admin(id))
);

-- ============================================================
-- ORGANISATION MEMBERSHIP ADMIN POLICIES
-- ============================================================

-- Organisation Admins can view all memberships
-- belonging to organisations they administer.
create policy "Organisation admins can view organisation members"
on public.plannix_organisation_users
for select
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- Organisation Admins can add users to their organisation.
create policy "Organisation admins can add organisation members"
on public.plannix_organisation_users
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- Organisation Admins can update memberships within their organisation.
create policy "Organisation admins can update organisation members"
on public.plannix_organisation_users
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- Organisation Admins can remove users from their organisation.
create policy "Organisation admins can remove organisation members"
on public.plannix_organisation_users
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- ============================================================
-- ACCESS ROLE ASSIGNMENT ADMIN POLICIES
-- ============================================================

-- Organisation Admins can assign access roles to users
-- within organisations they administer.
create policy "Organisation admins can assign access roles"
on public.plannix_organisation_user_access_roles
for insert
to authenticated
with check (
  exists (
    select 1
    from public.plannix_organisation_users ou
    where ou.id = organisation_user_id
      and (
        select private.plannix_is_organisation_admin(
          ou.organisation_id
        )
      )
  )
);


-- Organisation Admins can remove access roles from users
-- within organisations they administer.
create policy "Organisation admins can remove access roles"
on public.plannix_organisation_user_access_roles
for delete
to authenticated
using (
  exists (
    select 1
    from public.plannix_organisation_users ou
    where ou.id = organisation_user_id
      and (
        select private.plannix_is_organisation_admin(
          ou.organisation_id
        )
      )
  )
);

-- ============================================================
-- ORGANISATION CONFIGURATION ADMIN WRITE POLICIES
-- ============================================================


-- ------------------------------------------------------------
-- DEPARTMENTS
-- ------------------------------------------------------------

create policy "Organisation admins can create departments"
on public.plannix_departments
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update departments"
on public.plannix_departments
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete departments"
on public.plannix_departments
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- POSITIONS
-- ------------------------------------------------------------

create policy "Organisation admins can create positions"
on public.plannix_positions
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update positions"
on public.plannix_positions
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete positions"
on public.plannix_positions
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- ACADEMIC YEARS
-- ------------------------------------------------------------

create policy "Organisation admins can create academic years"
on public.plannix_academic_years
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update academic years"
on public.plannix_academic_years
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete academic years"
on public.plannix_academic_years
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- YEAR GROUPS
-- ------------------------------------------------------------

create policy "Organisation admins can create year groups"
on public.plannix_year_groups
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update year groups"
on public.plannix_year_groups
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete year groups"
on public.plannix_year_groups
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- SUBJECTS
-- ------------------------------------------------------------

create policy "Organisation admins can create subjects"
on public.plannix_subjects
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update subjects"
on public.plannix_subjects
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete subjects"
on public.plannix_subjects
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- ============================================================
-- TERMS AND HOLIDAYS ADMIN WRITE POLICIES
-- ============================================================


-- ------------------------------------------------------------
-- TERMS
-- ------------------------------------------------------------

-- Organisation Admins can create terms within academic years
-- belonging to organisations they administer.
create policy "Organisation admins can create terms"
on public.plannix_terms
for insert
to authenticated
with check (
  exists (
    select 1
    from public.plannix_academic_years ay
    where ay.id = academic_year_id
      and (
        select private.plannix_is_organisation_admin(
          ay.organisation_id
        )
      )
  )
);

-- Organisation Admins can update terms.
create policy "Organisation admins can update terms"
on public.plannix_terms
for update
to authenticated
using (
  exists (
    select 1
    from public.plannix_academic_years ay
    where ay.id = academic_year_id
      and (
        select private.plannix_is_organisation_admin(
          ay.organisation_id
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.plannix_academic_years ay
    where ay.id = academic_year_id
      and (
        select private.plannix_is_organisation_admin(
          ay.organisation_id
        )
      )
  )
);

-- Organisation Admins can delete terms.
create policy "Organisation admins can delete terms"
on public.plannix_terms
for delete
to authenticated
using (
  exists (
    select 1
    from public.plannix_academic_years ay
    where ay.id = academic_year_id
      and (
        select private.plannix_is_organisation_admin(
          ay.organisation_id
        )
      )
  )
);


-- ------------------------------------------------------------
-- HOLIDAYS
-- ------------------------------------------------------------

-- Organisation Admins can create holidays within academic years
-- belonging to organisations they administer.
create policy "Organisation admins can create holidays"
on public.plannix_holidays
for insert
to authenticated
with check (
  exists (
    select 1
    from public.plannix_academic_years ay
    where ay.id = academic_year_id
      and (
        select private.plannix_is_organisation_admin(
          ay.organisation_id
        )
      )
  )
);

-- Organisation Admins can update holidays.
create policy "Organisation admins can update holidays"
on public.plannix_holidays
for update
to authenticated
using (
  exists (
    select 1
    from public.plannix_academic_years ay
    where ay.id = academic_year_id
      and (
        select private.plannix_is_organisation_admin(
          ay.organisation_id
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.plannix_academic_years ay
    where ay.id = academic_year_id
      and (
        select private.plannix_is_organisation_admin(
          ay.organisation_id
        )
      )
  )
);

-- Organisation Admins can delete holidays.
create policy "Organisation admins can delete holidays"
on public.plannix_holidays
for delete
to authenticated
using (
  exists (
    select 1
    from public.plannix_academic_years ay
    where ay.id = academic_year_id
      and (
        select private.plannix_is_organisation_admin(
          ay.organisation_id
        )
      )
  )
);

-- ============================================================
-- STUDENT ADMIN WRITE POLICIES
-- ============================================================


-- ------------------------------------------------------------
-- STUDENTS
-- ------------------------------------------------------------

-- Organisation Admins can create students in organisations
-- they administer.
create policy "Organisation admins can create students"
on public.plannix_students
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- Organisation Admins can update students in organisations
-- they administer.
create policy "Organisation admins can update students"
on public.plannix_students
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- Organisation Admins can delete students from organisations
-- they administer.
create policy "Organisation admins can delete students"
on public.plannix_students
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- STUDENT YEAR GROUP ASSIGNMENTS
-- ------------------------------------------------------------

-- Organisation Admins can assign students to year groups.
create policy "Organisation admins can create student year group assignments"
on public.plannix_student_year_groups
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- Organisation Admins can update student year group assignments.
create policy "Organisation admins can update student year group assignments"
on public.plannix_student_year_groups
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- Organisation Admins can remove student year group assignments.
create policy "Organisation admins can delete student year group assignments"
on public.plannix_student_year_groups
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- ============================================================
-- CLASS ADMIN WRITE POLICIES
-- ============================================================


-- ------------------------------------------------------------
-- CLASSES
-- ------------------------------------------------------------

create policy "Organisation admins can create classes"
on public.plannix_classes
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update classes"
on public.plannix_classes
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete classes"
on public.plannix_classes
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- CLASS TEACHERS
-- ------------------------------------------------------------

-- Controls which teachers are assigned to a class.
create policy "Organisation admins can assign class teachers"
on public.plannix_class_teachers
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update class teacher assignments"
on public.plannix_class_teachers
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can remove class teachers"
on public.plannix_class_teachers
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- CLASS SUBJECTS
-- ------------------------------------------------------------

-- Controls which subjects are associated with a class.
create policy "Organisation admins can assign class subjects"
on public.plannix_class_subjects
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update class subject assignments"
on public.plannix_class_subjects
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can remove class subjects"
on public.plannix_class_subjects
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- CLASS STUDENTS
-- ------------------------------------------------------------

-- Controls which students belong to a class.
create policy "Organisation admins can assign class students"
on public.plannix_class_students
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update class student assignments"
on public.plannix_class_students
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can remove class students"
on public.plannix_class_students
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- ============================================================
-- TIMETABLE ADMIN WRITE POLICIES
-- ============================================================


-- ------------------------------------------------------------
-- TIMETABLES
-- ------------------------------------------------------------

create policy "Organisation admins can create timetables"
on public.plannix_timetables
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update timetables"
on public.plannix_timetables
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete timetables"
on public.plannix_timetables
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- TIMETABLE WEEKS
-- ------------------------------------------------------------

-- Weeks do not contain organisation_id directly.
-- Their organisation is determined through their timetable.

create policy "Organisation admins can create timetable weeks"
on public.plannix_timetable_weeks
for insert
to authenticated
with check (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = timetable_id
      and (
        select private.plannix_is_organisation_admin(
          t.organisation_id
        )
      )
  )
);

create policy "Organisation admins can update timetable weeks"
on public.plannix_timetable_weeks
for update
to authenticated
using (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = timetable_id
      and (
        select private.plannix_is_organisation_admin(
          t.organisation_id
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = timetable_id
      and (
        select private.plannix_is_organisation_admin(
          t.organisation_id
        )
      )
  )
);

create policy "Organisation admins can delete timetable weeks"
on public.plannix_timetable_weeks
for delete
to authenticated
using (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = timetable_id
      and (
        select private.plannix_is_organisation_admin(
          t.organisation_id
        )
      )
  )
);


-- ------------------------------------------------------------
-- TIMETABLE PERIODS
-- ------------------------------------------------------------

-- Periods also inherit organisation access through their timetable.

create policy "Organisation admins can create timetable periods"
on public.plannix_timetable_periods
for insert
to authenticated
with check (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = timetable_id
      and (
        select private.plannix_is_organisation_admin(
          t.organisation_id
        )
      )
  )
);

create policy "Organisation admins can update timetable periods"
on public.plannix_timetable_periods
for update
to authenticated
using (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = timetable_id
      and (
        select private.plannix_is_organisation_admin(
          t.organisation_id
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = timetable_id
      and (
        select private.plannix_is_organisation_admin(
          t.organisation_id
        )
      )
  )
);

create policy "Organisation admins can delete timetable periods"
on public.plannix_timetable_periods
for delete
to authenticated
using (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = timetable_id
      and (
        select private.plannix_is_organisation_admin(
          t.organisation_id
        )
      )
  )
);


-- ------------------------------------------------------------
-- TIMETABLE SESSIONS
-- ------------------------------------------------------------

create policy "Organisation admins can create timetable sessions"
on public.plannix_timetable_sessions
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update timetable sessions"
on public.plannix_timetable_sessions
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete timetable sessions"
on public.plannix_timetable_sessions
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- SESSION TEACHERS
-- ------------------------------------------------------------

create policy "Organisation admins can assign session teachers"
on public.plannix_session_teachers
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update session teacher assignments"
on public.plannix_session_teachers
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can remove session teachers"
on public.plannix_session_teachers
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- ============================================================
-- EVENT ADMIN WRITE POLICIES
-- ============================================================


-- ------------------------------------------------------------
-- EVENTS
-- ------------------------------------------------------------

create policy "Organisation admins can create events"
on public.plannix_events
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update events"
on public.plannix_events
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete events"
on public.plannix_events
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- EVENT CLASSES
-- ------------------------------------------------------------

-- Controls which classes are linked to an event.

create policy "Organisation admins can assign event classes"
on public.plannix_event_classes
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update event class assignments"
on public.plannix_event_classes
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can remove event classes"
on public.plannix_event_classes
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- EVENT USERS
-- ------------------------------------------------------------

-- Controls which organisation users are linked to an event.

create policy "Organisation admins can assign event users"
on public.plannix_event_users
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update event user assignments"
on public.plannix_event_users
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can remove event users"
on public.plannix_event_users
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- ============================================================
-- ORGANISATIONAL RELATIONSHIP ADMIN WRITE POLICIES
-- ============================================================


-- ------------------------------------------------------------
-- DEPARTMENT USERS
-- ------------------------------------------------------------

create policy "Organisation admins can assign department users"
on public.plannix_department_users
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update department user assignments"
on public.plannix_department_users
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can remove department users"
on public.plannix_department_users
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- ORGANISATION POSITION USERS
-- ------------------------------------------------------------

create policy "Organisation admins can assign organisation positions"
on public.plannix_organisation_position_users
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update organisation position assignments"
on public.plannix_organisation_position_users
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can remove organisation positions"
on public.plannix_organisation_position_users
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- DEPARTMENT POSITIONS
-- ------------------------------------------------------------

create policy "Organisation admins can create department positions"
on public.plannix_department_positions
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update department positions"
on public.plannix_department_positions
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete department positions"
on public.plannix_department_positions
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- DEPARTMENT POSITION USERS
-- ------------------------------------------------------------

create policy "Organisation admins can assign department position users"
on public.plannix_department_position_users
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update department position user assignments"
on public.plannix_department_position_users
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can remove department position users"
on public.plannix_department_position_users
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- YEAR GROUP POSITIONS
-- ------------------------------------------------------------

create policy "Organisation admins can create year group positions"
on public.plannix_year_group_positions
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update year group positions"
on public.plannix_year_group_positions
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can delete year group positions"
on public.plannix_year_group_positions
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);


-- ------------------------------------------------------------
-- YEAR GROUP POSITION USERS
-- ------------------------------------------------------------

create policy "Organisation admins can assign year group position users"
on public.plannix_year_group_position_users
for insert
to authenticated
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can update year group position user assignments"
on public.plannix_year_group_position_users
for update
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
)
with check (
  (select private.plannix_is_organisation_admin(organisation_id))
);

create policy "Organisation admins can remove year group position users"
on public.plannix_year_group_position_users
for delete
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- Organisation Admins can view all memberships
-- belonging to organisations they administer.
create policy "Organisation admins can view organisation members"
on public.plannix_organisation_users
for select
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);

-- ============================================================
-- ADMIN READ ACCESS TO ORGANISATION MEMBERS
-- ============================================================

-- Normal users can already see their own membership row.
-- This additional policy allows Organisation Admins to see
-- all membership rows within organisations they administer.

create policy "Organisation admins can view organisation members"
on public.plannix_organisation_users
for select
to authenticated
using (
  (select private.plannix_is_organisation_admin(organisation_id))
);