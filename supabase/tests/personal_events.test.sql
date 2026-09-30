begin;
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

create function pg_temp.create_event_as(who uuid, year_id uuid, day date, title text,
  start_at text default null, end_at text default null,
  place text default null, detail text default null)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', who::text, true);
  execute 'set local role authenticated';
  select public.plannix_create_personal_event(year_id,day,title,start_at,end_at,place,detail) into result;
  execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;
create function pg_temp.list_events_as(who uuid, year_id uuid, d1 date default null, d2 date default null)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', who::text, true);
  execute 'set local role authenticated';
  select public.plannix_list_personal_events(year_id,d1,d2) into result;
  execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;
create function pg_temp.update_event_as(who uuid, event_id uuid, rev bigint, day date, title text)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', who::text, true);
  execute 'set local role authenticated';
  select public.plannix_update_personal_event(event_id,rev,day,title,null,null,null,null) into result;
  execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;
create function pg_temp.update_event_fields_as(who uuid, event_id uuid, rev bigint,
  title text, place text, detail text)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', who::text, true);
  execute 'set local role authenticated';
  select public.plannix_update_personal_event(event_id,rev,'2026-09-01',title,
    null,null,place,detail) into result;
  execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;
create function pg_temp.delete_event_as(who uuid, event_id uuid, rev bigint)
returns boolean language plpgsql set search_path='' as $$
declare result boolean;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', who::text, true);
  execute 'set local role authenticated';
  select public.plannix_delete_personal_event(event_id,rev) into result;
  execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid, id,'authenticated','authenticated',email,'',
  case when confirmed then pg_catalog.now() else null end,
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_build_object('first_name','Event','last_name','Fixture'),pg_catalog.now(),pg_catalog.now()
from (values
  ('e1000000-0000-4000-8000-000000000001'::uuid,'event-one@example.test',true),
  ('e1000000-0000-4000-8000-000000000002'::uuid,'event-two@example.test',true),
  ('e1000000-0000-4000-8000-000000000003'::uuid,'event-unconfirmed@example.test',false)
) as fixture(id,email,confirmed);
insert into public.plannix_organisations(id,name,organisation_type) values
 ('e2000000-0000-4000-8000-000000000001','Event personal one','personal'),
 ('e2000000-0000-4000-8000-000000000002','Event personal two','personal'),
 ('e2000000-0000-4000-8000-000000000003','Event school','school');
insert into private.plannix_personal_organisations(user_id,organisation_id) values
 ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001'),
 ('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002');
insert into public.plannix_organisation_users(id,user_id,organisation_id) values
 ('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001'),
 ('e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002'),
 ('e3000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000003');
insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date) values
 ('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','2026-27','2026-09-01','2027-08-31'),
 ('e4000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002','2026-27','2026-09-01','2027-08-31'),
 ('e4000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000003','2026-27','2026-09-01','2027-08-31');

insert into public.plannix_organisation_user_access_roles(organisation_user_id,access_role_id)
select 'e3000000-0000-4000-8000-000000000001', id from public.plannix_access_roles where name='Organisation Admin';

create function pg_temp.save_year_as(who uuid, year_id uuid, start_on date, holiday_rows jsonb)
returns uuid language plpgsql set search_path='' as $$
declare result uuid;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',who::text,true);
  execute 'set local role authenticated';
  select public.plannix_save_academic_year('e2000000-0000-4000-8000-000000000001',year_id,
    'Attempted rename',start_on,'2027-08-31',holiday_rows) into result;
  execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;

create function pg_temp.direct_table_as_authenticated()
returns bigint language plpgsql set search_path='' as $$
declare result bigint;
begin
  execute 'set local role authenticated';
  select pg_catalog.count(*) into result from private.plannix_personal_events;
  execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;
