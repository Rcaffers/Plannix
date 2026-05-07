CREATE TABLE IF NOT EXISTS plannix_academic_years (
  user_id TEXT PRIMARY KEY,
  plan JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE plannix_academic_years ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plannix_academic_years_user_isolation ON plannix_academic_years;
CREATE POLICY plannix_academic_years_user_isolation
  ON plannix_academic_years
  FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));
