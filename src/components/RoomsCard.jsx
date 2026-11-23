import { useEffect, useRef, useState } from 'react';
export default function RoomsCard({ collection, scopeKey }) {
  const { rooms, loaded, loading, saving, canManage, uncertain, error, message, reload, save, remove } = collection;
  const renameInput = useRef(null), deleteCancel = useRef(null), reloadButton = useRef(null), addInput = useRef(null), renameButtons = useRef(new Map()), deleteButtons = useRef(new Map());
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const [name,setName] = useState(''), [editing,setEditing] = useState(null), [rename,setRename] = useState(''), [deleting,setDeleting] = useState(null);
  useEffect(() => { setName(''); setEditing(null); setRename(''); setDeleting(null); }, [scopeKey]);
  useEffect(() => { if (editing) { renameInput.current?.focus(); renameInput.current?.select(); } }, [editing]);
  useEffect(() => { if (deleting) deleteCancel.current?.focus(); }, [deleting]);
  const busy = saving || loading || uncertain;
  function returnFocus(id, expectedScope, action='rename') {
    requestAnimationFrame(() => {
      if (currentScope.current !== expectedScope) return;
      const trigger = id ? (action==='delete' ? deleteButtons : renameButtons).current.get(id) : addInput.current;
      const target = trigger && !trigger.disabled ? trigger : reloadButton.current;
      if (target && !target.disabled) target.focus();
    });
  }
  function cancelRename() { const id=editing; setEditing(null); setRename(''); returnFocus(id,scopeKey); }
  function beginRename(room) {
    setEditing(room.id); setRename(room.name);
  }
  async function submit(event) {
    event.preventDefault(); const expectedScope=scopeKey;
    if (await save(null, {name}) && currentScope.current === expectedScope) setName('');
  }
  async function submitRename(event, room) {
    event.preventDefault(); const expectedScope=scopeKey;
    if (await save(room.id, {name:rename}) && currentScope.current === expectedScope) {
      setEditing(null); setRename(''); returnFocus(room.id,expectedScope);
    }
  }
  async function deleteRoom(room) {
    const expectedScope=scopeKey;
    const removed=await remove(room.id);
    if (currentScope.current === expectedScope) { setDeleting(null); returnFocus(removed ? null : room.id,expectedScope,'delete'); }
  }
  return <section className="classes-form rooms-card" aria-labelledby="rooms-heading" aria-busy={loading || saving}>
    <h2 id="rooms-heading" className="classes-entry-title">Rooms</h2>
    <p className="classes-hint">Rooms are shared across this organisation’s academic years. A class default is used for new placements; changing it does not move existing lessons.</p>
    {loading && <p role="status">Loading rooms…</p>}
    {saving && <p role="status">Saving room changes…</p>}
    {error && <p role="alert" className="classes-hint classes-hint--error">{error}</p>}
    {error && <button ref={reloadButton} type="button" className="add-row-button" disabled={saving || loading} onClick={reload}>Reload rooms</button>}
    {message && <p role="status" className="classes-saved">{message}</p>}
    {loaded && !rooms.length && <p className="classes-hint">No rooms yet.{canManage ? ' Add a room below.' : ''}</p>}
    {loaded && !canManage && <p className="classes-hint">Organisation Admins manage rooms.</p>}
    {loaded && <ul className="rooms-list">{[...rooms].sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(room => <li key={room.id}>
      {canManage && editing===room.id ? <form className="rooms-inline-editor" onSubmit={event=>submitRename(event,room)} onKeyDown={event=>{
        if (event.key==='Escape' && !saving) { event.preventDefault(); event.stopPropagation(); cancelRename(); }
      }}>
        <div className="classes-field"><label htmlFor={`room-rename-${room.id}`}>Room name{!room.isActive ? ' (Archived)' : ''}</label>
          <input ref={renameInput} type="text" id={`room-rename-${room.id}`} value={rename} onChange={event=>setRename(event.target.value)} maxLength={200} required disabled={busy} /></div>
        <div className="rooms-actions"><button type="submit" className="classes-save" disabled={busy || !rename.trim()} aria-label={`Save room name ${room.name}`}>Save</button>
          <button type="button" className="add-row-button" disabled={saving} onClick={cancelRename}>Cancel</button></div>
      </form> : <>
        <span className="rooms-name">{room.name}{!room.isActive && <span> (Archived)</span>}</span>
        {canManage && <div className="rooms-actions">
          <button ref={button=>{if(button)renameButtons.current.set(room.id,button);else renameButtons.current.delete(room.id);}} type="button" className="add-row-button" disabled={busy || !!deleting || !!editing} aria-label={`Rename room ${room.name}`} onClick={()=>beginRename(room)}>Rename</button>
          <button ref={button=>{if(button)deleteButtons.current.set(room.id,button);else deleteButtons.current.delete(room.id);}} type="button" className="add-row-button add-row-button--danger" disabled={busy || !!editing || !!deleting} aria-label={`Delete room ${room.name}`} onClick={()=>setDeleting(room.id)}>Delete</button>
        </div>}
      </>}
      {canManage && deleting===room.id && <div className="rooms-delete-confirmation" role="group" aria-labelledby={`room-delete-${room.id}`} onKeyDown={event=>{
        if(event.key==='Escape' && !saving){event.preventDefault();event.stopPropagation();setDeleting(null);returnFocus(room.id,scopeKey,'delete');}
      }}>
        <p id={`room-delete-${room.id}`}>Delete room “{room.name}”?</p>
        <p className="classes-hint">This permanently deletes the room. Remove any class default and timetable lesson assignments first; deleting a room never clears those assignments.</p>
        <div className="rooms-actions"><button type="button" className="add-row-button add-row-button--danger rooms-confirm-delete" disabled={busy} onClick={()=>deleteRoom(room)}>Confirm delete</button>
          <button ref={deleteCancel} type="button" className="add-row-button" disabled={saving} onClick={()=>{setDeleting(null);returnFocus(room.id,scopeKey,'delete');}}>Cancel</button></div>
      </div>}
    </li>)}</ul>}
    {loaded && canManage && <form onSubmit={submit} className="rooms-editor">
      <div className="classes-field"><label htmlFor="room-name">Room name</label><input ref={addInput} type="text" id="room-name" value={name} onChange={e=>setName(e.target.value)} maxLength={200} required disabled={busy || !!editing || !!deleting} placeholder="e.g. Room 12" /></div>
      <div className="rooms-actions"><button type="submit" className="classes-save" disabled={busy || !!editing || !!deleting || !name.trim()}>Add room</button></div>
    </form>}
  </section>;
}
