import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { registerServerAuthMembershipRoutes } from './server-auth-membership-routes.js';

const OWNER='dd000000-0000-4000-8000-000000000001';
const FOREIGN='dd000000-0000-4000-8000-000000000002';
const ORG='dd000000-0000-4000-8000-000000000003';
const MEMBERSHIP='dd000000-0000-4000-8000-000000000004';

test('membership endpoint uses the verified owner and request-scoped RLS client',async()=>{
  const seen=[];
  const app=express();
  registerServerAuthMembershipRoutes({app,
    requireAuth(req,_res,next) { req.auth={userId:OWNER,accessToken:'synthetic-user-token'}; next(); },
    createRequestClient(auth) {
      assert.equal(auth.userId,OWNER);
      assert.equal(auth.accessToken,'synthetic-user-token');
      return {from(table) { return {select() { return {
        async eq(column,value) {
          seen.push({table,column,value});
          return {data:[{id:MEMBERSHIP,organisation_id:ORG}],error:null};
        },
        async in() { return {data:table==='plannix_organisations'
          ? [{id:ORG,name:'Synthetic school',organisation_type:'school'}]:[],error:null}; },
        }; } }; }};
    },
  });
  const server=createServer(app);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/memberships?userId=${FOREIGN}`);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.memberships.length,1);
    assert.equal(result.memberships[0].organisationId,ORG);
    assert.deepEqual(seen,[{table:'plannix_organisation_users',column:'user_id',value:OWNER}]);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
