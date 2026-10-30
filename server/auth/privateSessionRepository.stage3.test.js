import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateSessionRepository } from './privateSessionRepository.js';

const marker = `__Host-plannix-b-2=${'a'.repeat(43)}`;
const old = `__Host-plannix-s-3=${'b'.repeat(43)}`;
const current = `__Host-plannix-s-4=${'c'.repeat(43)}`;
const callbackState = 'dd000000-0000-4000-8000-000000000088';
const callbackIntent = 'dd000000-0000-4000-8000-000000000087';
const exchangeIntent = 'dd000000-0000-4000-8000-000000000086';
const cipher = {
  encrypt: ({ purpose, version, token }) => ({ purpose, version, token }),
  decrypt: ({ purpose, version, envelope }) => {
    assert.equal(envelope.purpose, purpose);
    assert.equal(envelope.version, version);
    return envelope.token;
  },
};

test('multi-version selection retains only the verified current cookie', async () => {
  const calls = [];
  const repository = createPrivateSessionRepository({ cipher, rpc: async (name, args) => {
    calls.push([name,args]);
    return { data: { state:'selected',markerName:'__Host-plannix-b-2',
      sessionName:'__Host-plannix-s-4',cleanup:['__Host-plannix-s-3'] } };
  } });
  const result = await repository.resolve(`${marker}; ${old}; ${current}`);
  assert.deepEqual(result, { state:'selected',header:`${marker}; ${current}`,
    markerName:'__Host-plannix-b-2',sessionName:'__Host-plannix-s-4',
    cleanup:['__Host-plannix-s-3'] });
  assert.equal(calls[0][0],'plannix_auth_select');
  assert.equal(calls[0][1].candidates.sessions.length,2);
  assert.equal(JSON.stringify(calls[0][1]).includes('aaaa'),false);
  assert.deepEqual(await repository.resolve(`${marker}; ${current}; ${current}`),{state:'invalid'});
  assert.equal(calls.length,1);
});

test('PKCE callback verifier is encrypted for its state and claimed once by the RPC', async () => {
  const calls = [];
  const repository = createPrivateSessionRepository({ cipher, rpc: async (name,args) => {
    calls.push([name,args]);
    const states={plannix_auth_reserve_callback:'reserved',plannix_auth_attach_callback:'attached',
      plannix_auth_ready_callback:'ready'};
    return { data: states[name] ? {state:states[name]}
      : {state:'claimed',intentId:exchangeIntent,
        verifierEnvelope:{purpose:'pkce',version:1,token:'synthetic-verifier'}} };
  } });
  assert.equal((await repository.reserveCallback(marker,{state:callbackState,kind:'confirmation',
    intentId:callbackIntent})).state,'reserved');
  assert.equal((await repository.attachCallback(marker,{state:callbackState,flowId:'a'.repeat(32),
    kind:'confirmation',verifier:'synthetic-verifier'})).state,'attached');
  assert.equal((await repository.readyCallback(marker,{state:callbackState,kind:'confirmation'})).state,'ready');
  const claimed=await repository.claimCallback(marker,{state:callbackState,
    flowId:'a'.repeat(32),kind:'confirmation'});
  assert.deepEqual(claimed,{state:'claimed',intentId:exchangeIntent,verifier:'synthetic-verifier'});
  assert.equal(calls[0][1].initiating_intent,callbackIntent);
  assert.equal(calls[3][1].session_name,null);
  assert.equal(calls[1][1].verifier_cipher.purpose,'pkce');
  assert.notEqual(calls[0][1].provided_state_hash,callbackState);
});

test('refresh claim binds decrypted tokens to session/version and encrypts the next version', async () => {
  const sessionId='dd000000-0000-4000-8000-000000000077';
  const claimId='dd000000-0000-4000-8000-000000000066';
  const calls=[];
  const repository=createPrivateSessionRepository({cipher,rpc:async(name,args)=>{
    calls.push([name,args]);
    if(name==='plannix_auth_claim_refresh') return {data:{state:'claimed',
      claimId,sessionId,ownerId:'dd000000-0000-4000-8000-000000000055',tokenVersion:2,
      accessEnvelope:{purpose:'access',version:2,token:'old-access'},
      refreshEnvelope:{purpose:'refresh',version:2,token:'old-refresh'}}};
    return {data:{state:'refreshed',tokenVersion:3}};
  }});
  const claim=await repository.claimRefresh(`${marker}; ${current}`,2);
  assert.equal(claim.refreshToken,'old-refresh');
  const finished=await repository.finishRefresh(claim,{accessToken:'new-access',refreshToken:'new-refresh'});
  assert.deepEqual(finished,{state:'refreshed',tokenVersion:3});
  assert.equal(calls[1][1].target_session,sessionId);
  assert.deepEqual(calls[1][1].refresh_cipher,{purpose:'refresh',version:3,token:'new-refresh'});
});
