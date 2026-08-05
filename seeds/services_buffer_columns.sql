ALTER TABLE services
  ADD COLUMN IF NOT EXISTS buffer_before_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buffer_after_minutes  integer NOT NULL DEFAULT 0;

-- Migrate existing buffer_minutes into the after (cleanup) column
UPDATE services SET buffer_after_minutes = buffer_minutes WHERE buffer_minutes > 0 AND buffer_after_minutes = 0;
