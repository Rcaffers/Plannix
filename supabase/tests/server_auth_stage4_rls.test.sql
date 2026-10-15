-- Run only on a verified disposable database containing the application schema.
-- All identities and rows are synthetic; the transaction leaves no fixtures behind.
begin;

create extension if not exists pgtap with schema extensions;
grant usage on schema auth, public, extensions to authenticated;
grant execute on function auth.uid() to authenticated;
-- Schema-only fixture restores omit grants. These grants exercise the existing
-- RLS policies, not production privilege provisioning, and roll back below.
grant select on all tables in schema public to authenticated;

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('00000000-0000-0000-0000-000000000000',
 'da000000-0000-4000-8000-000000000001','authenticated','authenticated',
 'stage4-a@example.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000',
 'da000000-0000-4000-8000-000000000002','authenticated','authenticated',
 'stage4-b@example.test','',now(),'{}','{}',now(),now());

insert into public.plannix_organisations(id,name,organisation_type)
values
('da000000-0000-4000-8000-000000000011','Synthetic A','school'),
('da000000-0000-4000-8000-000000000012','Synthetic B','school');
insert into public.plannix_organisation_users(id,organisation_id,user_id)
values
('da000000-0000-4000-8000-000000000021',
 'da000000-0000-4000-8000-000000000011',
 'da000000-0000-4000-8000-000000000001'),
('da000000-0000-4000-8000-000000000022',
 'da000000-0000-4000-8000-000000000012',
 'da000000-0000-4000-8000-000000000002');
insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date)
values
('da000000-0000-4000-8000-000000000031',
 'da000000-0000-4000-8000-000000000011','2026/2027','2026-09-01','2027-08-31'),
('da000000-0000-4000-8000-000000000032',
 'da000000-0000-4000-8000-000000000012','2026/2027','2026-09-01','2027-08-31');

select extensions.plan(8);
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub',
  'da000000-0000-4000-8000-000000000001',true);
select extensions.is((select count(*) from public.plannix_organisation_users
  where organisation_id='da000000-0000-4000-8000-000000000011'),1::bigint,
  'A can read its own membership');
select extensions.is((select count(*) from public.plannix_organisation_users
  where organisation_id='da000000-0000-4000-8000-000000000012'),0::bigint,
  'A cannot read B membership');
select extensions.is((select count(*) from public.plannix_academic_years
  where organisation_id='da000000-0000-4000-8000-000000000011'),1::bigint,
  'A can read its own year');
select extensions.is((select count(*) from public.plannix_academic_years
  where organisation_id='da000000-0000-4000-8000-000000000012'),0::bigint,
  'A cannot read B year');
select pg_catalog.set_config('request.jwt.claim.sub',
  'da000000-0000-4000-8000-000000000002',true);
select extensions.is((select count(*) from public.plannix_organisation_users
  where organisation_id='da000000-0000-4000-8000-000000000012'),1::bigint,
  'B can read its own membership');
select extensions.is((select count(*) from public.plannix_organisation_users
  where organisation_id='da000000-0000-4000-8000-000000000011'),0::bigint,
  'B cannot read A membership');
select extensions.is((select count(*) from public.plannix_academic_years
  where organisation_id='da000000-0000-4000-8000-000000000012'),1::bigint,
  'B can read its own year');
select extensions.is((select count(*) from public.plannix_academic_years
  where organisation_id='da000000-0000-4000-8000-000000000011'),0::bigint,
  'B cannot read A year');
reset role;
select * from extensions.finish();
rollback;
