-- ============================================================
-- ACCESS ROLE HELPER FUNCTION
-- ============================================================

create or replace function private.plannix_has_access_role(
  target_organisation_id uuid,
  target_role_name text
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
      and ar.name = target_role_name
  );
$$;

revoke execute
on function private.plannix_has_access_role(uuid, text)
from public;

grant execute
on function private.plannix_has_access_role(uuid, text)
to authenticated;

-- ============================================================
-- STUDENT RECORD READ ACCESS
-- ============================================================

-- Remove the old broad policy.
-- It currently allows ANY organisation member, including Students,
-- to read every student record in that organisation.
drop policy if exists "Members can view organisation students"
on public.plannix_students;

-- Organisation Admins, Staff and Read Only users can view
-- student records belonging to their organisation.
create policy "Staff roles can view organisation students"
on public.plannix_students
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Organisation Admin'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Staff'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Read Only'
  ))
);

-- Students can view only their own student record.
--
-- plannix_students.organisation_user_id links the student record
-- to that student's organisation membership.
create policy "Students can view their own student record"
on public.plannix_students
for select
to authenticated
using (
  organisation_user_id in (
    select ou.id
    from public.plannix_organisation_users ou
    where ou.user_id = (select auth.uid())
      and ou.organisation_id = plannix_students.organisation_id
      and (
        select private.plannix_has_access_role(
          ou.organisation_id,
          'Student'
        )
      )
  )
);

-- ============================================================
-- STUDENT YEAR GROUP READ ACCESS
-- ============================================================

-- Remove the old broad policy which lets every organisation member
-- view all student/year-group relationships.
drop policy if exists "Members can view organisation student year groups"
on public.plannix_student_year_groups;

-- Organisation Admins, Staff and Read Only users can view
-- student year-group records for their organisation.
create policy "Staff roles can view organisation student year groups"
on public.plannix_student_year_groups
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Organisation Admin'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Staff'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Read Only'
  ))
);

-- Students can view only the year-group history linked
-- to their own student record.
create policy "Students can view their own year group records"
on public.plannix_student_year_groups
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_students s
    where s.id = plannix_student_year_groups.student_id
      and s.organisation_user_id in (
        select ou.id
        from public.plannix_organisation_users ou
        where ou.user_id = (select auth.uid())
          and ou.organisation_id = plannix_student_year_groups.organisation_id
      )
  )
);

-- ============================================================
-- STUDENT CLASS MEMBERSHIP HELPER
-- ============================================================

create or replace function private.plannix_student_is_in_class(
  target_class_id uuid,
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
    from public.plannix_class_students cs
    join public.plannix_students s
      on s.id = cs.student_id
    join public.plannix_organisation_users ou
      on ou.id = s.organisation_user_id
    where cs.class_id = target_class_id
      and cs.organisation_id = target_organisation_id
      and ou.user_id = (select auth.uid())
      and ou.organisation_id = target_organisation_id
  );
$$;

revoke execute
on function private.plannix_student_is_in_class(uuid, uuid)
from public;

grant execute
on function private.plannix_student_is_in_class(uuid, uuid)
to authenticated;

-- ============================================================
-- CLASS READ ACCESS
-- ============================================================

-- Remove the old policy which allows every organisation member
-- to view every class.
drop policy if exists "Members can view organisation classes"
on public.plannix_classes;

-- Admin, Staff and Read Only users can view all classes
-- belonging to their organisation.
create policy "Staff roles can view organisation classes"
on public.plannix_classes
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Organisation Admin'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Staff'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Read Only'
  ))
);

-- Students can only view classes that they belong to.
create policy "Students can view their own classes"
on public.plannix_classes
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Student'
  ))
  and
  (select private.plannix_student_is_in_class(
    id,
    organisation_id
  ))
);

-- ============================================================
-- CLASS STUDENT READ ACCESS
-- ============================================================

-- Remove the old broad policy which allows every organisation
-- member to see every student/class relationship.
drop policy if exists "Members can view organisation class students"
on public.plannix_class_students;