create function pg_temp.direct_helper_as_authenticated()
returns text language plpgsql set search_path='' as $$
declare result text;
begin
  execute 'set local role authenticated';
  select private.plannix_event_title_key('fixture') into result;
  execute 'reset role'; return result;
exception when others then execute 'reset role'; raise;
end;
$$;
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where oid='private.plannix_personal_events'::regclass),'RLS enabled');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated','private.plannix_personal_events','SELECT,INSERT,UPDATE,DELETE'),'authenticated has no direct table access');
select extensions.ok(not pg_catalog.has_table_privilege('anon','private.plannix_personal_events','SELECT'),'anon has no table access');
select extensions.ok(not pg_catalog.has_function_privilege('anon','public.plannix_create_personal_event(uuid,date,text,text,text,text,text)','EXECUTE'),'anon cannot execute create');
select extensions.ok(pg_catalog.has_function_privilege('authenticated','public.plannix_create_personal_event(uuid,date,text,text,text,text,text)','EXECUTE'),'authenticated may execute narrow create RPC');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated','private.plannix_personal_event_scope(uuid,boolean)','EXECUTE'),'private helper is not callable');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated','private.plannix_event_json(private.plannix_personal_events)','EXECUTE'),'private serializer is not callable');
select extensions.throws_ok('select pg_temp.direct_table_as_authenticated()','42501',null,'direct table read is denied in execution');
select extensions.throws_ok('select pg_temp.direct_helper_as_authenticated()','42501',null,'private helper execution is denied');
select extensions.ok((select pg_catalog.bool_and(pg_catalog.has_function_privilege('authenticated',oid,'EXECUTE'))
  from pg_catalog.pg_proc where oid in (
    'public.plannix_list_personal_events(uuid,date,date)'::regprocedure,
    'public.plannix_create_personal_event(uuid,date,text,text,text,text,text)'::regprocedure,
    'public.plannix_update_personal_event(uuid,bigint,date,text,text,text,text,text)'::regprocedure,
    'public.plannix_delete_personal_event(uuid,bigint)'::regprocedure)), 'all four narrow RPCs execute for authenticated');
select extensions.ok((select not pg_catalog.bool_or(pg_catalog.has_function_privilege('anon',oid,'EXECUTE'))
  from pg_catalog.pg_proc where oid in (
    'public.plannix_list_personal_events(uuid,date,date)'::regprocedure,
    'public.plannix_create_personal_event(uuid,date,text,text,text,text,text)'::regprocedure,
    'public.plannix_update_personal_event(uuid,bigint,date,text,text,text,text,text)'::regprocedure,
    'public.plannix_delete_personal_event(uuid,bigint)'::regprocedure)), 'anon cannot execute any event RPC');
select extensions.ok((select proconfig[1] = 'search_path=""' from pg_catalog.pg_proc where oid='public.plannix_create_personal_event(uuid,date,text,text,text,text,text)'::regprocedure),'definer search path is empty');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000003','e4000000-0000-4000-8000-000000000001','2026-10-01','Blocked')$$,'42501',null,'unconfirmed user denied');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000003','2026-10-01','School')$$,'P0002',null,'school membership cannot substitute');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000001','2026-10-01','Cross user')$$,'P0002',null,'cross-user year denied');

