export function registerPlannerRoutes({
  app,
  requireDb,
  requireSessionUser,
  sendError,
  withUserDbSession,
}) {
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