-- Admin, Staff and Read Only users can view class membership
-- within their organisation.
create policy "Staff roles can view organisation class students"
on public.plannix_class_students
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Organisation Admin'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Staff'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Read Only'
  ))
);

-- Students can see only their own class-membership rows.
create policy "Students can view their own class memberships"
on public.plannix_class_students
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_students s
    join public.plannix_organisation_users ou
      on ou.id = s.organisation_user_id
    where s.id = plannix_class_students.student_id
      and s.organisation_id = plannix_class_students.organisation_id
      and ou.user_id = (select auth.uid())
      and ou.organisation_id = plannix_class_students.organisation_id
  )
);

-- ============================================================
-- CLASS TEACHER READ ACCESS
-- ============================================================

-- Remove the old broad policy.
drop policy if exists "Members can view organisation class teachers"
on public.plannix_class_teachers;

-- Admin, Staff and Read Only users can view all class-teacher
-- relationships within their organisation.
create policy "Staff roles can view organisation class teachers"
on public.plannix_class_teachers
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Organisation Admin'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Staff'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Read Only'
  ))
);

-- Students can view teacher relationships only for classes
-- they themselves belong to.
create policy "Students can view teachers for their classes"
on public.plannix_class_teachers
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Student'
  ))
  and
  (select private.plannix_student_is_in_class(
    class_id,
    organisation_id
  ))
);


-- ============================================================
-- CLASS SUBJECT READ ACCESS
-- ============================================================

-- Remove the old broad policy.
drop policy if exists "Members can view organisation class subjects"
on public.plannix_class_subjects;

-- Admin, Staff and Read Only users can view all class-subject
-- relationships within their organisation.
create policy "Staff roles can view organisation class subjects"
on public.plannix_class_subjects
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Organisation Admin'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Staff'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Read Only'
  ))
);

-- Students can view subject relationships only for classes
-- they themselves belong to.
create policy "Students can view subjects for their classes"
on public.plannix_class_subjects
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Student'
  ))
  and
  (select private.plannix_student_is_in_class(
    class_id,
    organisation_id
  ))
);

-- ============================================================
-- TIMETABLE READ ACCESS
-- ============================================================

drop policy if exists "Members can view organisation timetables"
on public.plannix_timetables;

create policy "Staff roles can view organisation timetables"
on public.plannix_timetables
for select
to authenticated
using (
  (select private.plannix_has_access_role(organisation_id, 'Organisation Admin'))
  or
  (select private.plannix_has_access_role(organisation_id, 'Staff'))
  or
  (select private.plannix_has_access_role(organisation_id, 'Read Only'))
);

-- Students can view a timetable only if it contains at least one
-- session for a class they belong to.
create policy "Students can view their timetables"
on public.plannix_timetables
for select
to authenticated
using (
  (select private.plannix_has_access_role(organisation_id, 'Student'))
  and exists (
    select 1
    from public.plannix_timetable_sessions ts
    where ts.timetable_id = plannix_timetables.id
      and (
        select private.plannix_student_is_in_class(
          ts.class_id,
          organisation_id
        )
      )
  )
);

-- ============================================================
-- TIMETABLE SESSION READ ACCESS
-- ============================================================

drop policy if exists "Members can view organisation timetable sessions"
on public.plannix_timetable_sessions;

-- Admin, Staff and Read Only can view all timetable sessions
-- within their organisation.
create policy "Staff roles can view organisation timetable sessions"
on public.plannix_timetable_sessions
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Organisation Admin'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Staff'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Read Only'
  ))
);

-- Students can only see sessions belonging to classes
-- they are enrolled in.
create policy "Students can view their timetable sessions"
on public.plannix_timetable_sessions
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Student'
  ))
  and
  (select private.plannix_student_is_in_class(
    class_id,
    organisation_id
  ))
);

-- ============================================================
-- TIMETABLE WEEK READ ACCESS
-- ============================================================

drop policy if exists "Members can view organisation timetable weeks"
on public.plannix_timetable_weeks;

