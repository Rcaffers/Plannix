import { createRequestSupabaseClient } from '../supabase/client.js';
import { buildOrganisationMemberships } from '../../src/utils/organisationMemberships.js';
import { measureAuth } from '../observability/authPerformance.js';

const unavailable = () => Object.assign(new Error('Memberships are temporarily unavailable.'),
  { statusCode: 503, expose: true });

export function registerServerAuthMembershipRoutes({ app, requireAuth,
  createRequestClient = createRequestSupabaseClient } = {}) {
  if (!app || !requireAuth) throw new Error('Membership route is unavailable.');
  app.get('/api/memberships', requireAuth, async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const client = createRequestClient(req.auth);
      const membershipResult = await measureAuth('membership.membershipRows',
        () => client.from('plannix_organisation_users')
          .select('id, organisation_id').eq('user_id', req.auth.userId));
      if (membershipResult.error || !Array.isArray(membershipResult.data)) throw unavailable();
      const memberships = membershipResult.data;
      if (!memberships.length) return res.json({ memberships: [] });
      const membershipIds = memberships.map(row => row.id);
      const organisationIds = [...new Set(memberships.map(row => row.organisation_id))];
      const [organisations, assignments] = await Promise.all([
        measureAuth('membership.organisations', () => client.from('plannix_organisations')
          .select('id, name, organisation_type').in('id', organisationIds)),
        measureAuth('membership.assignments', () => client.from('plannix_organisation_user_access_roles')
          .select('organisation_user_id, access_role_id').in('organisation_user_id', membershipIds)),
      ]);
      if (organisations.error || assignments.error || !Array.isArray(organisations.data)
        || !Array.isArray(assignments.data)) throw unavailable();
      const roleIds = [...new Set(assignments.data.map(row => row.access_role_id))];
      const roles = roleIds.length
        ? await measureAuth('membership.roles', () => client.from('plannix_access_roles')
          .select('id, name').in('id', roleIds))
        : { data: [], error: null };
      if (roles.error || !Array.isArray(roles.data)) throw unavailable();
      return res.json({ memberships: buildOrganisationMemberships({ memberships,
        organisations: organisations.data, assignments: assignments.data, roles: roles.data }) });
    } catch (error) { return next(error?.expose ? error : unavailable()); }
  });
}
