export function lessonAriaLabel(session) {
  if (!session) return undefined;
  const trimmedTitle = String(session.title || '').trim();
  const hasNotes = String(session.notes || '').trim().length > 0;
  const base = `Edit lesson: ${session.class || 'Lesson'}${trimmedTitle ? `, ${trimmedTitle}` : ''}`;
  return hasNotes ? `${base}; has notes` : base;
}
