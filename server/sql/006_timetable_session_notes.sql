ALTER TABLE plannix_timetable_sessions
ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