create temporary table event_ids(id uuid, second_id uuid);
insert into event_ids select
  (pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-09-01','  Café  Day  ')->>'id')::uuid,
  (pg_temp.create_event_as('e1000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000002','2026-10-01','Other user') ->> 'id')::uuid;
select extensions.is((pg_temp.list_events_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001')->0->>'title'),'Café Day','text normalized and all-day round trips');
select extensions.is(pg_catalog.jsonb_array_length(pg_temp.list_events_as('e1000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000002')),1,'second user sees only own collection');
select extensions.throws_ok($$select pg_temp.list_events_as('e1000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000001')$$,'P0002',null,'cross-user list denied');
select extensions.throws_ok(pg_catalog.format($$select pg_temp.update_event_as('e1000000-0000-4000-8000-000000000002','%s',1,'2026-10-02','Adopt')$$,(select id from event_ids)),'P0002',null,'cross-user update denied');
select extensions.throws_ok(pg_catalog.format($$select pg_temp.delete_event_as('e1000000-0000-4000-8000-000000000002','%s',1)$$,(select id from event_ids)),'P0002',null,'cross-user delete denied');
select extensions.is((pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-10-02','Meeting','09:00','10:00',' Library ','Line one'||E'\n'||'Line two')->>'startTime'),'09:00','timed event round trips');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-09-01',' café day ')$$,'23505',null,'normalized duplicate denied');
select extensions.ok((pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-10-02','Meeting','10:00','11:00')->>'id') is not null,'same title different time permitted');
select extensions.ok((pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-10-02','Different','09:00','10:00')->>'id') is not null,'different titled overlap permitted');
select extensions.is((pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001','2026-10-04','Notes trim',null,null,null,E'\n  Note  \n')->>'notes'),'Note',
  'database multiline trimming matches the shared validator');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001','2026-10-04','Seconds','09:00:30','10:00:00')$$,
  '22023',null,'direct RPC cannot persist seconds');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-10-03','One time','09:00')$$,'22023',null,'one time rejected');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-10-03','Backwards','10:00','09:00')$$,'22023',null,'backwards time rejected');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-08-31','Outside')$$,'22023',null,'outside-year date rejected');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-10-03',repeat('x',201))$$,'22023',null,'title max enforced');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-10-03','Bad',null,null,repeat('x',201))$$,'22023',null,'location max enforced');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-10-03','Bad',null,null,null,repeat('x',2001))$$,'22023',null,'notes max enforced');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-10-03','Bad'||chr(8203))$$,'22023',null,'format character rejected');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-10-03','Bad'||chr(1))$$,'22023',null,'control character rejected');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001','2026-10-03','Bad'||chr(69821))$$,
  '22023',null,'authenticated create rejects title U+110BD');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001','2026-10-03','Bad',null,null,'Room'||chr(69837))$$,
  '22023',null,'authenticated create rejects location U+110CD');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001','2026-10-03','Bad',null,null,null,'Note'||chr(69821))$$,
  '22023',null,'authenticated create rejects notes U+110BD');
select extensions.is((pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001','2026-10-03','Reserved'||chr(68797),
  null,null,'Room'||chr(68813),'Note'||chr(8293))->>'title'),'Reserved'||chr(68797),
  'mistaken U+10CBD/U+10CCD and reserved U+2065 are not blacklisted');
delete from private.plannix_personal_events where academic_year_id='e4000000-0000-4000-8000-000000000001'
  and title='Reserved'||chr(68797);
select extensions.throws_ok($$select pg_temp.update_event_fields_as('e1000000-0000-4000-8000-000000000001',
  (select id from event_ids),1,'Updated'||chr(69821),null,null)$$,
  '22023',null,'authenticated update rejects title U+110BD');
select extensions.throws_ok($$select pg_temp.update_event_fields_as('e1000000-0000-4000-8000-000000000001',
  (select id from event_ids),1,'Updated','Room'||chr(69837),null)$$,
  '22023',null,'authenticated update rejects location U+110CD');
select extensions.throws_ok($$select pg_temp.update_event_fields_as('e1000000-0000-4000-8000-000000000001',
  (select id from event_ids),1,'Updated',null,'Note'||chr(69837))$$,
  '22023',null,'authenticated update rejects notes U+110CD');
select extensions.is((select revision from private.plannix_personal_events where id=(select id from event_ids)),
  1::bigint,'rejected updates leave the revision unchanged');
select extensions.is((select title from private.plannix_personal_events where id=(select id from event_ids)),
  'Café Day','rejected updates leave the existing title unchanged');
