begin;

-- The unrestricted service-role claim must not be callable during the pilot.
-- Filtering after it returns would reserve other users' daily jobs.
revoke all on function public.plannix_claim_morning_summary_jobs(integer) from service_role;

create function private.plannix_claim_morning_summary_pilot_jobs_at(
  now_instant timestamptz, max_jobs integer, pilot_user uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare candidate record; claims jsonb := '[]'::jsonb; token uuid; notification_reference uuid;
begin
  if now_instant is null or pilot_user is null or max_jobs is null or max_jobs not between 1 and 50 then
    raise exception using errcode='22023', message='Invalid pilot claim.';
  end if;
  for candidate in
    select p.user_id, p.revision, p.academic_year_id, due.target_date
    from private.plannix_morning_summary_preferences as p
    join auth.users as u on u.id=p.user_id and u.email_confirmed_at is not null
    cross join lateral (select private.plannix_morning_summary_due_date(now_instant,p.delivery_time) as target_date) as due
    where p.user_id=pilot_user and p.enabled and p.academic_year_id is not null
      and due.target_date between (select y.year_start from private.plannix_morning_summary_year(p.user_id,p.academic_year_id) as y)
        and (select y.year_end from private.plannix_morning_summary_year(p.user_id,p.academic_year_id) as y)
      and extract(isodow from due.target_date) between 1 and 5
      and not exists (select 1 from public.plannix_holidays as h
        where h.academic_year_id=p.academic_year_id and due.target_date between h.start_date and h.end_date)
      and exists (select 1 from private.plannix_push_subscriptions as s where s.user_id=p.user_id)
      and not exists (select 1 from private.plannix_morning_summary_jobs as existing
        where existing.user_id=p.user_id and existing.london_date=due.target_date
          and (existing.completed_at is not null
            or existing.lease_until >= pg_catalog.clock_timestamp()
            or existing.preference_revision <> p.revision
            or existing.academic_year_id <> p.academic_year_id))
    order by p.user_id limit max_jobs * 2
  loop
    token := pg_catalog.gen_random_uuid();
    insert into private.plannix_morning_summary_jobs as j
      (user_id,london_date,preference_revision,academic_year_id,lease_claim_id,lease_until)
      values (candidate.user_id,candidate.target_date,candidate.revision,candidate.academic_year_id,
        token,pg_catalog.clock_timestamp()+interval '90 seconds')
      on conflict (user_id,london_date) do update
        set lease_claim_id=excluded.lease_claim_id, lease_until=excluded.lease_until
        where j.completed_at is null and j.lease_until < pg_catalog.clock_timestamp()
          and j.preference_revision=candidate.revision and j.academic_year_id=candidate.academic_year_id
      returning j.notification_ref into notification_reference;
    if found then
      claims := claims || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'userId',candidate.user_id,'date',candidate.target_date,'academicYearId',candidate.academic_year_id,
        'revision',candidate.revision,'token',token,'notificationRef',notification_reference));
      exit when pg_catalog.jsonb_array_length(claims) >= max_jobs;
    end if;
  end loop;
  return claims;
end;
$$;
revoke all on function private.plannix_claim_morning_summary_pilot_jobs_at(timestamptz,integer,uuid)
  from public, anon, authenticated, service_role;

create function public.plannix_claim_morning_summary_pilot_jobs(max_jobs integer,pilot_user uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.plannix_claim_morning_summary_pilot_jobs_at(pg_catalog.clock_timestamp(),max_jobs,pilot_user);
$$;
revoke all on function public.plannix_claim_morning_summary_pilot_jobs(integer,uuid)
  from public, anon, authenticated;
grant execute on function public.plannix_claim_morning_summary_pilot_jobs(integer,uuid) to service_role;

commit;
