const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function pilotUserFromEnvironment(environment, flag) {
  if (environment[flag] !== 'true') return null;
  const userId = environment.MORNING_SUMMARY_PILOT_USER_ID;
  if (typeof userId !== 'string' || !UUID.test(userId)) {
    throw new Error('Morning summary pilot configuration is invalid.');
  }
  return userId;
}
