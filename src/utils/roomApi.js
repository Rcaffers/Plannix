import { getSupabaseClient } from '../lib/supabase.js';
import { API_BASE_URL, ApiError, parseJsonSafe } from './api.js';
import { serverManagedAuth, serverAuthFetch, captureServerOperationContext, assertServerOperationContext } from './serverAuthTransport.js';
import { isCanonicalUuid } from './classPersistence.js';
export function validRoom(value) {
  return value && Object.keys(value).every(k => ['id','name','isActive'].includes(k))
    && isCanonicalUuid(value.id) && typeof value.name === 'string' && value.name.trim().length > 0
    && value.name.length <= 200 && typeof value.isActive === 'boolean';
}
export function createRoomApi({ fetchImpl = fetch, getSession = async () => {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token) throw new ApiError('Authentication is required.', { status:401 });
  const verified = await client.auth.getUser(data.session.access_token);
  if (verified.error || !verified.data?.user) throw new ApiError('Authentication is required.', { status:401 });
  return { ...data.session, user:verified.data.user };
} } = {}) {
  async function request(scope, id, patch, remove = false, {isCurrent} = {}) {
    if (!isCanonicalUuid(scope.organisationId) || !scope.userId || id && !isCanonicalUuid(id)) throw new ApiError('Room scope is invalid.');
    const checkCurrent=()=>{if(isCurrent && !isCurrent())throw new DOMException('Room context changed.','AbortError');};
    checkCurrent();
    const context = serverManagedAuth ? captureServerOperationContext(scope.userId) : null;
    const session = serverManagedAuth ? null : await getSession();
    if (!serverManagedAuth && (!session?.access_token || session.user?.id !== scope.userId)) throw new ApiError('Account changed. Reload before continuing.', { status:401 });
    checkCurrent();
    const method = remove ? 'DELETE' : patch ? (id ? 'PATCH' : 'POST') : 'GET';
    const path = `${API_BASE_URL}/api/rooms${id ? `/${id}` : ''}?${new URLSearchParams({ organisationId:scope.organisationId })}`;
    const options = { method, cache:'no-store', credentials:'omit', headers:{ ...(patch ? {'Content-Type':'application/json'} : {}), ...(session ? {Authorization:`Bearer ${session.access_token}`} : {}) }, ...(patch ? {body:JSON.stringify(patch)} : {}) };
    if (context) assertServerOperationContext(context);
    const response = serverManagedAuth ? await serverAuthFetch(path, options, { fetchImpl, operationContext:context }) : await fetchImpl(path, options);
    const result = await parseJsonSafe(response);
    if (context) assertServerOperationContext(context);
    checkCurrent();
    if (!response.ok) throw new ApiError(result?.message || 'Could not confirm the room request. Reload rooms before retrying.', { status:response.status });
    if (remove) {
      if (!result || Object.keys(result).length !== 1 || result.deletedRoomId !== id) throw new ApiError('Could not confirm the deletion. Reload rooms before retrying.');
      return result.deletedRoomId;
    }
    if (patch) {
      if (!validRoom(result?.room) || id && result.room.id !== id) throw new ApiError('Could not confirm the room save. Reload rooms before retrying.');
      return result.room;
    }
    if (!Array.isArray(result?.rooms) || !result.rooms.every(validRoom) || typeof result.canManage !== 'boolean') throw new ApiError('Could not confirm room data.');
    return result;
  }
  return { load:(scope,options) => request(scope,null,null,false,options), save:(scope,id,patch,options) => request(scope,id,patch,false,options), remove:(scope,id,options) => { if (!isCanonicalUuid(id)) throw new ApiError('Room ID is invalid.'); return request(scope,id,null,true,options); } };
}
const api = createRoomApi();
export const fetchRooms = (scope,options) => api.load(scope,options);
export const saveRoom = (scope,id,patch,options) => api.save(scope,id,patch,options);

export const deleteRoom = (scope,id,options) => api.remove(scope,id,options);
