CREATE TABLE IF NOT EXISTS time_blocks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid        NOT NULL,
  staff_id   uuid        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  block_date date        NOT NULL,
  start_time time        NOT NULL,
  end_time   time        NOT NULL,
  label      text        NOT NULL DEFAULT 'Blocked',
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
ALTER TABLE time_blocks DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS time_blocks_client_date ON time_blocks(client_id, block_date);
