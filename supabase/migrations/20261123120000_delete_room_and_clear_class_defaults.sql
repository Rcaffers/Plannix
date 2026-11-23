-- CLI owns the transaction. Existing room/session constraints are unchanged.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function public.plannix_delete_room(target_organisation_id uuid, target_room_id uuid)
returns uuid
language plpgsql security invoker
set search_path = ''
set lock_timeout = '2s'
as $$
declare affected_years uuid[]; deleted_id uuid;
begin
  if auth.uid() is null or not (select private.plannix_is_confirmed_user())
    or not (select private.plannix_is_organisation_admin(target_organisation_id)) then
    raise exception using errcode='42501', message='Confirmed Organisation Admin access is required.';
  end if;
  if target_organisation_id is null or target_room_id is null then
    raise exception using errcode='22023', message='Organisation and room are required.';
  end if;
  -- Match class-save lock order: academic year, class row, then room. Lock all
  -- organisation years/rows in ID order, including defaults currently null, so
  -- concurrent ordinary class saves cannot reintroduce a cleared default.
  -- NO KEY UPDATE still allows FK KEY SHARE checks from session inserts.
  perform y.id from public.plannix_academic_years y
    where y.organisation_id=target_organisation_id order by y.id for no key update;
  perform c.id from public.plannix_classes c
    where c.organisation_id=target_organisation_id order by c.id for no key update;
  perform r.id from public.plannix_rooms r
    where r.id=target_room_id and r.organisation_id=target_organisation_id for update;
  if not found then
    raise exception using errcode='P0002', message='Room was not found or access changed.';
  end if;
  -- Assignment triggers SHARE-lock the room. A concurrent assignment either
  -- commits before this lock (and is seen here), or waits then rejects the
  -- deleted room. The existing deferred FKs remain the final integrity fence.
  if exists(select 1 from public.plannix_timetable_sessions s
    where s.organisation_id=target_organisation_id and s.room_id=target_room_id) then
    raise exception using errcode='23503', message='Room has timetable lesson assignments.';
  end if;
  with cleared as (
    update public.plannix_classes c set default_room_id=null
      where c.organisation_id=target_organisation_id and c.default_room_id=target_room_id
      returning c.academic_year_id
  ) select array_agg(distinct academic_year_id) into affected_years from cleared;
  update public.plannix_academic_years y set classes_revision=y.classes_revision+1
    where y.organisation_id=target_organisation_id and y.id=any(affected_years);
  delete from public.plannix_rooms r
    where r.id=target_room_id and r.organisation_id=target_organisation_id
    returning r.id into deleted_id;
  if deleted_id is null then
    -- RLS can suppress DELETE after a concurrent role revocation. Do not commit
    -- cleared defaults unless the room really was deleted by this transaction.
    raise exception using errcode='42501', message='Room deletion was not authorised; no changes were saved.';
  end if;
  return deleted_id;
end;
$$;
revoke all on function public.plannix_delete_room(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.plannix_delete_room(uuid,uuid) to authenticated;
comment on function public.plannix_delete_room(uuid,uuid) is
  'Confirmed organisation admin only, invoker RLS. Clears class defaults and advances affected class revisions atomically; session references prevent deletion. Lock contention aborts without replay.';
