import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerSupabaseIdentity } from './serverSupabaseIdentity.js';

const userId='dd000000-0000-4000-8000-000000000077';
const user={id:userId,email:'teacher@example.test',email_confirmed_at:'2026-10-10T00:00:00Z',
  user_metadata:{first_name:'Synthetic',last_name:'Teacher'}};
const syntheticJwt=`${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.${Buffer.from('synthetic-signature').toString('base64url')}`;
const session={access_token:syntheticJwt,refresh_token:'synthetic-refresh-token',
  token_type:'bearer',expires_in:3600,user};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,
  headers:{'Content-Type':'application/json'}});

function interceptedIdentity({ failureStage, errorCode = 'unexpected_failure' } = {}) {
  const calls=[];
  let userReads=0;
  const fetchImpl=async(input,init={})=>{
    const url=new URL(input.url || input);
    calls.push({path:url.pathname,grant:url.searchParams.get('grant_type'),
      searchKeys:[...url.searchParams.keys()],headerKeys:[...new Headers(init.headers).keys()],
      redirect:url.searchParams.get('redirect_to') || new Headers(init.headers).get('x-redirect-to'),
      body:init.body?JSON.parse(init.body):null});
    if (url.pathname.endsWith('/signup')) return json({user,session:null});
    if (url.pathname.endsWith('/recover')) return json({});
    if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type')==='password') return json(session);
    if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type')==='pkce') return json(session);
    if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type')==='refresh_token') return json(session);
    if (url.pathname.endsWith('/user') && init.method==='PUT')
      return failureStage==='password_update'
        ? json({error_code:errorCode,msg:'private-provider-response'},400) : json({user});
    if (url.pathname.endsWith('/user')) {
      userReads+=1;
      if ((failureStage==='user_validation' && userReads===1)
        || (failureStage==='session_setup_or_refresh' && userReads===2))
        return json({error_code:errorCode,msg:'private-provider-response'},400);
      return json({user});
    }
    if (url.pathname.endsWith('/rpc/plannix_ensure_personal_organisation')) return json({
      organisation_id:'dd000000-0000-4000-8000-000000000078',
      organisation_user_id:'dd000000-0000-4000-8000-000000000079'});
    if (url.pathname.endsWith('/plannix_users')) return json({id:userId,first_name:'Synthetic',
      last_name:'Teacher',initials:'ST'});
    throw Error('Unexpected synthetic endpoint.');
  };
  return {calls,identity:createServerSupabaseIdentity({url:'https://synthetic.supabase.test',
    publishableKey:'synthetic-public-key',secretKey:'synthetic-private-key',fetchImpl})};
}

test('identity adapter rejects non-local plaintext or malformed provider URLs',()=>{
  for(const url of ['http://synthetic.supabase.test','https://user:pass@synthetic.supabase.test',
    'https://synthetic.supabase.test/other','https://synthetic.supabase.test/?token=value']) {
    assert.throws(()=>createServerSupabaseIdentity({url,publishableKey:'synthetic-public-key',
      secretKey:'synthetic-private-key',fetchImpl:async()=>json({})}),
    /Identity service unavailable/);
  }
});

test('installed SDK password login validates identity, onboarding and profile without token output',async()=>{
  const {calls,identity}=interceptedIdentity();
  const result=await identity.login({email:'teacher@example.test',password:'synthetic-password'});
  assert.equal(result.user.id,userId);
  assert.equal(result.user.name,'Synthetic Teacher');
  assert.equal(result.session.access_token,session.access_token);
  assert.deepEqual(calls.map(call=>call.path).filter(path=>path.includes('/rest/v1/')),
    ['/rest/v1/rpc/plannix_ensure_personal_organisation','/rest/v1/plannix_users']);
  assert.ok(calls.every(call=>!call.redirect || call.redirect.startsWith('https://')));
});

test('installed SDK stores a server PKCE slot and exchanges only the matching flow',async()=>{
  const {calls,identity}=interceptedIdentity();
  const slots=[];
  const signup=await identity.signup({email:'teacher@example.test',password:'synthetic-password',
    firstName:'Synthetic',lastName:'Teacher',
    redirectTo:'https://app.plannix.test/__stage3/auth/callback?state=synthetic',
    onVerifier:async(flowId,verifier)=>slots.push({flowId,verifier})});
  assert.equal(signup.confirmationPending,true);
  assert.equal(slots.length,1,`PKCE metadata: ${JSON.stringify(calls.map(call=>({path:call.path,
    hasChallenge:Boolean(call.body?.code_challenge),hasFlow:Boolean(call.redirect?.includes('sb_flow_id='))})))}`);
  assert.match(slots[0].flowId,/^[0-9a-f]{32}$/);
  assert.match(JSON.parse(slots[0].verifier),/^[A-Za-z0-9_-]{43,}$/);
  const signupCall=calls.find(call=>call.path.endsWith('/signup'));
  assert.equal(new URL(signupCall.redirect).searchParams.get('sb_flow_id'),slots[0].flowId,
    `Request metadata: ${JSON.stringify({searchKeys:signupCall.searchKeys,headerKeys:signupCall.headerKeys})}`);
  assert.ok(signupCall.body.code_challenge);
  const confirmed=await identity.exchange({code:'synthetic-code',flowId:slots[0].flowId,
    verifier:slots[0].verifier});
  assert.equal(confirmed.kind,'ordinary');
  const exchangeCall=calls.find(call=>call.grant==='pkce');
  assert.equal(exchangeCall.body.code_verifier,JSON.parse(slots[0].verifier));

  const recoverySlots=[];
  await identity.sendRecovery({email:'teacher@example.test',
    redirectTo:'https://app.plannix.test/__stage3/auth/callback?state=synthetic2',
    onVerifier:async(flowId,verifier)=>recoverySlots.push({flowId,verifier})});
  assert.equal(recoverySlots.length,1);
  assert.match(JSON.parse(recoverySlots[0].verifier),/\/recovery$/);
  const recovered=await identity.exchange({code:'synthetic-recovery-code',
    flowId:recoverySlots[0].flowId,verifier:recoverySlots[0].verifier});
  assert.equal(recovered.kind,'recovery');
  assert.equal(recovered.userId,userId);
});

