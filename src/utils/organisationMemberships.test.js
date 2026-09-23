import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OrganisationMembershipError,
  administeredOrganisations,
  buildOrganisationMemberships,
  loadOrganisationMemberships,
  schoolMemberships,
} from './organisationMemberships.js';

const fixtures = {
  memberships: [
    { id: 'membership-personal', organisation_id: 'organisation-personal' },
    { id: 'membership-school', organisation_id: 'organisation-school' },
    { id: 'membership-staff', organisation_id: 'organisation-staff' },
  ],
  organisations: [
    { id: 'organisation-school', name: 'Alpha School', organisation_type: 'school' },
    { id: 'organisation-personal', name: 'Ada personal planner', organisation_type: 'personal' },
    { id: 'organisation-staff', name: 'Beta School', organisation_type: 'school' },
  ],
  assignments: [
    { organisation_user_id: 'membership-school', access_role_id: 'role-admin' },
    { organisation_user_id: 'membership-personal', access_role_id: 'role-admin' },
    { organisation_user_id: 'membership-staff', access_role_id: 'role-staff' },
  ],
  roles: [
    { id: 'role-admin', name: 'Organisation Admin' },
    { id: 'role-staff', name: 'Staff' },
  ],
};

test('membership mapping distinguishes school admins from personal organisation admins', () => {
  const memberships = buildOrganisationMemberships(fixtures);
  assert.deepEqual(memberships.map(({ name, isAdmin }) => [name, isAdmin]), [
    ['Ada personal planner', false],
    ['Alpha School', true],
    ['Beta School', false],
  ]);
  assert.deepEqual(schoolMemberships(memberships).map(({ name }) => name), ['Alpha School', 'Beta School']);
  assert.deepEqual(administeredOrganisations(memberships).map(({ name }) => name), ['Alpha School']);
});

function resultBuilder(data, error = null) {
  return {
    select() { return this; },
    eq() { return Promise.resolve({ data, error }); },
    in() { return Promise.resolve({ data, error }); },
  };
}

test('membership loading uses only the authenticated user-visible tables', async () => {
  const tables = [];
  const dataByTable = {
    plannix_organisation_users: fixtures.memberships,
    plannix_organisations: fixtures.organisations,
    plannix_organisation_user_access_roles: fixtures.assignments,
    plannix_access_roles: fixtures.roles,
  };
  const client = {
    from(table) {
      tables.push(table);
      return resultBuilder(dataByTable[table]);
    },
  };
  const memberships = await loadOrganisationMemberships({ userId: 'user-id', client });
  assert.equal(memberships.length, 3);
  assert.deepEqual(tables, [
    'plannix_organisation_users',
    'plannix_organisations',
    'plannix_organisation_user_access_roles',
    'plannix_access_roles',
  ]);
});

test('membership loading returns safely for no user or memberships and hides database errors', async () => {
  assert.deepEqual(await loadOrganisationMemberships({ userId: '', client: {} }), []);
  const emptyClient = { from: () => resultBuilder([]) };
  assert.deepEqual(await loadOrganisationMemberships({ userId: 'user-id', client: emptyClient }), []);
  const failingClient = { from: () => resultBuilder(null, new Error('sensitive database detail')) };
  await assert.rejects(
    () => loadOrganisationMemberships({ userId: 'user-id', client: failingClient }),
    (error) => error instanceof OrganisationMembershipError
      && !error.message.includes('sensitive database detail'),
  );
});
