import { useEffect, useRef, useState } from 'react';
export default function RoomsCard({ collection, scopeKey }) {
  const { rooms, loaded, loading, saving, canManage, uncertain, error, message, reload, save } = collection;
  const nameInput = useRef(null), renameButton = useRef(null);
  const [name,setName] = useState(''), [editing,setEditing] = useState(null);
  useEffect(() => { setName(''); setEditing(null); }, [scopeKey]);
  const busy = saving || loading || uncertain;
  async function submit(event) {
    event.preventDefault();
    if (await save(editing, { name })) { setName(''); setEditing(null); if (editing) renameButton.current?.focus(); }
  }
  return <section className="classes-form rooms-card" aria-labelledby="rooms-heading" aria-busy={loading || saving}>
    <h2 id="rooms-heading" className="classes-entry-title">Rooms</h2>
    <p className="classes-hint">Rooms are shared across this organisation’s academic years. A class default is used for new placements; changing it does not move existing lessons.</p>
    {loading && <p role="status">Loading rooms…</p>}
    {saving && <p role="status">Saving room…</p>}
    {error && <p role="alert" className="classes-hint classes-hint--error">{error}</p>}
    {error && <button type="button" className="add-row-button" disabled={saving || loading} onClick={reload}>Reload rooms</button>}
    {message && <p role="status" className="classes-saved">{message}</p>}
    {loaded && !rooms.length && <p className="classes-hint">No rooms yet.{canManage ? ' Add a room below.' : ''}</p>}
    {loaded && !canManage && <p className="classes-hint">Organisation Admins manage rooms.</p>}
    {loaded && <ul className="rooms-list">{[...rooms].sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(room => <li key={room.id}>
      <span className="rooms-name">{room.name}{!room.isActive && <span> (Archived)</span>}</span>
      {canManage && <div className="rooms-actions">
        <button type="button" className="add-row-button" disabled={busy} aria-label={`Rename room ${room.name}`} onClick={event => { renameButton.current = event.currentTarget; setEditing(room.id); setName(room.name); nameInput.current?.focus(); }}>Rename</button>
        <button type="button" className="add-row-button" disabled={busy} aria-label={`${room.isActive ? 'Archive' : 'Reactivate'} room ${room.name}`} onClick={() => save(room.id, {isActive:!room.isActive})}>{room.isActive ? 'Archive' : 'Reactivate'}</button>
      </div>}
    </li>)}</ul>}
    {loaded && canManage && <form onSubmit={submit} className="rooms-editor">
      <div className="classes-field"><label htmlFor="room-name">{editing ? 'Rename room' : 'Room name'}</label><input ref={nameInput} id="room-name" value={name} onChange={e => setName(e.target.value)} maxLength={200} required disabled={saving || loading} placeholder="e.g. Room 12" /></div>
      <div className="rooms-actions"><button className="classes-save" disabled={busy || !name.trim()}>{editing ? 'Save room name' : 'Add room'}</button>{editing && <button type="button" className="add-row-button" disabled={saving} onClick={() => { setEditing(null); setName(''); renameButton.current?.focus(); }}>Cancel rename</button>}</div>
    </form>}
  </section>;
}
