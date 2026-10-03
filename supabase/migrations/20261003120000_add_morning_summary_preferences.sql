begin;

-- A preference is not a scheduled job. The selected academic year is not
-- persisted here; a later scheduler must resolve that choice explicitly.
create table private.plannix_morning_summary_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  delivery_time time without time zone not null default '07:00',
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.now()
);
alter table private.plannix_morning_summary_preferences enable row level security;
revoke all on table private.plannix_morning_summary_preferences from public, anon, authenticated;

create function public.plannix_get_morning_summary_preferences(validated_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare preference private.plannix_morning_summary_preferences%rowtype;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  select p.* into preference from private.plannix_morning_summary_preferences as p
    where p.user_id = validated_user_id;
  return pg_catalog.jsonb_build_object(
    'enabled', coalesce(preference.enabled, false),
    'deliveryTime', coalesce(pg_catalog.left(preference.delivery_time::text, 5), '07:00'),
    'revision', coalesce(preference.revision, 0)
  );
end;
$$;
revoke all on function public.plannix_get_morning_summary_preferences(uuid) from public, anon, authenticated;
grant execute on function public.plannix_get_morning_summary_preferences(uuid) to service_role;

create function public.plannix_save_morning_summary_preferences(
  validated_user_id uuid, expected_revision bigint, target_enabled boolean, target_delivery_time text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare preference private.plannix_morning_summary_preferences%rowtype;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  if expected_revision is null or expected_revision < 0 or expected_revision >= 9007199254740991
    or target_enabled is null or target_delivery_time is null
    or target_delivery_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception using errcode = '22023', message = 'Invalid morning summary preferences.';
  end if;
  if expected_revision = 0 then
    insert into private.plannix_morning_summary_preferences (user_id, enabled, delivery_time)
      values (validated_user_id, target_enabled, target_delivery_time::time)
      on conflict (user_id) do nothing returning * into preference;
  else
    update private.plannix_morning_summary_preferences as p
      set enabled = target_enabled, delivery_time = target_delivery_time::time,
        revision = p.revision + 1, updated_at = pg_catalog.now()
      where p.user_id = validated_user_id and p.revision = expected_revision
      returning * into preference;
  end if;
  if not found then
    raise exception using errcode = '40001', message = 'Morning summary preferences changed.';
  end if;
  return pg_catalog.jsonb_build_object('enabled', preference.enabled,
    'deliveryTime', pg_catalog.left(preference.delivery_time::text, 5),
    'revision', preference.revision);
end;
$$;
revoke all on function public.plannix_save_morning_summary_preferences(uuid,bigint,boolean,text) from public, anon, authenticated;
grant execute on function public.plannix_save_morning_summary_preferences(uuid,bigint,boolean,text) to service_role;

commit;
