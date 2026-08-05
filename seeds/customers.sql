-- Sándalo Spa — Customers seed (10 sample customers)
-- Safe to re-run: ON CONFLICT DO NOTHING

INSERT INTO customers (id, client_id, first_name, last_name, email, phone, phone_alt, preferred_contact, notes, custom_fields, is_active)
VALUES
  ('b0000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Maria', 'Rodriguez',
   'maria.rodriguez@gmail.com', '6175550101', NULL,
   'whatsapp', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'Carlos', 'Mendoza',
   'carlos.mendoza@gmail.com', '6175550102', NULL,
   'whatsapp', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'Ana', 'García',
   'ana.garcia@yahoo.com', '8575550103', NULL,
   'sms', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001',
   'Luis', 'Hernández',
   'luis.hernandez@gmail.com', '6175550104', '8575550114',
   'whatsapp', 'Local 26 member', '{}', true),

  ('b0000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000001',
   'Sofia', 'Ramirez',
   'sofia.ramirez@hotmail.com', '8575550105', NULL,
   'whatsapp', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000001',
   'José', 'Torres',
   'jose.torres@gmail.com', '6175550106', NULL,
   'call', 'Local 26 member', '{}', true),

  ('b0000000-0000-0000-0000-000000000007',
   '00000000-0000-0000-0000-000000000001',
   'Isabella', 'Flores',
   'isabella.flores@gmail.com', '8575550107', NULL,
   'whatsapp', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000008',
   '00000000-0000-0000-0000-000000000001',
   'Miguel', 'Santos',
   'miguel.santos@gmail.com', '6175550108', NULL,
   'sms', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000001',
   'Valentina', 'Cruz',
   'valentina.cruz@gmail.com', '8575550109', NULL,
   'whatsapp', 'Prefers afternoon appointments', '{}', true),

  ('b0000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'Roberto', 'Morales',
   'roberto.morales@gmail.com', '6175550110', NULL,
   'whatsapp', 'Local 26 member', '{}', true)

ON CONFLICT (id) DO NOTHING;

-- Local 26 membership program
INSERT INTO membership_programs (id, client_id, name, description, visit_limit, limit_period, requires_verification, claim_form_fields, is_active)
VALUES (
  'e0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Local 26',
  'Hotel workers union — covers up to 12 massage sessions per calendar month per member.',
  12, 'calendar_month', true,
  '{"member_id": "", "member_name": "", "service_date": "", "provider_name": "", "service_type": "", "authorization_number": ""}',
  true
)
ON CONFLICT (id) DO NOTHING;

-- Enroll the three Local 26 members
INSERT INTO customer_memberships (id, client_id, customer_id, program_id, member_id, verified_at, is_active)
VALUES
  ('f0000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000004',
   'e0000000-0000-0000-0000-000000000001',
   'L26-00104', '2025-01-15', true),

  ('f0000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000006',
   'e0000000-0000-0000-0000-000000000001',
   'L26-00106', '2025-03-02', true),

  ('f0000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000010',
   'e0000000-0000-0000-0000-000000000001',
   'L26-00110', '2025-02-20', true)

ON CONFLICT (id) DO NOTHING;
