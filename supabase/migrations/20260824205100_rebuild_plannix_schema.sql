-- Plannix clean schema rebuild
-- Designed for Supabase/PostgreSQL
-- IMPORTANT: This migration does NOT drop or modify auth.users.
-- It rebuilds only the Plannix application schema in public.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- DROP OLD / CURRENT PLANNIX TABLES
-- ============================================================

-- New-schema tables first
drop table if exists public.plannix_event_users cascade;
drop table if exists public.plannix_event_classes cascade;
drop table if exists public.plannix_events cascade;

drop table if exists public.plannix_session_teachers cascade;
drop table if exists public.plannix_timetable_sessions cascade;
drop table if exists public.plannix_timetable_periods cascade;
drop table if exists public.plannix_timetable_weeks cascade;
drop table if exists public.plannix_timetables cascade;

drop table if exists public.plannix_class_students cascade;
drop table if exists public.plannix_class_subjects cascade;
drop table if exists public.plannix_class_teachers cascade;
drop table if exists public.plannix_classes cascade;
drop table if exists public.plannix_subjects cascade;

drop table if exists public.plannix_student_year_groups cascade;
drop table if exists public.plannix_students cascade;

drop table if exists public.plannix_year_group_position_users cascade;
drop table if exists public.plannix_year_group_positions cascade;
drop table if exists public.plannix_year_groups cascade;

drop table if exists public.plannix_holidays cascade;
drop table if exists public.plannix_terms cascade;
drop table if exists public.plannix_academic_years cascade;

drop table if exists public.plannix_department_position_users cascade;
drop table if exists public.plannix_department_positions cascade;
drop table if exists public.plannix_organisation_position_users cascade;
drop table if exists public.plannix_positions cascade;
drop table if exists public.plannix_department_users cascade;
drop table if exists public.plannix_departments cascade;

drop table if exists public.plannix_organisation_user_access_roles cascade;
drop table if exists public.plannix_access_roles cascade;
drop table if exists public.plannix_organisation_users cascade;
drop table if exists public.plannix_organisations cascade;

drop table if exists public.plannix_users cascade;

-- Legacy tables from the current Plannix prototype
drop table if exists public.plannix_sessions cascade;
drop table if exists public.plannix_password_reset_tokens cascade;
drop table if exists public.plannix_timetable_layouts cascade;

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

create or replace function public.plannix_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- USERS / ORGANISATIONS
-- ============================================================

create table public.plannix_users (
  id uuid primary key
    references auth.users(id)
    on delete cascade,

  first_name text not null,
  last_name text not null,
  initials text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_plannix_users_first_name
    check (length(trim(first_name)) > 0),

  constraint chk_plannix_users_last_name
    check (length(trim(last_name)) > 0),

  constraint chk_plannix_users_initials
    check (length(trim(initials)) between 1 and 10)
);

create trigger trg_plannix_users_updated_at
before update on public.plannix_users
for each row execute function public.plannix_set_updated_at();


create table public.plannix_organisations (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  organisation_type text not null,
  address text,
  postcode text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_plannix_organisations_name
    check (length(trim(name)) > 0),

  constraint chk_plannix_organisations_type
    check (organisation_type in ('personal', 'school')),

  constraint uq_plannix_organisation_id_type
    unique (id, organisation_type)
);

create trigger trg_plannix_organisations_updated_at
before update on public.plannix_organisations
for each row execute function public.plannix_set_updated_at();


create table public.plannix_organisation_users (
  id uuid primary key default gen_random_uuid(),

  organisation_id uuid not null,
  user_id uuid not null,

  constraint fk_plannix_organisation_users_organisation
    foreign key (organisation_id)
    references public.plannix_organisations(id)
    on delete cascade,

  constraint fk_plannix_organisation_users_user
    foreign key (user_id)
    references public.plannix_users(id)
    on delete cascade,

  constraint uq_plannix_organisation_users
    unique (organisation_id, user_id),

  -- Supports composite FKs from organisation-scoped relationships
  constraint uq_plannix_organisation_users_id_org
    unique (id, organisation_id)
);

create index idx_plannix_organisation_users_user
  on public.plannix_organisation_users(user_id);


-- ============================================================
-- ACCESS ROLES
-- ============================================================

