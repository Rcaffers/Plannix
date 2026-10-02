begin;

create table private.plannix_push_subscriptions (
  endpoint_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  subscription_version uuid not null default pg_catalog.gen_random_uuid(),
  created_at timestamptz not null default pg_catalog.now(),
  last_test_at timestamptz,
  constraint chk_push_hash check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  constraint chk_push_lengths check (pg_catalog.length(endpoint) between 30 and 2048
    and pg_catalog.length(p256dh) between 80 and 128
    and pg_catalog.length(auth_key) between 16 and 32)
);
create index idx_push_subscriptions_user on private.plannix_push_subscriptions(user_id);
alter table private.plannix_push_subscriptions enable row level security;
revoke all on table private.plannix_push_subscriptions from public, anon, authenticated;

create function private.plannix_confirm_push_user(validated_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if validated_user_id is null or not exists (
    select 1 from auth.users as u where u.id = validated_user_id and u.email_confirmed_at is not null
  ) then
    raise exception using errcode = '42501', message = 'Confirmed user required.';
  end if;
end;
$$;
revoke all on function private.plannix_confirm_push_user(uuid) from public, anon, authenticated;

create function public.plannix_push_device_status(validated_user_id uuid, target_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  return exists (select 1 from private.plannix_push_subscriptions as s
    where s.user_id = validated_user_id and s.endpoint_hash = target_hash);
end;
$$;
revoke all on function public.plannix_push_device_status(uuid,text) from public, anon, authenticated;
grant execute on function public.plannix_push_device_status(uuid,text) to service_role;

create function public.plannix_push_register_device(
  validated_user_id uuid, target_hash text, target_endpoint text, target_p256dh text, target_auth text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  if target_hash !~ '^[0-9a-f]{64}$'
    or pg_catalog.length(target_endpoint) not between 30 and 2048
    or pg_catalog.length(target_p256dh) not between 80 and 128
    or pg_catalog.length(target_auth) not between 16 and 32 then
    raise exception using errcode = '22023', message = 'Invalid push subscription.';
  end if;
  -- Serialize device-count checks and reassignment for this account.
  perform 1 from auth.users as u where u.id = validated_user_id for update;
  if not exists (select 1 from private.plannix_push_subscriptions as s
    where s.endpoint_hash = target_hash and s.user_id = validated_user_id)
    and (select pg_catalog.count(*) from private.plannix_push_subscriptions as s where s.user_id = validated_user_id) >= 10 then
    raise exception using errcode = 'P1001', message = 'Device limit reached.';
  end if;
  insert into private.plannix_push_subscriptions as existing (endpoint_hash,user_id,endpoint,p256dh,auth_key)
  values (target_hash,validated_user_id,target_endpoint,target_p256dh,target_auth)
  on conflict (endpoint_hash) do update set user_id = excluded.user_id,
    endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth_key = excluded.auth_key,
    subscription_version = pg_catalog.gen_random_uuid(),
    last_test_at = case when existing.user_id = excluded.user_id then existing.last_test_at else null end;
  return true;
end;
$$;
revoke all on function public.plannix_push_register_device(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.plannix_push_register_device(uuid,text,text,text,text) to service_role;

create function public.plannix_push_claim_device(
  validated_user_id uuid, target_hash text, target_p256dh text, target_auth text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare device private.plannix_push_subscriptions%rowtype;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  select s.* into device from private.plannix_push_subscriptions as s
    where s.endpoint_hash = target_hash and s.user_id = validated_user_id;
  if not found then return pg_catalog.jsonb_build_object('state','absent'); end if;
  if target_p256dh is null or target_auth is null
    or device.p256dh <> target_p256dh or device.auth_key <> target_auth then
    return pg_catalog.jsonb_build_object('state','superseded');
  end if;
  return pg_catalog.jsonb_build_object('state','current','version',device.subscription_version);
end;
$$;
revoke all on function public.plannix_push_claim_device(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.plannix_push_claim_device(uuid,text,text,text) to service_role;

create function public.plannix_push_remove_device(validated_user_id uuid, target_hash text, claimed_version uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare removed_count integer;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  delete from private.plannix_push_subscriptions as s
    where s.user_id = validated_user_id and s.endpoint_hash = target_hash
      and s.subscription_version = claimed_version;
  get diagnostics removed_count = row_count;
  return removed_count = 1;
end;
$$;
revoke all on function public.plannix_push_remove_device(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.plannix_push_remove_device(uuid,text,uuid) to service_role;

-- Expiry from an older in-flight send must not remove a replacement.
create function public.plannix_push_remove_expired_device(
  validated_user_id uuid, target_hash text, claimed_version uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare removed_count integer;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  delete from private.plannix_push_subscriptions as s
    where s.user_id = validated_user_id and s.endpoint_hash = target_hash
      and s.subscription_version = claimed_version;
  get diagnostics removed_count = row_count;
  return removed_count = 1;
end;
$$;
revoke all on function public.plannix_push_remove_expired_device(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.plannix_push_remove_expired_device(uuid,text,uuid) to service_role;

create function public.plannix_push_claim_test(validated_user_id uuid, target_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare device private.plannix_push_subscriptions%rowtype;
begin
  perform private.plannix_confirm_push_user(validated_user_id);
  -- Serialize the per-user attempt limit across every registered device.
  perform 1 from auth.users as u where u.id = validated_user_id for update;
  select s.* into device from private.plannix_push_subscriptions as s
    where s.user_id = validated_user_id and s.endpoint_hash = target_hash for update;
  if not found then raise exception using errcode = 'P0002', message = 'Device not found.'; end if;
  if exists (select 1 from private.plannix_push_subscriptions as s
    where s.user_id = validated_user_id and s.last_test_at > pg_catalog.now() - interval '60 seconds') then
    return pg_catalog.jsonb_build_object('rateLimited',true);
  end if;
  update private.plannix_push_subscriptions as s set last_test_at = pg_catalog.now()
    where s.endpoint_hash = target_hash;
  return pg_catalog.jsonb_build_object('endpoint',device.endpoint,
    'version',device.subscription_version,
    'keys',pg_catalog.jsonb_build_object('p256dh',device.p256dh,'auth',device.auth_key));
end;
$$;
revoke all on function public.plannix_push_claim_test(uuid,text) from public, anon, authenticated;
grant execute on function public.plannix_push_claim_test(uuid,text) to service_role;

commit;
