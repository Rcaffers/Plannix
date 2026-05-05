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
  day INTEGER NOT NULL,
  time INTEGER NOT NULL,
  class_id UUID NULL REFERENCES plannix_classes(id) ON DELETE SET NULL,
  class_name TEXT,
  teacher TEXT,
  title TEXT,
  meta TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plannix_timetable_sessions_user_layout
  ON plannix_timetable_sessions(user_id, layout_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plannix_timetable_sessions_slot_unique
  ON plannix_timetable_sessions(user_id, layout_key, day, time);
