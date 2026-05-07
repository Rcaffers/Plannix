ALTER TABLE plannix_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_timetable_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_timetable_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plannix_classes_user_isolation ON plannix_classes;
CREATE POLICY plannix_classes_user_isolation
  ON plannix_classes
  FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS plannix_timetable_layouts_user_isolation ON plannix_timetable_layouts;
CREATE POLICY plannix_timetable_layouts_user_isolation
  ON plannix_timetable_layouts
  FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS plannix_timetable_sessions_user_isolation ON plannix_timetable_sessions;
CREATE POLICY plannix_timetable_sessions_user_isolation
  ON plannix_timetable_sessions
  FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));