create table public.plannix_access_roles (
  id uuid primary key default gen_random_uuid(),

  name text not null unique,
  description text,

  constraint chk_plannix_access_roles_name
    check (length(trim(name)) > 0)
);


create table public.plannix_organisation_user_access_roles (
  id uuid primary key default gen_random_uuid(),

  organisation_user_id uuid not null,
  access_role_id uuid not null,

  constraint fk_plannix_ouar_organisation_user
    foreign key (organisation_user_id)
    references public.plannix_organisation_users(id)
    on delete cascade,

  constraint fk_plannix_ouar_access_role
    foreign key (access_role_id)
    references public.plannix_access_roles(id)
    on delete cascade,

  constraint uq_plannix_organisation_user_access_roles
    unique (organisation_user_id, access_role_id)
);


-- ============================================================
-- DEPARTMENTS / POSITIONS
-- ============================================================

create table public.plannix_departments (
  id uuid primary key default gen_random_uuid(),

  organisation_id uuid not null,
  name text not null,
  code text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_departments_organisation
    foreign key (organisation_id)
    references public.plannix_organisations(id)
    on delete cascade,

  constraint chk_plannix_departments_name
    check (length(trim(name)) > 0),

  constraint uq_plannix_departments_name
    unique (organisation_id, name),

  constraint uq_plannix_departments_code
    unique (organisation_id, code),

  constraint uq_plannix_departments_id_org
    unique (id, organisation_id)
);

create trigger trg_plannix_departments_updated_at
before update on public.plannix_departments
for each row execute function public.plannix_set_updated_at();


