import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createRequestSupabaseClient } from '../supabase/client.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fields = 'id, name, is_active';
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode, expose: true });
function scope(req) {
  if (Object.keys(req.query).some(k => k !== 'organisationId') || typeof req.query.organisationId !== 'string' || !UUID.test(req.query.organisationId || '')) throw fail(400, 'A valid organisation is required.');
  return req.query.organisationId;
}
export async function roomAccess(client, userId, organisationId) {
  const member = await client.from('plannix_organisation_users').select('id').eq('user_id', userId).eq('organisation_id', organisationId).maybeSingle();
  if (member.error) throw fail(503, 'Room permissions are unavailable.');
  if (!member.data) throw fail(403, 'You do not have access to these rooms.');
  const assignments = await client.from('plannix_organisation_user_access_roles').select('access_role_id').eq('organisation_user_id', member.data.id);
  if (assignments.error || !Array.isArray(assignments.data)) throw fail(503, 'Room permissions are unavailable.');
  const ids = assignments.data.map(r => r.access_role_id);
  if (!ids.length) return false;
  const roles = await client.from('plannix_access_roles').select('name').in('id', ids);
  if (roles.error || !Array.isArray(roles.data)) throw fail(503, 'Room permissions are unavailable.');
  return roles.data.some(r => r.name === 'Organisation Admin');
}
function room(row) {
  if (!UUID.test(row?.id || '') || typeof row?.name !== 'string' || typeof row?.is_active !== 'boolean') throw fail(503, 'Could not confirm room data. Reload rooms before trying again.');
  return { id: row.id, name: row.name, isActive: row.is_active };
}
export function registerRoomRoutes({ app, requireAuth = requireSupabaseAuth, createRequestClient = createRequestSupabaseClient } = {}) {
  const handle = action => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { await action(req, res); }
    catch (e) { next(e?.expose ? e : fail(503, 'Could not confirm the room request. Reload rooms before trying again.')); }
  };
  app.get('/api/rooms', requireAuth, handle(async (req, res) => {
    const org = scope(req), client = createRequestClient(req.auth);
    const canManage = await roomAccess(client, req.auth.userId, org);
    const rooms = [];
    for (let offset = 0; ; offset += 200) {
      const result = await client.from('plannix_rooms').select(fields).eq('organisation_id', org).order('id').range(offset, offset + 199);
      if (result.error || !Array.isArray(result.data)) throw fail(503, 'Could not load rooms.');
      rooms.push(...result.data.map(room));
      if (result.data.length < 200) break;
    }
    res.json({ rooms, canManage });
  }));
  const write = isNew => handle(async (req, res) => {
    const org = scope(req), body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['name', ...(isNew ? [] : ['isActive'])].includes(k)) || !Object.keys(body).length) throw fail(400, 'Unexpected room fields.');
    if (!isNew && !UUID.test(req.params.id || '')) throw fail(400, 'Room ID is invalid.');
    if (Object.hasOwn(body, 'name') && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 200) || isNew && !Object.hasOwn(body, 'name')) throw fail(400, 'Room names must contain 1 to 200 characters.');
    if (Object.hasOwn(body, 'isActive') && typeof body.isActive !== 'boolean') throw fail(400, 'Room status is invalid.');
    const client = createRequestClient(req.auth);
    if (!await roomAccess(client, req.auth.userId, org)) throw fail(403, 'Organisation Admin access is required to manage rooms.');
    const patch = { ...(Object.hasOwn(body, 'name') ? { name: body.name.trim() } : {}), ...(Object.hasOwn(body, 'isActive') ? { is_active: body.isActive } : {}) };
    let query = client.from('plannix_rooms');
    query = isNew ? query.insert({ ...patch, organisation_id: org }) : query.update(patch).eq('organisation_id', org).eq('id', req.params.id);
    const result = await query.select(fields).maybeSingle();
    if (result.error?.code === '23505') throw fail(422, 'A room with this name already exists, including archived rooms.');
    if (result.error?.code === '42501') throw fail(403, 'You do not have permission to manage this room.');
    if (result.error) throw fail(503, 'Could not confirm the save. Reload rooms before trying again.');
    if (!result.data) throw fail(404, 'Room was not found or access changed.');
    res.status(isNew ? 201 : 200).json({ room: room(result.data) });
  });
  app.post('/api/rooms', requireAuth, write(true));
  app.patch('/api/rooms/:id', requireAuth, write(false));
  app.delete('/api/rooms/:id', requireAuth, handle(async (req, res) => {
    const org = scope(req);
    if (!UUID.test(req.params.id || '')) throw fail(400, 'Room ID is invalid.');
    if (req.body && Object.keys(req.body).length) throw fail(400, 'Unexpected room fields.');
    const client = createRequestClient(req.auth);
    if (!await roomAccess(client, req.auth.userId, org)) throw fail(403, 'Organisation Admin access is required to manage rooms.');
    // One user-scoped RPC transaction; session references reject the whole operation.
    // Domain errors use 422; 409 remains reserved for authentication mismatches.
    const result = await client.rpc('plannix_delete_room', { target_organisation_id: org, target_room_id: req.params.id });
    if (result.error?.code === '23503') throw fail(422, 'This room is assigned to a timetable lesson. Remove those assignments before deleting it; class defaults have not changed.');
    if (result.error?.code === '42501') throw fail(403, 'You do not have permission to delete this room.');
    if (result.error?.code === 'P0002') throw fail(404, 'Room was not found or access changed.');
    if (result.error) throw fail(503, 'Could not confirm the deletion. Reload rooms and classes before trying again; it may already have been deleted.');
    if (result.data !== req.params.id) throw fail(503, 'Could not confirm the deletion. Reload rooms and classes before trying again.');
    res.json({ deletedRoomId: result.data });
  }));

}
