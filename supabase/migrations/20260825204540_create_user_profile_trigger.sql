-- ============================================================
-- PLANNIX USER PROFILE TRIGGER
-- ============================================================
--
-- PURPOSE:
-- Supabase Auth stores authentication information in:
--
--     auth.users
--
-- Plannix stores application-specific user information in:
--
--     public.plannix_users
--
-- Whenever Supabase creates a new auth.users record, this
-- trigger automatically creates the corresponding
-- plannix_users profile.
--
-- The same UUID is used in both tables:
--
-- auth.users.id
--       ↓
-- plannix_users.id
--
-- This works for email signup and is designed to also handle
-- OAuth providers such as Microsoft/Google.
-- ============================================================


-- ============================================================
-- 1. CREATE THE FUNCTION
-- ============================================================

create or replace function public.plannix_handle_new_user()
returns trigger

-- PL/pgSQL allows us to write procedural PostgreSQL code.
language plpgsql

-- The function needs permission to insert the profile when
-- auth.users creates a user.
security definer

-- Explicit search path is safer for SECURITY DEFINER functions.
set search_path = ''

as $$
declare

  -- Temporary variables used while processing the new user.
  v_first_name text;
  v_last_name text;
  v_full_name text;
  v_initials text;

begin

  -- ==========================================================
  -- 2. TRY TO GET FIRST NAME
  -- ==========================================================
  --
  -- Our own Plannix signup form can send:
  --
  -- options: {
  --   data: {
  --     first_name: "Rob",
  --     last_name: "Cafferkey"
  --   }
  -- }
  --
  -- Supabase stores this inside:
  --
  -- auth.users.raw_user_meta_data
  -- ==========================================================

  v_first_name :=
    nullif(
      trim(new.raw_user_meta_data ->> 'first_name'),
      ''
    );


  -- ==========================================================
  -- 3. TRY TO GET LAST NAME
  -- ==========================================================

  v_last_name :=
    nullif(
      trim(new.raw_user_meta_data ->> 'last_name'),
      ''
    );


  -- ==========================================================
  -- 4. CHECK FOR A FULL NAME
  -- ==========================================================
  --
  -- OAuth providers may not give us separate first_name and
  -- last_name values.
  --
  -- They may instead provide something such as:
  --
  -- full_name = "Rob Cafferkey"
  --
  -- or:
  --
  -- name = "Rob Cafferkey"
  --
  -- COALESCE uses the first value that isn't NULL.
  -- ==========================================================

  v_full_name :=
    nullif(
      trim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name'
        )
      ),
      ''
    );


  -- ==========================================================
  -- 5. DERIVE FIRST NAME FROM FULL NAME IF NECESSARY
  -- ==========================================================
  --
  -- Example:
  --
  -- "Rob Cafferkey"
  --
  -- becomes:
  --
  -- first_name = "Rob"
  -- ==========================================================

  if v_first_name is null
     and v_full_name is not null then

    v_first_name :=
      split_part(v_full_name, ' ', 1);

  end if;


  -- ==========================================================
  -- 6. DERIVE LAST NAME FROM FULL NAME IF NECESSARY
  -- ==========================================================
  --
  -- Example:
  --
  -- "Rob Cafferkey"
  --
  -- becomes:
  --
  -- last_name = "Cafferkey"
  --
  -- If someone has multiple surnames/names after their first
  -- name, everything after the first space is retained.
  -- ==========================================================

  if v_last_name is null
     and v_full_name is not null then

    v_last_name :=
      nullif(
        trim(
          substring(
            v_full_name
            from position(' ' in v_full_name) + 1
          )
        ),
        ''
      );

  end if;


  -- ==========================================================
  -- 7. FALLBACK FIRST NAME
  -- ==========================================================
  --
  -- We do NOT want a missing OAuth name to cause the entire
  -- Supabase signup to fail.
  --
  -- Therefore, if no name was supplied, temporarily use:
  --
  -- "User"
  --
  -- Plannix could later ask the user to complete their profile.
  -- ==========================================================

  if v_first_name is null then
    v_first_name := 'User';
  end if;


  -- ==========================================================
  -- 8. FALLBACK LAST NAME
  -- ==========================================================
  --
  -- plannix_users.last_name is NOT NULL.
  --
  -- An empty string therefore allows the profile to be created
  -- without blocking authentication.
  -- ==========================================================

  if v_last_name is null then
    v_last_name := '';
  end if;


  -- ==========================================================
  -- 9. CHECK WHETHER INITIALS WERE PROVIDED
  -- ==========================================================

  v_initials :=
    nullif(
      trim(new.raw_user_meta_data ->> 'initials'),
      ''
    );


  -- ==========================================================
  -- 10. GENERATE INITIALS
  -- ==========================================================
  --
  -- If initials weren't provided, Plannix generates them.
  --
  -- Example:
  --
  -- first_name = "Rob"
  -- last_name  = "Cafferkey"
  --
  -- gives:
  --
  -- initials = "RC"
  -- ==========================================================

  if v_initials is null then

    v_initials :=
      upper(
        left(v_first_name, 1)
        ||
        case
          when length(v_last_name) > 0
            then left(v_last_name, 1)
          else ''
        end
      );

  end if;


  -- ==========================================================
  -- 11. CREATE THE PLANNIX PROFILE
  -- ==========================================================
  --
  -- IMPORTANT:
  --
  -- new.id is the UUID generated by Supabase Auth.
  --
  -- We use exactly the same UUID for plannix_users.id.
  --
  -- This creates the relationship:
  --
  -- auth.users
  --      │
  --      │ id
  --      ▼
  -- plannix_users
  --
  -- created_at and updated_at don't need to be supplied because
  -- the table already gives them DEFAULT now().
  -- ==========================================================

  insert into public.plannix_users (
    id,
    first_name,
    last_name,
    initials
  )
  values (
    new.id,
    v_first_name,
    v_last_name,
    v_initials
  )

  -- This protects against accidentally attempting to create
  -- the same Plannix profile twice.
  on conflict (id) do nothing;


  -- ==========================================================
  -- 12. RETURN THE AUTH USER
  -- ==========================================================
  --
  -- PostgreSQL trigger functions must return the row that
  -- caused the trigger.
  -- ==========================================================

  return new;

end;
$$;


-- ============================================================
-- 13. REMOVE AN OLD VERSION OF THE TRIGGER IF IT EXISTS
-- ============================================================
--
-- This makes the migration safer if the trigger was previously
-- created during development.
-- ============================================================

drop trigger if exists on_plannix_auth_user_created
on auth.users;


-- ============================================================
-- 14. CREATE THE TRIGGER
-- ============================================================
--
-- AFTER INSERT means:
--
-- Supabase creates auth.users
--          ↓
-- this trigger runs
--          ↓
-- plannix_handle_new_user() executes
--          ↓
-- plannix_users profile is created
--
-- FOR EACH ROW means the function runs once for every new user.
-- ============================================================

create trigger on_plannix_auth_user_created
after insert on auth.users
for each row
execute function public.plannix_handle_new_user();