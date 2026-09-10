export function createSignupHandler({
  attachSessionCookie,
  createUser,
  findUserByEmail,
  hashPassword,
  normalizeEmailInput,
  randomUUID,
  requireDb,
  toPublicUser,
  validateSignupPayload,
}) {
  return async function signup(req, res) {
    if (!requireDb(res)) return;

    const name = String(req.body?.name || '').trim();
    const email = normalizeEmailInput(req.body?.email);
    const password = String(req.body?.password || '');
    const validationError = validateSignupPayload({ name, email, password });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ message: 'An account already exists for this email.' });
    }

    const passwordHash = await hashPassword(password);
    const newUser = await createUser({
      id: `u_individual_${randomUUID()}`,
      name,
      email,
      passwordHash,
    });
    await attachSessionCookie(res, newUser.id);
    return res.status(201).json({ user: toPublicUser(newUser) });
  };
}

export function createSessionCookieAttacher({ createSessionForUser, cookieName, cookieOptions }) {
  return async function attachSessionCookie(res, userId) {
    const sessionId = await createSessionForUser(userId);
    res.cookie(cookieName, sessionId, cookieOptions);
  };
}

export function registerSignupRoute({ app, ...dependencies }) {
  app.post('/auth/signup', createSignupHandler(dependencies));
}