create table public.plannix_department_users (
  id uuid primary key default gen_random_uuid(),

  department_id uuid not null,
  organisation_user_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_department_users_department
    foreign key (department_id, organisation_id)
    references public.plannix_departments(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_department_users_org_user
    foreign key (organisation_user_id, organisation_id)
    references public.plannix_organisation_users(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_department_users
    unique (department_id, organisation_user_id)
);


create table public.plannix_positions (
  id uuid primary key default gen_random_uuid(),

  organisation_id uuid not null,
  name text not null,
  position_scope text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_positions_organisation
    foreign key (organisation_id)
    references public.plannix_organisations(id)
    on delete cascade,

  constraint chk_plannix_positions_name
    check (length(trim(name)) > 0),

  constraint chk_plannix_positions_scope
    check (position_scope in ('organisation', 'department', 'year_group')),

  constraint uq_plannix_positions_name_scope
    unique (organisation_id, name, position_scope),

  constraint uq_plannix_positions_id_org
    unique (id, organisation_id)
);

create trigger trg_plannix_positions_updated_at
before update on public.plannix_positions
for each row execute function public.plannix_set_updated_at();


create table public.plannix_organisation_position_users (
  id uuid primary key default gen_random_uuid(),

  position_id uuid not null,
  organisation_user_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_org_position_users_position
    foreign key (position_id, organisation_id)
    references public.plannix_positions(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_org_position_users_org_user
    foreign key (organisation_user_id, organisation_id)
    references public.plannix_organisation_users(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_organisation_position_users
    unique (position_id, organisation_user_id)
);


create table public.plannix_department_positions (
  id uuid primary key default gen_random_uuid(),

  department_id uuid not null,
  position_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_department_positions_department
    foreign key (department_id, organisation_id)
    references public.plannix_departments(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_department_positions_position
    foreign key (position_id, organisation_id)
    references public.plannix_positions(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_department_positions
    unique (department_id, position_id),

  constraint uq_plannix_department_positions_id_org
    unique (id, organisation_id)
);


create table public.plannix_department_position_users (
  id uuid primary key default gen_random_uuid(),

  department_position_id uuid not null,
  organisation_user_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_department_position_users_dp
    foreign key (department_position_id, organisation_id)
    references public.plannix_department_positions(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_department_position_users_org_user
    foreign key (organisation_user_id, organisation_id)
    references public.plannix_organisation_users(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_department_position_users
    unique (department_position_id, organisation_user_id)
);


-- ============================================================
-- ACADEMIC YEARS / TERMS / HOLIDAYS
-- ============================================================

create table public.plannix_academic_years (
  id uuid primary key default gen_random_uuid(),

  organisation_id uuid not null,
  name text not null,
  start_date date not null,
  end_date date not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_academic_years_organisation
    foreign key (organisation_id)
    references public.plannix_organisations(id)
    on delete cascade,

  constraint chk_plannix_academic_years_dates
    check (end_date > start_date),

  constraint chk_plannix_academic_years_name
    check (length(trim(name)) > 0),

  constraint uq_plannix_academic_years_name
    unique (organisation_id, name),

  constraint uq_plannix_academic_years_id_org
    unique (id, organisation_id)
);

create trigger trg_plannix_academic_years_updated_at
before update on public.plannix_academic_years
for each row execute function public.plannix_set_updated_at();


create table public.plannix_terms (
  id uuid primary key default gen_random_uuid(),

  academic_year_id uuid not null,
  name text not null,
  start_date date not null,
  end_date date not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_terms_academic_year
    foreign key (academic_year_id)
    references public.plannix_academic_years(id)
    on delete cascade,

  constraint chk_plannix_terms_dates
    check (end_date >= start_date),

  constraint chk_plannix_terms_name
    check (length(trim(name)) > 0),

  constraint uq_plannix_terms_name
    unique (academic_year_id, name)
);

create trigger trg_plannix_terms_updated_at
before update on public.plannix_terms
for each row execute function public.plannix_set_updated_at();


create table public.plannix_holidays (
  id uuid primary key default gen_random_uuid(),

  academic_year_id uuid not null,
  name text not null,
  start_date date not null,
  end_date date not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_holidays_academic_year
    foreign key (academic_year_id)
    references public.plannix_academic_years(id)
    on delete cascade,

  constraint chk_plannix_holidays_dates
    check (end_date >= start_date),

  constraint chk_plannix_holidays_name
    check (length(trim(name)) > 0)
);

create trigger trg_plannix_holidays_updated_at
before update on public.plannix_holidays
for each row execute function public.plannix_set_updated_at();


-- ============================================================
-- YEAR GROUPS
-- ============================================================

create table public.plannix_year_groups (
  id uuid primary key default gen_random_uuid(),

  academic_year_id uuid not null,
  organisation_id uuid not null,
  name text not null,
  year_number integer not null,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_year_groups_academic_year
    foreign key (academic_year_id, organisation_id)
    references public.plannix_academic_years(id, organisation_id)
    on delete cascade,

  constraint chk_plannix_year_groups_name
    check (length(trim(name)) > 0),

  constraint chk_plannix_year_groups_year_number
    check (year_number between 0 and 14),

  constraint uq_plannix_year_groups_name
    unique (academic_year_id, name),

  constraint uq_plannix_year_groups_number
    unique (academic_year_id, year_number),

  constraint uq_plannix_year_groups_id_org
    unique (id, organisation_id),

  constraint uq_plannix_year_groups_id_academic_year
    unique (id, academic_year_id)
);

create trigger trg_plannix_year_groups_updated_at
before update on public.plannix_year_groups
for each row execute function public.plannix_set_updated_at();


create table public.plannix_year_group_positions (
  id uuid primary key default gen_random_uuid(),

  year_group_id uuid not null,
  position_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_year_group_positions_year_group
    foreign key (year_group_id, organisation_id)
    references public.plannix_year_groups(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_year_group_positions_position
    foreign key (position_id, organisation_id)
    references public.plannix_positions(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_year_group_positions
    unique (year_group_id, position_id),

  constraint uq_plannix_year_group_positions_id_org
    unique (id, organisation_id)
);


create table public.plannix_year_group_position_users (
  id uuid primary key default gen_random_uuid(),

  year_group_position_id uuid not null,
  organisation_user_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_year_group_position_users_ygp
    foreign key (year_group_position_id, organisation_id)
    references public.plannix_year_group_positions(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_year_group_position_users_org_user
    foreign key (organisation_user_id, organisation_id)
    references public.plannix_organisation_users(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_year_group_position_users
    unique (year_group_position_id, organisation_user_id)
);


-- ============================================================
-- STUDENTS
-- ============================================================

create table public.plannix_students (
  id uuid primary key default gen_random_uuid(),

  organisation_id uuid not null,

  -- Nullable: a student does not need a Plannix login.
  -- If they later receive one, this links to their membership in this organisation.
  organisation_user_id uuid,

  first_name text not null,
  last_name text not null,
  student_number text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_students_organisation
    foreign key (organisation_id)
    references public.plannix_organisations(id)
    on delete cascade,

  constraint fk_plannix_students_org_user
    foreign key (organisation_user_id, organisation_id)
    references public.plannix_organisation_users(id, organisation_id)
    on delete set null,

  constraint chk_plannix_students_first_name
    check (length(trim(first_name)) > 0),

  constraint chk_plannix_students_last_name
    check (length(trim(last_name)) > 0),

  constraint uq_plannix_students_student_number
    unique (organisation_id, student_number),

  constraint uq_plannix_students_org_user
    unique (organisation_user_id),

  constraint uq_plannix_students_id_org
    unique (id, organisation_id)
);

create trigger trg_plannix_students_updated_at
before update on public.plannix_students
for each row execute function public.plannix_set_updated_at();


create table public.plannix_student_year_groups (
  id uuid primary key default gen_random_uuid(),

  student_id uuid not null,
  year_group_id uuid not null,
  organisation_id uuid not null,
  academic_year_id uuid not null,

  constraint fk_plannix_student_year_groups_student
    foreign key (student_id, organisation_id)
    references public.plannix_students(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_student_year_groups_year_group_org
    foreign key (year_group_id, organisation_id)
    references public.plannix_year_groups(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_student_year_groups_year_group_year
    foreign key (year_group_id, academic_year_id)
    references public.plannix_year_groups(id, academic_year_id)
    on delete cascade,

  -- A student can only belong to one year group in a given academic year.
  constraint uq_plannix_student_year_per_year
    unique (student_id, academic_year_id),

  constraint uq_plannix_student_year_group
    unique (student_id, year_group_id)
);


-- ============================================================
-- SUBJECTS / CLASSES
-- ============================================================

create table public.plannix_subjects (
  id uuid primary key default gen_random_uuid(),

  organisation_id uuid not null,
  name text not null,
  code text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_subjects_organisation
    foreign key (organisation_id)
    references public.plannix_organisations(id)
    on delete cascade,

  constraint chk_plannix_subjects_name
    check (length(trim(name)) > 0),

  constraint uq_plannix_subjects_name
    unique (organisation_id, name),

  constraint uq_plannix_subjects_code
    unique (organisation_id, code),

  constraint uq_plannix_subjects_id_org
    unique (id, organisation_id)
);

create trigger trg_plannix_subjects_updated_at
before update on public.plannix_subjects
for each row execute function public.plannix_set_updated_at();


create table public.plannix_classes (
  id uuid primary key default gen_random_uuid(),

  organisation_id uuid not null,
  academic_year_id uuid not null,
  name text not null,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_classes_academic_year
    foreign key (academic_year_id, organisation_id)
    references public.plannix_academic_years(id, organisation_id)
    on delete cascade,

  constraint chk_plannix_classes_name
    check (length(trim(name)) > 0),

  constraint uq_plannix_classes_name
    unique (academic_year_id, name),

  constraint uq_plannix_classes_id_org
    unique (id, organisation_id),

  constraint uq_plannix_classes_id_academic_year
    unique (id, academic_year_id)
);

create trigger trg_plannix_classes_updated_at
before update on public.plannix_classes
for each row execute function public.plannix_set_updated_at();


create table public.plannix_class_teachers (
  id uuid primary key default gen_random_uuid(),

  class_id uuid not null,
  organisation_user_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_class_teachers_class
    foreign key (class_id, organisation_id)
    references public.plannix_classes(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_class_teachers_org_user
    foreign key (organisation_user_id, organisation_id)
    references public.plannix_organisation_users(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_class_teachers
    unique (class_id, organisation_user_id)
);


create table public.plannix_class_subjects (
  id uuid primary key default gen_random_uuid(),

  class_id uuid not null,
  subject_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_class_subjects_class
    foreign key (class_id, organisation_id)
    references public.plannix_classes(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_class_subjects_subject
    foreign key (subject_id, organisation_id)
    references public.plannix_subjects(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_class_subjects
    unique (class_id, subject_id)
);


create table public.plannix_class_students (
  id uuid primary key default gen_random_uuid(),

  class_id uuid not null,
  student_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_class_students_class
    foreign key (class_id, organisation_id)
    references public.plannix_classes(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_class_students_student
    foreign key (student_id, organisation_id)
    references public.plannix_students(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_class_students
    unique (class_id, student_id)
);


-- ============================================================
-- TIMETABLES
-- ============================================================

create table public.plannix_timetables (
  id uuid primary key default gen_random_uuid(),

  organisation_id uuid not null,
  academic_year_id uuid not null,

  name text not null,
  days_per_week integer not null default 5,
  active_from date not null,
  active_to date not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_timetables_academic_year
    foreign key (academic_year_id, organisation_id)
    references public.plannix_academic_years(id, organisation_id)
    on delete cascade,

  constraint chk_plannix_timetables_name
    check (length(trim(name)) > 0),

  constraint chk_plannix_timetables_days
    check (days_per_week between 1 and 7),

  constraint chk_plannix_timetables_dates
    check (active_to >= active_from),

  constraint uq_plannix_timetables_name
    unique (academic_year_id, name),

  constraint uq_plannix_timetables_id_org
    unique (id, organisation_id),

  constraint uq_plannix_timetables_id_academic_year
    unique (id, academic_year_id)
);

create trigger trg_plannix_timetables_updated_at
before update on public.plannix_timetables
for each row execute function public.plannix_set_updated_at();


create table public.plannix_timetable_weeks (
  id uuid primary key default gen_random_uuid(),

  timetable_id uuid not null,
  code text not null,
  name text not null,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_timetable_weeks_timetable
    foreign key (timetable_id)
    references public.plannix_timetables(id)
    on delete cascade,

  constraint chk_plannix_timetable_weeks_code
    check (length(trim(code)) > 0),

  constraint chk_plannix_timetable_weeks_name
    check (length(trim(name)) > 0),

  constraint uq_plannix_timetable_weeks_code
    unique (timetable_id, code),

  constraint uq_plannix_timetable_weeks_id_timetable
    unique (id, timetable_id)
);

create trigger trg_plannix_timetable_weeks_updated_at
before update on public.plannix_timetable_weeks
for each row execute function public.plannix_set_updated_at();


create table public.plannix_timetable_periods (
  id uuid primary key default gen_random_uuid(),

  timetable_id uuid not null,
  period_number integer not null,
  label text not null,
  start_time time not null,
  end_time time not null,
  is_break boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_timetable_periods_timetable
    foreign key (timetable_id)
    references public.plannix_timetables(id)
    on delete cascade,

  constraint chk_plannix_timetable_periods_number
    check (period_number > 0),

  constraint chk_plannix_timetable_periods_label
    check (length(trim(label)) > 0),

  constraint chk_plannix_timetable_periods_times
    check (end_time > start_time),

  constraint uq_plannix_timetable_periods_number
    unique (timetable_id, period_number),

  constraint uq_plannix_timetable_periods_id_timetable
    unique (id, timetable_id)
);

create trigger trg_plannix_timetable_periods_updated_at
before update on public.plannix_timetable_periods
for each row execute function public.plannix_set_updated_at();


create table public.plannix_timetable_sessions (
  id uuid primary key default gen_random_uuid(),

  timetable_id uuid not null,
  timetable_week_id uuid not null,
  class_id uuid not null,
  period_id uuid not null,
  academic_year_id uuid not null,
  organisation_id uuid not null,

  day_number integer not null,
  title text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_timetable_sessions_timetable_year
    foreign key (timetable_id, academic_year_id)
    references public.plannix_timetables(id, academic_year_id)
    on delete cascade,

  constraint fk_plannix_timetable_sessions_timetable_org
    foreign key (timetable_id, organisation_id)
    references public.plannix_timetables(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_timetable_sessions_week
    foreign key (timetable_week_id, timetable_id)
    references public.plannix_timetable_weeks(id, timetable_id)
    on delete cascade,

  constraint fk_plannix_timetable_sessions_period
    foreign key (period_id, timetable_id)
    references public.plannix_timetable_periods(id, timetable_id)
    on delete cascade,

  constraint fk_plannix_timetable_sessions_class_year
    foreign key (class_id, academic_year_id)
    references public.plannix_classes(id, academic_year_id)
    on delete cascade,

  constraint fk_plannix_timetable_sessions_class_org
    foreign key (class_id, organisation_id)
    references public.plannix_classes(id, organisation_id)
    on delete cascade,

  constraint chk_plannix_timetable_sessions_day
    check (day_number between 1 and 7),

  -- Prevents two classes occupying the exact same timetable slot.
  constraint uq_plannix_timetable_session_slot
    unique (timetable_id, timetable_week_id, day_number, period_id),

  constraint uq_plannix_timetable_sessions_id_org
    unique (id, organisation_id)
);

create trigger trg_plannix_timetable_sessions_updated_at
before update on public.plannix_timetable_sessions
for each row execute function public.plannix_set_updated_at();


create table public.plannix_session_teachers (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null,
  organisation_user_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_session_teachers_session
    foreign key (session_id, organisation_id)
    references public.plannix_timetable_sessions(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_session_teachers_org_user
    foreign key (organisation_user_id, organisation_id)
    references public.plannix_organisation_users(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_session_teachers
    unique (session_id, organisation_user_id)
);


-- ============================================================
-- EVENTS
-- ============================================================

create table public.plannix_events (
  id uuid primary key default gen_random_uuid(),

  organisation_id uuid not null,
  academic_year_id uuid,
  created_by_organisation_user_id uuid not null,

  title text not null,
  description text,
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,
  event_type text,
  visibility text not null default 'private',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fk_plannix_events_organisation
    foreign key (organisation_id)
    references public.plannix_organisations(id)
    on delete cascade,

  constraint fk_plannix_events_academic_year
    foreign key (academic_year_id, organisation_id)
    references public.plannix_academic_years(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_events_creator
    foreign key (created_by_organisation_user_id, organisation_id)
    references public.plannix_organisation_users(id, organisation_id)
    on delete restrict,

  constraint chk_plannix_events_title
    check (length(trim(title)) > 0),

  constraint chk_plannix_events_dates
    check (end_datetime >= start_datetime),

  constraint chk_plannix_events_visibility
    check (visibility in ('private', 'class', 'staff', 'organisation')),

  constraint uq_plannix_events_id_org
    unique (id, organisation_id)
);

create trigger trg_plannix_events_updated_at
before update on public.plannix_events
for each row execute function public.plannix_set_updated_at();


create table public.plannix_event_classes (
  id uuid primary key default gen_random_uuid(),

  event_id uuid not null,
  class_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_event_classes_event
    foreign key (event_id, organisation_id)
    references public.plannix_events(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_event_classes_class
    foreign key (class_id, organisation_id)
    references public.plannix_classes(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_event_classes
    unique (event_id, class_id)
);


create table public.plannix_event_users (
  id uuid primary key default gen_random_uuid(),

  event_id uuid not null,
  organisation_user_id uuid not null,
  organisation_id uuid not null,

  constraint fk_plannix_event_users_event
    foreign key (event_id, organisation_id)
    references public.plannix_events(id, organisation_id)
    on delete cascade,

  constraint fk_plannix_event_users_org_user
    foreign key (organisation_user_id, organisation_id)
    references public.plannix_organisation_users(id, organisation_id)
    on delete cascade,

  constraint uq_plannix_event_users
    unique (event_id, organisation_user_id)
);


-- ============================================================
-- USEFUL INDEXES
-- ============================================================

create index idx_plannix_academic_years_org
  on public.plannix_academic_years(organisation_id);

create index idx_plannix_students_org
  on public.plannix_students(organisation_id);

create index idx_plannix_classes_year
  on public.plannix_classes(academic_year_id);

create index idx_plannix_classes_org
  on public.plannix_classes(organisation_id);

create index idx_plannix_timetables_year
  on public.plannix_timetables(academic_year_id);

create index idx_plannix_timetable_sessions_class
  on public.plannix_timetable_sessions(class_id);

create index idx_plannix_events_org_dates
  on public.plannix_events(organisation_id, start_datetime, end_datetime);


-- ============================================================
-- OPTIONAL STARTER ACCESS ROLES
-- ============================================================

insert into public.plannix_access_roles (name, description)
values
  ('Organisation Admin', 'Full administration access within an organisation'),
  ('Staff', 'Standard staff access'),
  ('Student', 'Student access'),
  ('Read Only', 'Read-only access')
on conflict (name) do nothing;

commit;

-- ============================================================
-- NEXT STEP
-- ============================================================
-- Add Supabase Row Level Security policies in a separate migration.
-- Keeping RLS separate makes the structural schema easier to test
-- before access-control rules are introduced.