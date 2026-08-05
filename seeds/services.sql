-- Sándalo Spa — Services seed
-- Source: sandalospa.com Square booking catalog
-- Run: paste into Supabase SQL editor or POST to /database/query
-- Safe to re-run: ON CONFLICT DO NOTHING

INSERT INTO services (id, client_id, name, name_es, category, duration_minutes, buffer_minutes, price, deposit_amount, required_license_type, sort_order, is_active)
VALUES
  -- Massages
  ('a0000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   '1 hr Relaxation Massage',
   '1 hora Masaje Relajación',
   'Massage', 60, 30, 95.00, 40.00, NULL, 1, true),

  ('a0000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   '1 hr Therapeutic Massage with Technique',
   '1 hora Masaje Terapéutico con Técnica',
   'Massage', 60, 30, 115.00, 40.00, 'massage', 2, true),

  ('a0000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   '1.5 hr Full Therapeutic Massage (All 4 Techniques)',
   '1.5 horas Masaje Terapéutico Completo (4 Técnicas)',
   'Massage', 90, 0, 145.00, 40.00, 'massage', 3, true),

  ('a0000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001',
   '1 hr Lymphatic Drainage Massage',
   '1 hora Masaje de Drenaje Linfático',
   'Massage', 60, 30, 115.00, 40.00, 'massage', 4, true),

  -- Facials
  ('a0000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000001',
   '1.5 hr Facial Hydration',
   '1.5 horas Hidratación Facial',
   'Facial', 90, 0, 140.00, 40.00, 'esthetics', 5, true),

  ('a0000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000001',
   '1.5 hr Facial Cleansing and Hydration',
   '1.5 horas Limpieza e Hidratación Facial',
   'Facial', 90, 0, 180.00, 40.00, 'esthetics', 6, true),

  ('a0000000-0000-0000-0000-000000000007',
   '00000000-0000-0000-0000-000000000001',
   '1.5 hr Full and Rejuvenating Facial Treatment',
   '1.5 horas Tratamiento Facial Completo y Rejuvenecedor',
   'Facial', 90, 0, 200.00, 40.00, 'esthetics', 7, true),

  -- Post-Surgical (price is per-session; packages sold as 10 sessions each)
  ('a0000000-0000-0000-0000-000000000008',
   '00000000-0000-0000-0000-000000000001',
   'Post-Surgical Phase 1: Drainage (10-session package)',
   'Post-Quirúrgico Fase 1: Drenaje (paquete 10 sesiones)',
   'Post-Surgical', 60, 0, 95.00, NULL, 'massage', 8, true),

  ('a0000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000001',
   'Post-Surgical Phase 2: Inflammation Management (10-session package)',
   'Post-Quirúrgico Fase 2: Control de Inflamación (paquete 10 sesiones)',
   'Post-Surgical', 60, 0, 95.00, NULL, 'massage', 9, true),

  ('a0000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'Post-Surgical Phase 3: Body Contouring (10-session package)',
   'Post-Quirúrgico Fase 3: Contorneado Corporal (paquete 10 sesiones)',
   'Post-Surgical', 60, 0, 100.00, NULL, 'massage', 10, true),

  -- Consultation
  ('a0000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'Valuation / Consultation',
   'Valoración / Consulta',
   'Consultation', 30, 0, 0.00, NULL, NULL, 11, true)

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  name_es = EXCLUDED.name_es,
  required_license_type = EXCLUDED.required_license_type;