create policy "Users can view allowed timetable weeks"
on public.plannix_timetable_weeks
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = plannix_timetable_weeks.timetable_id
      and (
        (select private.plannix_has_access_role(
          t.organisation_id,
          'Organisation Admin'
        ))
        or
        (select private.plannix_has_access_role(
          t.organisation_id,
          'Staff'
        ))
        or
        (select private.plannix_has_access_role(
          t.organisation_id,
          'Read Only'
        ))
        or
        (
          (select private.plannix_has_access_role(
            t.organisation_id,
            'Student'
          ))
          and exists (
            select 1
            from public.plannix_timetable_sessions ts
            where ts.timetable_id = t.id
              and (
                select private.plannix_student_is_in_class(
                  ts.class_id,
                  t.organisation_id
                )
              )
          )
        )
      )
  )
);


-- ============================================================
-- TIMETABLE PERIOD READ ACCESS
-- ============================================================

drop policy if exists "Members can view organisation timetable periods"
on public.plannix_timetable_periods;

create policy "Users can view allowed timetable periods"
on public.plannix_timetable_periods
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_timetables t
    where t.id = plannix_timetable_periods.timetable_id
      and (
        (select private.plannix_has_access_role(
          t.organisation_id,
          'Organisation Admin'
        ))
        or
        (select private.plannix_has_access_role(
          t.organisation_id,
          'Staff'
        ))
        or
        (select private.plannix_has_access_role(
          t.organisation_id,
          'Read Only'
        ))
        or
        (
          (select private.plannix_has_access_role(
            t.organisation_id,
            'Student'
          ))
          and exists (
            select 1
            from public.plannix_timetable_sessions ts
            where ts.timetable_id = t.id
              and (
                select private.plannix_student_is_in_class(
                  ts.class_id,
                  t.organisation_id
                )
              )
          )
        )
      )
  )
);

-- ============================================================
-- SESSION TEACHER READ ACCESS
-- ============================================================

drop policy if exists "Members can view organisation session teachers"
on public.plannix_session_teachers;

-- Admin, Staff and Read Only users can view all session-teacher
-- relationships within their organisation.
create policy "Staff roles can view organisation session teachers"
on public.plannix_session_teachers
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Organisation Admin'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Staff'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Read Only'
  ))
);

-- Students can view teachers only for timetable sessions
-- belonging to classes they are enrolled in.
create policy "Students can view teachers for their timetable sessions"
on public.plannix_session_teachers
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Student'
  ))
  and exists (
    select 1
    from public.plannix_timetable_sessions ts
    where ts.id = plannix_session_teachers.timetable_session_id
      and ts.organisation_id = plannix_session_teachers.organisation_id
      and (
        select private.plannix_student_is_in_class(
          ts.class_id,
          ts.organisation_id
        )
      )
  )
);

-- ============================================================
-- EVENT VISIBILITY HELPER
-- ============================================================

