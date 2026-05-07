ALTER TABLE plannix_timetable_sessions
  ADD COLUMN IF NOT EXISTS week_key TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_plannix_timetable_sessions_slot_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_plannix_timetable_sessions_slot_unique
  ON plannix_timetable_sessions(user_id, layout_key, week_key, day, time);

CREATE INDEX IF NOT EXISTS idx_plannix_timetable_sessions_user_layout_week
  ON plannix_timetable_sessions(user_id, layout_key, week_key);
