// Runs only against a uniquely named, disposable local Supabase database.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createMorningSummaryDetailService } from '../server/morningSummary/detail.js';

const container = process.env.PLANNIX_DETAIL_TEST_DB_CONTAINER;
if (process.env.PLANNIX_DISPOSABLE_DETAIL_DB !== '1'
  || !/^supabase_db_plannix-worker-db\.[A-Za-z0-9]+$/.test(container || ''))
  throw Error('A named disposable detail database is required.');
const owner='cf000000-0000-4000-8000-000000000001';
const binding='cf000000-0000-4000-8000-000000000021';
const session='cf000000-0000-4000-8000-000000000022';
const organisation='cf000000-0000-4000-8000-000000000011';
const year='cf000000-0000-4000-8000-000000000013';
const reference='cf000000-0000-4000-8000-000000000031';
const hash='c'.repeat(64);
const q=value=>`'${value}'`;
function sql(command) {
  const result=spawnSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres',
    '-v','ON_ERROR_STOP=1','-qAt'],{input:`set statement_timeout='8s';\n${command}`,
    encoding:'utf8',timeout:11000,maxBuffer:100000});
  if (result.error || result.status!==0) throw Error('Disposable detail database query failed.');
  return result.stdout.trim().split('\n').at(-1);
}
sql(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000',${q(owner)},'authenticated',
  'authenticated','detail-race@example.test','',pg_catalog.now(),'{}','{}',
  pg_catalog.now(),pg_catalog.now());
insert into public.plannix_organisations(id,name,organisation_type)
  values (${q(organisation)},'Synthetic detail org','personal');
insert into private.plannix_personal_organisations(user_id,organisation_id)
  values (${q(owner)},${q(organisation)});
insert into public.plannix_organisation_users(id,user_id,organisation_id)
  values ('cf000000-0000-4000-8000-000000000012',${q(owner)},${q(organisation)});
insert into public.plannix_academic_years(id,organisation_id,name,start_date,end_date)
  values (${q(year)},${q(organisation)},'Synthetic 2026-27','2026-09-01','2027-08-31');
insert into private.plannix_auth_browser_bindings(id,marker_hash,expires_at)
  values (${q(binding)},pg_catalog.repeat('a',64),pg_catalog.clock_timestamp()+interval '1 day');
insert into private.plannix_auth_sessions(id,binding_id,generation,owner_id,kind,secret_hash,
  access_envelope,refresh_envelope,expires_at)
  values (${q(session)},${q(binding)},920001,${q(owner)},'ordinary',
    pg_catalog.repeat('b',64),'{}','{}',pg_catalog.clock_timestamp()+interval '1 day');
update private.plannix_auth_browser_bindings set current_session_id=${q(session)} where id=${q(binding)};
insert into private.plannix_morning_summary_preferences
  (user_id,enabled,delivery_time,revision,academic_year_id,lesson_detail_consent,event_title_consent)
  values (${q(owner)},true,'07:00',1,${q(year)},true,true);
insert into private.plannix_push_subscriptions(endpoint_hash,user_id,endpoint,p256dh,auth_key,bound_session_id)
  values (${q(hash)},${q(owner)},'https://fcm.googleapis.com/fcm/send/synthetic-detail-race',
    pg_catalog.repeat('p',87),pg_catalog.repeat('q',22),${q(session)});
insert into private.plannix_morning_summary_jobs(user_id,london_date,preference_revision,
  academic_year_id,notification_ref)
  values (${q(owner)},'2026-11-03',1,${q(year)},${q(reference)});
insert into private.plannix_morning_summary_deliveries(user_id,london_date,endpoint_hash,
  subscription_version,state)
  select ${q(owner)},'2026-11-03',endpoint_hash,subscription_version,'accepted'
    from private.plannix_push_subscriptions where endpoint_hash=${q(hash)};`);
const versions=JSON.parse(sql(`select pg_catalog.json_build_object(
  'installation',installation_version,'policy',detail_policy_version)
  from private.plannix_push_subscriptions where endpoint_hash=${q(hash)}`));
const enabled=JSON.parse(sql(`set role service_role;
  select public.plannix_push_set_detail_eligibility(${q(session)},${q(hash)},
  ${q(versions.installation)},${q(versions.policy)},${q(owner)},true);`));
assert.equal(enabled.enabled,true);
let snapshotArrived;let releaseSnapshot;
const arrived=new Promise(resolve=>{snapshotArrived=resolve;});
const release=new Promise(resolve=>{releaseSnapshot=resolve;});
let authorizations=0;
const service=createMorningSummaryDetailService({
  config:{supabaseUrl:'https://synthetic.test',supabaseSecretKey:'synthetic',morningSummaryPilotUserId:owner},
  createClientImpl:()=>({rpc:async (_name,args)=>{
    authorizations++;
    const result=sql(`set role service_role; select public.plannix_authorize_morning_summary_detail_v2(
      ${q(args.target_session)},${q(args.target_hash)},${q(args.target_version)},
      ${q(args.target_reference)},${q(args.target_pilot)},${q(args.target_policy_version)});`);
    return {data:result ? JSON.parse(result) : null,error:null};
  }}),
  delivery:{async resolveReference(){snapshotArrived();await release;
    return {date:'2026-11-03',week:'A',lessons:[{period:1,className:'Synthetic class',
      title:'Synthetic lesson',isPpa:false}],events:[{title:'Synthetic private event'}]};}},
});
const input={sessionId:session,userId:owner,endpointHash:hash,
  installationVersion:versions.installation,detailPolicyVersion:enabled.policyVersion,
  notificationRef:reference};
const pending=service.resolve(input);
await arrived;
assert.equal(authorizations,1,'first authorization completes before snapshot hold');
sql(`update private.plannix_morning_summary_preferences set event_title_consent=false
  where user_id=${q(owner)};`);
releaseSnapshot();
const result=await pending;
assert.equal(authorizations,2,'server reauthorizes after held snapshot');
assert.equal(result.eventTitlesIncluded,false);
assert.deepEqual(result.events,[]);
assert.doesNotMatch(JSON.stringify(result),/Synthetic private event/);
console.log('Disposable database consent withdrawal committed during held snapshot; second authorization removed event titles.');