create or replace function private.plannix_can_view_event(
  target_event_id uuid,
  target_organisation_id uuid,
  target_visibility text,
  target_creator_organisation_user_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    -- Organisation-wide events can be seen by any member.
    (
      target_visibility = 'organisation'
      and exists (
        select 1
        from public.plannix_organisation_users ou
        where ou.organisation_id = target_organisation_id
          and ou.user_id = (select auth.uid())
      )
    )

    or

    -- Staff-only events can be seen by Admin, Staff or Read Only.
    (
      target_visibility = 'staff'
      and (
        private.plannix_has_access_role(
          target_organisation_id,
          'Organisation Admin'
        )
        or
        private.plannix_has_access_role(
          target_organisation_id,
          'Staff'
        )
        or
        private.plannix_has_access_role(
          target_organisation_id,
          'Read Only'
        )
      )
    )

    or

    -- Private events can be seen by their creator.
    (
      target_visibility = 'private'
      and exists (
        select 1
        from public.plannix_organisation_users ou
        where ou.id = target_creator_organisation_user_id
          and ou.user_id = (select auth.uid())
          and ou.organisation_id = target_organisation_id
      )
    )

    or

    -- Private events can also be seen by explicitly assigned users.
    (
      target_visibility = 'private'
      and exists (
        select 1
        from public.plannix_event_users eu
        join public.plannix_organisation_users ou
          on ou.id = eu.organisation_user_id
        where eu.event_id = target_event_id
          and eu.organisation_id = target_organisation_id
          and ou.user_id = (select auth.uid())
      )
    )

    or

    -- Class events can be seen by students who belong to
    -- one of the linked classes.
    (
      target_visibility = 'class'
      and exists (
        select 1
        from public.plannix_event_classes ec
        where ec.event_id = target_event_id
          and ec.organisation_id = target_organisation_id
          and private.plannix_student_is_in_class(
            ec.class_id,
            target_organisation_id
          )
      )
    )

    or

    -- Class events can also be seen by teachers assigned
    -- to one of the linked classes.
    (
      target_visibility = 'class'
      and exists (
        select 1
        from public.plannix_event_classes ec
        join public.plannix_class_teachers ct
          on ct.class_id = ec.class_id
         and ct.organisation_id = ec.organisation_id
        join public.plannix_organisation_users ou
          on ou.id = ct.organisation_user_id
        where ec.event_id = target_event_id
          and ec.organisation_id = target_organisation_id
          and ou.user_id = (select auth.uid())
      )
    );
$$;

revoke execute
on function private.plannix_can_view_event(uuid, uuid, text, uuid)
from public;

grant execute
on function private.plannix_can_view_event(uuid, uuid, text, uuid)
to authenticated;

-- ============================================================
-- EVENT READ ACCESS
-- ============================================================

drop policy if exists "Members can view organisation events"
on public.plannix_events;

create policy "Users can view allowed events"
on public.plannix_events
for select
to authenticated
using (
  (
    select private.plannix_can_view_event(
      id,
      organisation_id,
      visibility,
      created_by_organisation_user_id
    )
  )
);

-- ============================================================
-- EVENT CLASS READ ACCESS
-- ============================================================

drop policy if exists "Members can view organisation event classes"
on public.plannix_event_classes;

create policy "Users can view allowed event classes"
on public.plannix_event_classes
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_events e
    where e.id = plannix_event_classes.event_id
      and e.organisation_id = plannix_event_classes.organisation_id
      and (
        select private.plannix_can_view_event(
          e.id,
          e.organisation_id,
          e.visibility,
          e.created_by_organisation_user_id
        )
      )
  )
);


-- ============================================================
-- EVENT USER READ ACCESS
-- ============================================================

drop policy if exists "Members can view organisation event users"
on public.plannix_event_users;

create policy "Users can view allowed event users"
on public.plannix_event_users
for select
to authenticated
using (
  exists (
    select 1
    from public.plannix_events e
    where e.id = plannix_event_users.event_id
      and e.organisation_id = plannix_event_users.organisation_id
      and (
        select private.plannix_can_view_event(
          e.id,
          e.organisation_id,
          e.visibility,
          e.created_by_organisation_user_id
        )
      )
  )
);

-- ============================================================
-- STUDENT PROFILE VISIBILITY HELPER
-- ============================================================

create or replace function private.plannix_student_can_view_user(
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
    from public.plannix_class_teachers ct
    join public.plannix_organisation_users teacher_ou
      on teacher_ou.id = ct.organisation_user_id
     and teacher_ou.organisation_id = ct.organisation_id
    where teacher_ou.user_id = target_user_id
      and private.plannix_student_is_in_class(
        ct.class_id,
        ct.organisation_id
      )
  );
$$;

revoke execute
on function private.plannix_student_can_view_user(uuid)
from public;

grant execute
on function private.plannix_student_can_view_user(uuid)
to authenticated;


-- ============================================================
-- USER PROFILE READ ACCESS
-- ============================================================

drop policy if exists "Users can view profiles in their organisations"
on public.plannix_users;

