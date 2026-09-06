create or replace function public.plannix_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_name text;
  v_last_name text;
  v_full_name text;
  v_initials text;

begin

  v_first_name :=
    nullif(
      trim(new.raw_user_meta_data ->> 'first_name'),
      ''
    );

  v_last_name :=
    nullif(
      trim(new.raw_user_meta_data ->> 'last_name'),
      ''
    );

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

  if v_first_name is null
     and v_full_name is not null then

    v_first_name :=
      split_part(v_full_name, ' ', 1);

  end if;

  if v_last_name is null
     and v_full_name is not null
     and position(' ' in v_full_name) > 0 then

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

  if v_first_name is null then
    v_first_name := 'User';
  end if;

  if v_last_name is null then
    v_last_name := 'User';
  end if;

  v_initials :=
    nullif(
      trim(new.raw_user_meta_data ->> 'initials'),
      ''
    );

  if v_initials is null then

    v_initials :=
      upper(
        left(v_first_name, 1)
        ||
        left(v_last_name, 1)
      );

  end if;

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
  on conflict (id) do nothing;

  return new;

end;
$$;