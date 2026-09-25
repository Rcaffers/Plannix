import './PlacedLessonCard.css';

/** A native drag surface separate from the keyboard-operable modal action. */
export default function PlacedLessonCard({ draggable, dragging, onDragStart, onDragEnd, onOpen, label, children }) {
  return (
    <div className={`lesson-card lesson-card--placed${dragging ? ' lesson-card--dragging' : ''}`}
      draggable={Boolean(draggable)} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {draggable ? <span className="lesson-drag-handle" aria-hidden="true" title="Drag to move or return to its class card">⠿ Drag lesson</span> : null}
      <button type="button" className="lesson-card-action" draggable={false} onClick={onOpen} aria-label={label}>
        {children}
      </button>
    </div>
  );
}