-- Admin, Staff and Read Only can see profiles of users
-- who share one of their organisations.
create policy "Staff roles can view organisation profiles"
on public.plannix_users
for select
to authenticated
using (
  (
    select private.plannix_shares_organisation_with_user(id)
  )
  and (
    exists (
      select 1
      from public.plannix_organisation_users ou
      where ou.user_id = (select auth.uid())
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
          or
          private.plannix_has_access_role(
            ou.organisation_id,
            'Read Only'
          )
        )
    )
  )
);

-- Students can only see profiles of teachers attached
-- to one of their own classes.
create policy "Students can view their class teachers profiles"
on public.plannix_users
for select
to authenticated
using (
  (select private.plannix_student_can_view_user(id))
);

-- ============================================================
-- STAFF STRUCTURE READ ACCESS
-- ============================================================

drop policy if exists "Members can view organisation department users"
on public.plannix_department_users;

drop policy if exists "Members can view organisation position users"
on public.plannix_organisation_position_users;

drop policy if exists "Members can view organisation department position users"
on public.plannix_department_position_users;

drop policy if exists "Members can view organisation year group position users"
on public.plannix_year_group_position_users;


create policy "Staff roles can view organisation department users"
on public.plannix_department_users
for select
to authenticated
using (
  (select private.plannix_has_access_role(organisation_id, 'Organisation Admin'))
  or
  (select private.plannix_has_access_role(organisation_id, 'Staff'))
  or
  (select private.plannix_has_access_role(organisation_id, 'Read Only'))
);


create policy "Staff roles can view organisation position users"
on public.plannix_organisation_position_users
for select
to authenticated
using (
  (select private.plannix_has_access_role(organisation_id, 'Organisation Admin'))
  or
  (select private.plannix_has_access_role(organisation_id, 'Staff'))
  or
  (select private.plannix_has_access_role(organisation_id, 'Read Only'))
);


create policy "Staff roles can view organisation department position users"
on public.plannix_department_position_users
for select
to authenticated
using (
  (select private.plannix_has_access_role(organisation_id, 'Organisation Admin'))
  or
  (select private.plannix_has_access_role(organisation_id, 'Staff'))
  or
  (select private.plannix_has_access_role(organisation_id, 'Read Only'))
);


create policy "Staff roles can view organisation year group position users"
on public.plannix_year_group_position_users
for select
to authenticated
using (
  (select private.plannix_has_access_role(organisation_id, 'Organisation Admin'))
  or
  (select private.plannix_has_access_role(organisation_id, 'Staff'))
  or
  (select private.plannix_has_access_role(organisation_id, 'Read Only'))
);

-- ============================================================
-- ACCESS ROLE ASSIGNMENT READ HELPER
-- ============================================================

create or replace function private.plannix_can_view_access_role_assignment(
  target_organisation_user_id uuid
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
    where ou.id = target_organisation_user_id
      and (
        -- A user can always see their own role assignment.
        ou.user_id = (select auth.uid())

        or private.plannix_has_access_role(
          ou.organisation_id,
          'Organisation Admin'
        )

        or private.plannix_has_access_role(
          ou.organisation_id,
          'Staff'
        )

        or private.plannix_has_access_role(
          ou.organisation_id,
          'Read Only'
        )
      )
  );
$$;

revoke execute
on function private.plannix_can_view_access_role_assignment(uuid)
from public;

grant execute
on function private.plannix_can_view_access_role_assignment(uuid)
to authenticated;


-- ============================================================
-- ACCESS ROLE ASSIGNMENT READ ACCESS
-- ============================================================

drop policy if exists "Members can view organisation access role assignments"
on public.plannix_organisation_user_access_roles;

create policy "Users can view allowed access role assignments"
on public.plannix_organisation_user_access_roles
for select
to authenticated
using (
  (
    select private.plannix_can_view_access_role_assignment(
      organisation_user_id
    )
  )
);

-- ============================================================
-- ORGANISATION MEMBER READ ACCESS
-- ============================================================

create policy "Staff roles can view organisation members"
on public.plannix_organisation_users
for select
to authenticated
using (
  (select private.plannix_has_access_role(
    organisation_id,
    'Staff'
  ))
  or
  (select private.plannix_has_access_role(
    organisation_id,
    'Read Only'
  ))
);

