-- Payment methods table
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/fwbdcxnabfmfvsngherc/sql/new

CREATE TABLE IF NOT EXISTS payment_methods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL,
  name       text NOT NULL,
  code       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, code)
);

ALTER TABLE payment_methods DISABLE ROW LEVEL SECURITY;

-- Seed the four methods already used in the system
INSERT INTO payment_methods (client_id, name, code, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Square',    'square',    1),
  ('00000000-0000-0000-0000-000000000001', 'Cash',      'cash',      2),
  ('00000000-0000-0000-0000-000000000001', 'Insurance', 'insurance', 3),
  ('00000000-0000-0000-0000-000000000001', 'Other',     'other',     4)
ON CONFLICT (client_id, code) DO NOTHING;