select extensions.ok((select location is null and notes is null
  from private.plannix_personal_events where id=(select id from event_ids)),
  'rejected updates leave location and notes unchanged');
select extensions.is((pg_temp.update_event_as('e1000000-0000-4000-8000-000000000001',(select id from event_ids),1,'2026-09-02','Moved')->>'revision')::integer,2,'revision checked update succeeds');
select extensions.throws_ok(pg_catalog.format($$select pg_temp.update_event_as('e1000000-0000-4000-8000-000000000001','%s',1,'2026-09-03','Stale')$$,(select id from event_ids)),'40001',null,'stale revision rejected');
select extensions.throws_ok(pg_catalog.format($$select pg_temp.delete_event_as('e1000000-0000-4000-8000-000000000001','%s',1)$$,(select id from event_ids)),'40001',null,'stale delete rejected');
select extensions.ok(pg_temp.delete_event_as('e1000000-0000-4000-8000-000000000001',(select id from event_ids),2),'matching delete succeeds');

insert into private.plannix_personal_events(organisation_id,academic_year_id,owner_organisation_user_id,event_date,title)
select 'e2000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',
  '2027-02-01','Bulk '||i from pg_catalog.generate_series(1,495) as i;
select extensions.is((select count(*) from private.plannix_personal_events where academic_year_id='e4000000-0000-4000-8000-000000000001'),499::bigint,'499 boundary');
select extensions.ok((pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2027-02-02','Five hundred')->>'id') is not null,'500 accepted');
select extensions.throws_ok($$select pg_temp.create_event_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2027-02-03','Five hundred one')$$,'P1001',null,'501 rejected');
select extensions.is((select count(*) from private.plannix_personal_events where academic_year_id='e4000000-0000-4000-8000-000000000001'),500::bigint,'cap rejection did not change collection');
insert into public.plannix_holidays(academic_year_id,name,start_date,end_date)
values('e4000000-0000-4000-8000-000000000001','Fixture break','2026-12-01','2026-12-02');
select extensions.throws_ok($$update public.plannix_academic_years set name='Changed',start_date='2026-10-03'
  where id='e4000000-0000-4000-8000-000000000001'$$,'P1002',null,'boundary shortening rejects stranded event');
select extensions.throws_ok($$select pg_temp.save_year_as('e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001','2026-10-03','[]'::jsonb)$$,'P1002',null,
  'academic-year save RPC rejects stranding and does not reconcile holidays');
select extensions.is((select name from public.plannix_academic_years where id='e4000000-0000-4000-8000-000000000001'),'2026-27','parent unchanged after boundary rejection');
select extensions.is((select count(*) from public.plannix_holidays where academic_year_id='e4000000-0000-4000-8000-000000000001'),1::bigint,'holiday preserved after boundary rejection');
select extensions.is((select count(*) from private.plannix_personal_events where academic_year_id='e4000000-0000-4000-8000-000000000001'),500::bigint,'events preserved after boundary rejection');
select extensions.is(pg_catalog.jsonb_array_length(pg_temp.list_events_as('e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','2026-09-01','2026-09-30')),0,'week filter remains bounded and excludes outside rows');

-- Deleting an academic year cascades only its events.
delete from public.plannix_academic_years where id='e4000000-0000-4000-8000-000000000002';
select extensions.is((select count(*) from private.plannix_personal_events where id=(select second_id from event_ids)),0::bigint,'year deletion cascades');
delete from public.plannix_organisation_users where id='e3000000-0000-4000-8000-000000000001';
select extensions.is((select count(*) from private.plannix_personal_events where academic_year_id='e4000000-0000-4000-8000-000000000001'),0::bigint,'membership deletion cascades');

delete from auth.users where id='e1000000-0000-4000-8000-000000000001';
select extensions.is((select count(*) from public.plannix_organisations where id='e2000000-0000-4000-8000-000000000001'),0::bigint,'account deletion removes personal organisation');
select * from extensions.finish();
rollback;
