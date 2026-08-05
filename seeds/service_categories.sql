-- Service categories table
CREATE TABLE IF NOT EXISTS service_categories (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid        NOT NULL,
  name       text        NOT NULL,
  color      text        NOT NULL DEFAULT '#4A7B6A',
  sort_order integer     NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, name)
);
ALTER TABLE service_categories DISABLE ROW LEVEL SECURITY;

-- Seed from existing service data
INSERT INTO service_categories (client_id, name, color, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Massage',       '#2C5F52', 1),
  ('00000000-0000-0000-0000-000000000001', 'Facial',        '#C8A96E', 2),
  ('00000000-0000-0000-0000-000000000001', 'Post-Surgical', '#1A6EAD', 3),
  ('00000000-0000-0000-0000-000000000001', 'Consultation',  '#4A4A3F', 4)
ON CONFLICT (client_id, name) DO NOTHING;

-- Add category_id FK and multi-staff columns to services
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS category_id    uuid    REFERENCES service_categories(id),
  ADD COLUMN IF NOT EXISTS staff_count    integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS customer_count integer NOT NULL DEFAULT 1;

-- Populate category_id from existing category text
UPDATE services s
SET category_id = sc.id
FROM service_categories sc
WHERE sc.client_id = s.client_id AND sc.name = s.category
  AND s.category_id IS NULL;

-- Add group_id to appointments for linked multi-staff bookings
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS group_id uuid;
CREATE INDEX IF NOT EXISTS appointments_group_id ON appointments(group_id)
  WHERE group_id IS NOT NULL;
