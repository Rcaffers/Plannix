ALTER TABLE plannix_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_timetable_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_timetable_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_sessions ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS plannix_academic_years_user_isolation ON plannix_academic_years;
CREATE POLICY plannix_academic_years_user_isolation
  ON plannix_academic_years
  FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS plannix_users_self_access ON plannix_users;
CREATE POLICY plannix_users_self_access
  ON plannix_users
  FOR SELECT
  USING (id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS plannix_users_self_update ON plannix_users;
CREATE POLICY plannix_users_self_update
  ON plannix_users
  FOR UPDATE
  USING (id = current_setting('app.user_id', true))
  WITH CHECK (id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS plannix_users_auth_flow_read ON plannix_users;
CREATE POLICY plannix_users_auth_flow_read
  ON plannix_users
  FOR SELECT
  USING (current_setting('app.auth_flow', true) = 'true');

DROP POLICY IF EXISTS plannix_users_auth_flow_insert ON plannix_users;
CREATE POLICY plannix_users_auth_flow_insert
  ON plannix_users
  FOR INSERT
  WITH CHECK (current_setting('app.auth_flow', true) = 'true');

DROP POLICY IF EXISTS plannix_users_auth_flow_delete ON plannix_users;
CREATE POLICY plannix_users_auth_flow_delete
  ON plannix_users
  FOR DELETE
  USING (current_setting('app.auth_flow', true) = 'true');

DROP POLICY IF EXISTS plannix_sessions_user_isolation ON plannix_sessions;
CREATE POLICY plannix_sessions_user_isolation
  ON plannix_sessions
  FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS plannix_sessions_auth_flow_manage ON plannix_sessions;
CREATE POLICY plannix_sessions_auth_flow_manage
  ON plannix_sessions
  FOR ALL
  USING (current_setting('app.auth_flow', true) = 'true')
  WITH CHECK (current_setting('app.auth_flow', true) = 'true');