test('installed SDK refresh keeps owner and an explicit recovery password update uses a scoped session',async()=>{
  const {identity,calls}=interceptedIdentity();
  const refreshed=await identity.refresh({refreshToken:session.refresh_token,expectedUserId:userId});
  assert.equal(refreshed.refresh_token,session.refresh_token);
  const updated=await identity.updateRecoveryPassword({accessToken:session.access_token,
    refreshToken:session.refresh_token,password:'synthetic-new-password',expectedUserId:userId});
  assert.equal(updated.updated,true);
  assert.ok(calls.some(call=>call.path.endsWith('/user') && call.body?.password==='synthetic-new-password'));
});

test('recovery diagnostics attribute installed SDK validation, setup and update failures safely',async()=>{
  for (const failureStage of ['user_validation','session_setup_or_refresh','password_update']) {
    for (const errorCode of failureStage==='password_update'
      ? ['same_password','weak_password','unexpected_failure'] : ['unexpected_failure']) {
      const {identity,calls}=interceptedIdentity({failureStage,errorCode});
      const records=[];
      await assert.rejects(identity.updateRecoveryPassword({accessToken:session.access_token,
        refreshToken:session.refresh_token,password:'private-synthetic-password',
        expectedUserId:userId,onDiagnostic:(substage,outcome,category)=>
          records.push({substage,outcome,category})}),/Identity service unavailable/);
      const failed=records.filter(record=>record.outcome==='failed');
      assert.deepEqual(failed,[{substage:failureStage,outcome:'failed',
        category:['same_password','weak_password'].includes(errorCode)?errorCode:'generic'}]);
      assert.equal(records.filter(record=>record.outcome==='succeeded').length,
        ['user_validation','session_setup_or_refresh','password_update'].indexOf(failureStage));
      assert.equal(calls.filter(call=>call.path.endsWith('/user') && call.body?.password).length,
        failureStage==='password_update'?1:0);
      assert.equal(JSON.stringify(records).includes('private'),false);
    }
  }
});

test('recovery diagnostics cannot alter SDK results when observers throw or reject',async()=>{
  for (const onDiagnostic of [
    () => { throw Error('private-observer-error'); },
    () => Promise.reject(Error('private-observer-error')),
  ]) {
    const {identity,calls}=interceptedIdentity();
    assert.deepEqual(await identity.updateRecoveryPassword({accessToken:session.access_token,
      refreshToken:session.refresh_token,password:'private-synthetic-password',
      expectedUserId:userId,onDiagnostic}),{updated:true});
    assert.equal(calls.filter(call=>call.path.endsWith('/user') && call.body?.password).length,1);
    const failed=interceptedIdentity({failureStage:'password_update'});
    await assert.rejects(failed.identity.updateRecoveryPassword({accessToken:session.access_token,
      refreshToken:session.refresh_token,password:'private-synthetic-password',
      expectedUserId:userId,onDiagnostic}),/Identity service unavailable/);
    assert.equal(failed.calls.filter(call=>call.path.endsWith('/user') && call.body?.password).length,1);
  }
});

test('Stage 4 current user and profile writes retain confirmed RLS owner',async()=>{
  const {identity,calls}=interceptedIdentity();
  const current=await identity.loadCurrentUser({accessToken:session.access_token,
    expectedUserId:userId});
  assert.equal(current.id,userId);
  assert.equal(current.organisationId,'dd000000-0000-4000-8000-000000000078');
  const updated=await identity.updateProfileName({accessToken:session.access_token,
    expectedUserId:userId,firstName:'Synthetic',lastName:'Teacher'});
  assert.equal(updated.id,userId);
  assert.ok(calls.some(call=>call.path.endsWith('/plannix_users') && call.body?.first_name==='Synthetic'));
  await assert.rejects(identity.loadCurrentUser({accessToken:session.access_token,
    expectedUserId:'dd000000-0000-4000-8000-000000000099'}));
});

test('Stage 4 email and password operations keep provider tokens server-side',async()=>{
  const {identity,calls}=interceptedIdentity();
  const slots=[];
  const email=await identity.requestEmailChange({accessToken:session.access_token,
    refreshToken:session.refresh_token,expectedUserId:userId,email:'new@example.test',
    redirectTo:'https://app.plannix.test/__stage3/auth/callback?state=synthetic',
    onVerifier:async(flowId,verifier)=>slots.push({flowId,verifier})});
  assert.equal(email.confirmationPending,true);
  assert.equal(slots.length,1);
  assert.ok(calls.some(call=>call.path.endsWith('/user') && call.body?.email==='new@example.test'));
  const changed=await identity.updateOrdinaryPassword({accessToken:session.access_token,
    refreshToken:session.refresh_token,expectedUserId:userId,email:user.email,
    currentPassword:'synthetic-current',newPassword:'synthetic-new'});
  assert.equal(changed.access_token,session.access_token);
  assert.ok(calls.some(call=>call.path.endsWith('/user') && call.body?.password==='synthetic-new'));
  assert.equal(JSON.stringify({email,changed}).includes('synthetic-current'),false);
});
