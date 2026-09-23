import { getSupabaseClient } from '../lib/supabase.js';

export const ORGANISATION_ADMIN_ROLE = 'Organisation Admin';

export class OrganisationMembershipError extends Error {
  constructor(message = 'Unable to load your organisation memberships.') {
    super(message);
    this.name = 'OrganisationMembershipError';
  }
}

function rows(result) {
  if (result?.error) throw new OrganisationMembershipError();
  return Array.isArray(result?.data) ? result.data : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function buildOrganisationMemberships({ memberships, organisations, assignments, roles }) {
  const organisationsById = new Map(organisations.map((organisation) => [organisation.id, organisation]));
  const roleNamesById = new Map(roles.map((role) => [role.id, role.name]));
  const roleIdsByMembershipId = new Map();

  for (const assignment of assignments) {
    const current = roleIdsByMembershipId.get(assignment.organisation_user_id) || [];
    current.push(assignment.access_role_id);
    roleIdsByMembershipId.set(assignment.organisation_user_id, current);
  }

  return memberships
    .map((membership) => {
      const organisation = organisationsById.get(membership.organisation_id);
      if (!organisation) return null;
      const membershipRoles = unique(
        (roleIdsByMembershipId.get(membership.id) || []).map((roleId) => roleNamesById.get(roleId)),
      ).sort((left, right) => left.localeCompare(right));
      return {
        membershipId: membership.id,
        organisationId: organisation.id,
        name: organisation.name,
        type: organisation.organisation_type,
        roles: membershipRoles,
        isAdmin: organisation.organisation_type === 'school'
          && membershipRoles.includes(ORGANISATION_ADMIN_ROLE),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadOrganisationMemberships({ userId, client = getSupabaseClient() }) {
  if (!String(userId || '').trim()) return [];

  const memberships = rows(await client
    .from('plannix_organisation_users')
    .select('id, organisation_id')
    .eq('user_id', userId));

  if (!memberships.length) return [];

  const membershipIds = memberships.map((membership) => membership.id);
  const organisationIds = unique(memberships.map((membership) => membership.organisation_id));

  const [organisationResult, assignmentResult] = await Promise.all([
    client
      .from('plannix_organisations')
      .select('id, name, organisation_type')
      .in('id', organisationIds),
    client
      .from('plannix_organisation_user_access_roles')
      .select('organisation_user_id, access_role_id')
      .in('organisation_user_id', membershipIds),
  ]);

  const organisations = rows(organisationResult);
  const assignments = rows(assignmentResult);
  const roleIds = unique(assignments.map((assignment) => assignment.access_role_id));
  const roles = roleIds.length
    ? rows(await client.from('plannix_access_roles').select('id, name').in('id', roleIds))
    : [];

  return buildOrganisationMemberships({ memberships, organisations, assignments, roles });
}

export function schoolMemberships(memberships) {
  return memberships.filter((membership) => membership.type === 'school');
}

export function administeredOrganisations(memberships) {
  return schoolMemberships(memberships).filter((membership) => membership.isAdmin);
}
