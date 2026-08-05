-- Sándalo Spa — Additional customers seed (customers 11–30)
-- Extends customers.sql with 20 more entries
-- Safe to re-run: ON CONFLICT DO NOTHING

INSERT INTO customers (id, client_id, first_name, last_name, middle_name, email, phone, phone_alt, preferred_contact, preferred_language, notes, custom_fields, is_active)
VALUES
  ('b0000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'Elena', 'Vasquez', NULL,
   'elena.vasquez@gmail.com', '6175550111', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0000-000000000001',
   'Diego', 'Reyes', NULL,
   'diego.reyes@gmail.com', '8575550112', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000013',
   '00000000-0000-0000-0000-000000000001',
   'Catalina', 'Lopez', NULL,
   'catalina.lopez@gmail.com', '6175550113', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000014',
   '00000000-0000-0000-0000-000000000001',
   'Fernando', 'Castro', NULL,
   'fernando.castro@gmail.com', '8575550114', NULL,
   'call', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000015',
   '00000000-0000-0000-0000-000000000001',
   'Adriana', 'Jimenez', NULL,
   'adriana.jimenez@gmail.com', '6175550115', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000016',
   '00000000-0000-0000-0000-000000000001',
   'Andres', 'Herrera', NULL,
   'andres.herrera@gmail.com', '8575550116', NULL,
   'sms', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000017',
   '00000000-0000-0000-0000-000000000001',
   'Paola', 'Medina', NULL,
   'paola.medina@gmail.com', '6175550117', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000018',
   '00000000-0000-0000-0000-000000000001',
   'Sebastian', 'Ortiz', NULL,
   'sebastian.ortiz@gmail.com', '8575550118', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000019',
   '00000000-0000-0000-0000-000000000001',
   'Mariana', 'Ruiz', NULL,
   'mariana.ruiz@gmail.com', '6175550119', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000020',
   '00000000-0000-0000-0000-000000000001',
   'Nicolas', 'Vargas', NULL,
   'nicolas.vargas@gmail.com', '8575550120', NULL,
   'call', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000021',
   '00000000-0000-0000-0000-000000000001',
   'Camila', 'Perez', NULL,
   'camila.perez@gmail.com', '6175550121', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-000000000001',
   'Rafael', 'Moreno', NULL,
   'rafael.moreno@gmail.com', '8575550122', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000023',
   '00000000-0000-0000-0000-000000000001',
   'Daniela', 'Aguilar', NULL,
   'daniela.aguilar@gmail.com', '6175550123', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000024',
   '00000000-0000-0000-0000-000000000001',
   'Mateo', 'Romero', NULL,
   'mateo.romero@gmail.com', '8575550124', NULL,
   'sms', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000025',
   '00000000-0000-0000-0000-000000000001',
   'Valeria', 'Sanchez', NULL,
   'valeria.sanchez@gmail.com', '6175550125', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000026',
   '00000000-0000-0000-0000-000000000001',
   'Alejandro', 'Navarro', NULL,
   'alejandro.navarro@gmail.com', '8575550126', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000027',
   '00000000-0000-0000-0000-000000000001',
   'Gabriela', 'Espinosa', NULL,
   'gabriela.espinosa@gmail.com', '6175550127', NULL,
   'whatsapp', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000028',
   '00000000-0000-0000-0000-000000000001',
   'Eduardo', 'Mendez', NULL,
   'eduardo.mendez@gmail.com', '8575550128', NULL,
   'call', 'es', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000029',
   '00000000-0000-0000-0000-000000000001',
   'Christina', 'White', NULL,
   'christina.white@gmail.com', '6175550129', NULL,
   'sms', 'en', NULL, '{}', true),

  ('b0000000-0000-0000-0000-000000000030',
   '00000000-0000-0000-0000-000000000001',
   'Jennifer', 'Kim', NULL,
   'jennifer.kim@gmail.com', '8575550130', NULL,
   'whatsapp', 'en', NULL, '{}', true)

ON CONFLICT (id) DO NOTHING;
