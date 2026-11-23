import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRooms, saveRoom, deleteRoom } from '../utils/roomApi';
const empty = { rooms:[], canManage:false, loaded:false, loading:false, saving:false, uncertain:false, error:'', message:'' };
export function useRooms(scope, enabled, { afterRemove } = {}) {
  const key = enabled ? scope?.key : null;
  const current = useRef(key); current.current = key;
  const sequence = useRef(0), busy = useRef(null);
  const [state, setState] = useState({ ...empty, key:null });
  const visible = state.key === key ? state : { ...empty, loading:!!key, key };
  const reload = useCallback(async () => {
    if (!key || current.current !== key || busy.current?.key === key) return false;
    const request = ++sequence.current;
    setState(s => ({ ...(s.key === key ? s : empty), key, loading:true, error:'', message:'' }));
    try {
      const result = await fetchRooms(scope,{isCurrent:()=>current.current===key && request===sequence.current});
      if (current.current !== key || request !== sequence.current) return false;
      setState({ ...empty, ...result, key, loaded:true });
      return true;
    } catch {
      if (current.current === key && request === sequence.current) setState(s => ({ ...s, loading:false, loaded:false, canManage:false, error:'Could not load rooms. Reload rooms to confirm their current state.' }));
      return false;
    }
  }, [key]);
  useEffect(() => { ++sequence.current; busy.current = null; if (key) void reload(); return () => { ++sequence.current; }; }, [key, reload]);
  async function mutate(id, patch, remove = false) {
    if (!key || current.current !== key || !visible.canManage || !visible.loaded || visible.loading || visible.uncertain || busy.current?.key === key) return false;
    const token = {key};
    busy.current = token;
    const request = ++sequence.current;
    setState(s => ({ ...s, saving:true, error:'', message:'' }));
    let writeConfirmed = false;
    try {
      const saved = remove ? await deleteRoom(scope, id,{isCurrent:()=>current.current===key && request===sequence.current}) : await saveRoom(scope, id, patch,{isCurrent:()=>current.current===key && request===sequence.current});
      writeConfirmed = true;
      if (current.current !== key || request !== sequence.current) return false;
      const result = await fetchRooms(scope,{isCurrent:()=>current.current===key && request===sequence.current});
      if (current.current !== key || request !== sequence.current) return false;
      const confirmed = result.rooms.find(r => r.id === (remove ? saved : saved.id));
      if (remove ? (!result.canManage || !!confirmed) : (!confirmed || (Object.hasOwn(patch,'name') && confirmed.name !== patch.name.trim()) || (Object.hasOwn(patch,'isActive') && confirmed.isActive !== patch.isActive))) throw Error('Readback mismatch');
      if (remove && afterRemove && !await afterRemove()) throw Error('Class refresh failed');
      if (current.current !== key || request !== sequence.current) return false;
      setState({ ...empty, ...result, key, loaded:true, message:remove ? 'Room deleted.' : 'Room saved.' });
      return true;
    } catch (error) {
      const certainRejection = !writeConfirmed && [400,403,404,409,422].includes(error?.status);
      if (current.current === key && request === sequence.current) setState(s => ({ ...s, saving:false, canManage:error?.status === 403 ? false : s.canManage, uncertain:!certainRejection, error:certainRejection ? error.message : (remove ? 'The deletion could not be confirmed. Reload rooms before trying again; it may already have been deleted.' : 'The save could not be confirmed. Reload rooms before trying again; it may already have saved.') }));
      return false;
    } finally { if (busy.current === token) busy.current = null; }
  }
  return { ...visible, reload, save:(id,patch)=>mutate(id,patch), remove:id=>mutate(id,null,true) };
}
