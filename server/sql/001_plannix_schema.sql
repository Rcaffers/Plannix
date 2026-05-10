-- Plannix schema: tables, indexes, and row-level security (idempotent).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS plannix_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  frequency INTEGER NOT NULL DEFAULT 0 CHECK (frequency >= 0),
  cadence TEXT NOT NULL DEFAULT 'week' CHECK (cadence IN ('week', 'two-weeks')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plannix_classes_user_id ON plannix_classes(user_id);

CREATE TABLE IF NOT EXISTS plannix_timetable_layouts (
  user_id TEXT PRIMARY KEY,
  layout JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plannix_timetable_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  layout_key TEXT NOT NULL,
  week_key TEXT NOT NULL DEFAULT '',
  day INTEGER NOT NULL,
  time INTEGER NOT NULL,
  class_id UUID NULL REFERENCES plannix_classes(id) ON DELETE SET NULL,
  class_name TEXT,
  teacher TEXT,
  title TEXT,
  notes TEXT NOT NULL DEFAULT '',
  meta TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plannix_timetable_sessions_user_layout
  ON plannix_timetable_sessions(user_id, layout_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plannix_timetable_sessions_slot_unique
  ON plannix_timetable_sessions(user_id, layout_key, week_key, day, time);

CREATE INDEX IF NOT EXISTS idx_plannix_timetable_sessions_user_layout_week
  ON plannix_timetable_sessions(user_id, layout_key, week_key);

CREATE TABLE IF NOT EXISTS plannix_academic_years (
  user_id TEXT PRIMARY KEY,
  plan JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plannix_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plannix_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES plannix_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plannix_sessions_user_id ON plannix_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_plannix_sessions_expires_at ON plannix_sessions(expires_at);

CREATE TABLE IF NOT EXISTS plannix_password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES plannix_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plannix_pwreset_token_hash ON plannix_password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_plannix_pwreset_user_id ON plannix_password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_plannix_pwreset_expires ON plannix_password_reset_tokens(expires_at);

ALTER TABLE plannix_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_timetable_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_timetable_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plannix_password_reset_tokens ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS plannix_users_auth_flow_update ON plannix_users;
CREATE POLICY plannix_users_auth_flow_update
  ON plannix_users
  FOR UPDATE
  USING (current_setting('app.auth_flow', true) = 'true')
  WITH CHECK (current_setting('app.auth_flow', true) = 'true');

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

DROP POLICY IF EXISTS plannix_pwreset_auth_flow ON plannix_password_reset_tokens;
CREATE POLICY plannix_pwreset_auth_flow
  ON plannix_password_reset_tokens
  FOR ALL
  USING (current_setting('app.auth_flow', true) = 'true')
  WITH CHECK (current_setting('app.auth_flow', true) = 'true');
