export const deletionCalls = [];

export class ApiError extends Error {}

export async function deleteAccount(details) {
  deletionCalls.push(details.expectedSessionName || 'bearer');
}

export function useTimetableLayout() {
  return { clearUserLayout: () => window.deletionEffects.push('clear-layout') };
}

export function useAcademicYear() {
  return { clearUserAcademicYear: () => window.deletionEffects.push('clear-year') };
}
