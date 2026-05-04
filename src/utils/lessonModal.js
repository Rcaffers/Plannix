export function lessonAriaLabel(session) {
  if (!session) return undefined;
  const trimmedTitle = session.title.trim();
  return `Edit lesson: ${session.class}${trimmedTitle ? `, ${trimmedTitle}` : ''}`;
}
