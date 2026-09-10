export function registerPlannerRoutes({
  app,
  mapClassRow,
  requireDb,
  requireSessionUser,
  sendError,
  withUserDbSession,
}) {
  app.get('/api/classes', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    try {
      const result = await withUserDbSession(user.id, (client) =>
        client.query(
          `SELECT id, name, frequency, cadence
           FROM plannix_classes
           WHERE user_id = $1
           ORDER BY sort_order ASC, created_at ASC`,
          [user.id],
        ),
      );
      return res.json({
        entries: result.rows.map(mapClassRow),
      });
    } catch (error) {
      return sendError(res, error, 'Failed to load classes.');
    }
  });

  app.put('/api/classes', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;

    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const cadence = req.body?.cadence === 'two-weeks' ? 'two-weeks' : 'week';
    const normalizedEntries = entries
      .map((entry, index) => ({
        id: entry?.id ? String(entry.id) : null,
        name: String(entry?.name || '').trim(),
        frequency: Math.max(0, Number.parseInt(entry?.frequency, 10) || 0),
        cadence: entry?.cadence === 'two-weeks' ? 'two-weeks' : cadence,
        sortOrder: index,
      }))
      .filter((entry) => entry.name);

    try {
      await withUserDbSession(user.id, async (client) => {
        await client.query('DELETE FROM plannix_classes WHERE user_id = $1', [user.id]);

        for (const entry of normalizedEntries) {
          await client.query(
            `INSERT INTO plannix_classes (id, user_id, name, frequency, cadence, sort_order, updated_at)
             VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, NOW())`,
            [entry.id, user.id, entry.name, entry.frequency, entry.cadence, entry.sortOrder],
          );
        }
      });
      return res.json({
        cadence,
        entries: normalizedEntries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          frequency: entry.frequency,
          cadence: entry.cadence,
        })),
      });
    } catch (error) {
      return sendError(res, error, 'Failed to save classes.');
    }
  });

  app.get('/api/timetable/layout', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    try {
      const result = await withUserDbSession(user.id, (client) =>
        client.query('SELECT layout FROM plannix_timetable_layouts WHERE user_id = $1', [user.id]),
      );
      return res.json({ layout: result.rows[0]?.layout || null });
    } catch (error) {
      return sendError(res, error, 'Failed to load timetable layout.');
    }
  });

  app.put('/api/timetable/layout', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    const layout = req.body?.layout;
    if (!layout || typeof layout !== 'object') {
      return res.status(400).json({ message: 'layout object is required.' });
    }
    try {
      await withUserDbSession(user.id, (client) =>
        client.query(
          `INSERT INTO plannix_timetable_layouts (user_id, layout, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (user_id)
           DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()`,
          [user.id, JSON.stringify(layout)],
        ),
      );
      return res.json({ ok: true });
    } catch (error) {
      return sendError(res, error, 'Failed to save timetable layout.');
    }
  });

  app.get('/api/academic-year', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    try {
      const result = await withUserDbSession(user.id, (client) =>
        client.query('SELECT plan FROM plannix_academic_years WHERE user_id = $1', [user.id]),
      );
      return res.json({ plan: result.rows[0]?.plan || null });
    } catch (error) {
      return sendError(res, error, 'Failed to load academic year.');
    }
  });

  app.put('/api/academic-year', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    const plan = req.body?.plan;
    if (!plan || typeof plan !== 'object') {
      return res.status(400).json({ message: 'plan object is required.' });
    }
    try {
      await withUserDbSession(user.id, (client) =>
        client.query(
          `INSERT INTO plannix_academic_years (user_id, plan, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (user_id)
           DO UPDATE SET plan = EXCLUDED.plan, updated_at = NOW()`,
          [user.id, JSON.stringify(plan)],
        ),
      );
      return res.json({ ok: true });
    } catch (error) {
      return sendError(res, error, 'Failed to save academic year.');
    }
  });

  app.get('/api/timetable/sessions', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    const layoutKey = String(req.query.layoutKey || '').trim();
    const weekKey = String(req.query.weekKey || '').trim();
    if (!layoutKey) {
      return res.status(400).json({ message: 'layoutKey query parameter is required.' });
    }
    try {
      const result = await withUserDbSession(user.id, (client) =>
        client.query(
          `SELECT s.day, s.time, s.class_id AS "classId",
                  COALESCE(c.name, s.class_name, '') AS class,
                  COALESCE(s.teacher, '') AS teacher,
                  COALESCE(s.title, '') AS title,
                  COALESCE(s.notes, '') AS notes,
                  COALESCE(s.meta, '') AS meta
           FROM plannix_timetable_sessions s
           LEFT JOIN plannix_classes c ON c.id = s.class_id
           WHERE s.user_id = $1 AND s.layout_key = $2 AND s.week_key = $3
           ORDER BY s.day ASC, s.time ASC`,
          [user.id, layoutKey, weekKey],
        ),
      );
      return res.json({ sessions: result.rows });
    } catch (error) {
      return sendError(res, error, 'Failed to load timetable sessions.');
    }
  });

  app.put('/api/timetable/sessions', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    const layoutKey = String(req.body?.layoutKey || '').trim();
    const weekKey = String(req.body?.weekKey || '').trim();
    const sessionsPayload = Array.isArray(req.body?.sessions) ? req.body.sessions : null;
    if (!layoutKey || !sessionsPayload) {
      return res.status(400).json({ message: 'layoutKey and sessions are required.' });
    }

    const normalized = sessionsPayload.map((session) => ({
      day: Number.parseInt(session?.day, 10) || 0,
      time: Number.parseInt(session?.time, 10) || 0,
      classId: session?.classId ? String(session.classId) : null,
      className: String(session?.class || '').trim(),
      teacher: String(session?.teacher || '').trim(),
      title: String(session?.title || '').trim(),
      notes: String(session?.notes || '')
        .trim()
        .slice(0, 4000),
      meta: String(session?.meta || '').trim(),
    }));

    try {
      await withUserDbSession(user.id, async (client) => {
        await client.query(
          'DELETE FROM plannix_timetable_sessions WHERE user_id = $1 AND layout_key = $2 AND week_key = $3',
          [user.id, layoutKey, weekKey],
        );

        for (const session of normalized) {
          await client.query(
            `INSERT INTO plannix_timetable_sessions
              (user_id, layout_key, week_key, day, time, class_id, class_name, teacher, title, notes, meta, updated_at)
             VALUES
              ($1, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11, NOW())`,
            [
              user.id,
              layoutKey,
              weekKey,
              session.day,
              session.time,
              session.classId,
              session.className,
              session.teacher,
              session.title,
              session.notes,
              session.meta,
            ],
          );
        }
      });
      return res.json({ ok: true });
    } catch (error) {
      return sendError(res, error, 'Failed to save timetable sessions.');
    }
  });

  app.delete('/api/timetable/sessions', async (req, res) => {
    if (!requireDb(res)) {
      return;
    }
    const user = await requireSessionUser(req, res);
    if (!user) return;
    const layoutKey = String(req.query.layoutKey || '').trim();
    if (!layoutKey) {
      return res.status(400).json({ message: 'layoutKey query parameter is required.' });
    }
    try {
      await withUserDbSession(user.id, (client) =>
        client.query(
          'DELETE FROM plannix_timetable_sessions WHERE user_id = $1 AND layout_key = $2',
          [user.id, layoutKey],
        ),
      );
      return res.json({ ok: true });
    } catch (error) {
      return sendError(res, error, 'Failed to clear timetable sessions.');
    }
  });
}
