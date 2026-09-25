import './ClassPlacementPalette.css';

export default function ClassPlacementPalette({ entries, selectedId, disabled, disabledReason = '', dropProps = () => ({}), onSelect, onDragStart, onDragEnd, onCancel }) {
  return (
    <section className="class-placement-palette" aria-label="Class placement">
      <p className="class-placement-instructions">Drag a class to a lesson slot, or select it and then choose a slot.</p>
      {disabledReason ? <p className="class-placement-instructions" role="status">{disabledReason}</p> : null}
      <div className="class-placement-list">
        {entries.map((entry) => {
          const { className = '', hint, ...events } = dropProps(entry.id);
          return (
          <div key={entry.id} className={`class-placement-return${className}`} {...events}>
          <button type="button" className="class-placement-chip"
            disabled={disabled || !entry.remaining} aria-pressed={selectedId === entry.id}
            draggable={!disabled && entry.remaining > 0}
            onClick={() => onSelect(entry.id)} onDragStart={(event) => onDragStart(event, entry.id)} onDragEnd={onDragEnd}>
            <strong>{entry.name}</strong>
            <span>{entry.used} of {entry.max} placed</span>
            <span>{entry.remaining} remaining</span>
          </button>
          {hint ? <span className="class-placement-return-hint">{hint}</span> : null}
          </div>
        ); })}
      </div>
      {selectedId ? <div className="class-placement-instructions">
        <span>Choose an empty lesson slot to place {entries.find((entry) => entry.id === selectedId)?.name}. </span>
        <button type="button" onClick={onCancel}>Cancel placement</button>
      </div> : null}
    </section>
  );
}
