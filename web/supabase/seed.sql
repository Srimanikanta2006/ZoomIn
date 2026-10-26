-- Synthetic demo seed: five institutions and five draft applications.
-- Stable IDs and ON CONFLICT make re-running the seed safe.
insert into public.institutions (id, institution_code, name, institution_type, state, district) values
  ('10000000-0000-4000-8000-000000000001', 'DEMO-INST-001', 'Synthetic Institute Alpha', 'private', 'Karnataka', 'Demo District A'),
  ('10000000-0000-4000-8000-000000000002', 'DEMO-INST-002', 'Synthetic Institute Beta', 'public', 'Maharashtra', 'Demo District B'),
  ('10000000-0000-4000-8000-000000000003', 'DEMO-INST-003', 'Synthetic Institute Gamma', 'private', 'Tamil Nadu', 'Demo District C'),
  ('10000000-0000-4000-8000-000000000004', 'DEMO-INST-004', 'Synthetic Institute Delta', 'public', 'Gujarat', 'Demo District D'),
  ('10000000-0000-4000-8000-000000000005', 'DEMO-INST-005', 'Synthetic Institute Epsilon', 'private', 'Kerala', 'Demo District E')
on conflict (institution_code) do update set
  name = excluded.name,
  institution_type = excluded.institution_type,
  state = excluded.state,
  district = excluded.district;

insert into public.applications (id, institution_id, application_number, application_type, academic_year, status)
select v.application_id, i.id, v.application_number, 'new_program', '2026-27', 'submitted'
from (values
  ('20000000-0000-4000-8000-000000000001'::uuid, 'DEMO-APP-2026-001', 'DEMO-INST-001'),
  ('20000000-0000-4000-8000-000000000002'::uuid, 'DEMO-APP-2026-002', 'DEMO-INST-002'),
  ('20000000-0000-4000-8000-000000000003'::uuid, 'DEMO-APP-2026-003', 'DEMO-INST-003'),
  ('20000000-0000-4000-8000-000000000004'::uuid, 'DEMO-APP-2026-004', 'DEMO-INST-004'),
  ('20000000-0000-4000-8000-000000000005'::uuid, 'DEMO-APP-2026-005', 'DEMO-INST-005')
) as v(application_id, application_number, institution_code)
join public.institutions i on i.institution_code = v.institution_code
on conflict (application_number) do update set
  institution_id = excluded.institution_id,
  application_type = excluded.application_type,
  academic_year = excluded.academic_year,
  status = excluded.status;

insert into public.documents (id, application_id, document_type, file_name, storage_path, sha256, mime_type, page_count)
select v.document_id, a.id, 'application_form', v.file_name,
  'synthetic-demo/' || v.file_name, v.sha256, 'application/pdf', 1
from (values
  ('30000000-0000-4000-8000-000000000001'::uuid, 'DEMO-APP-2026-001', 'demo-application-001.pdf', repeat('1',64)),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'DEMO-APP-2026-002', 'demo-application-002.pdf', repeat('2',64)),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'DEMO-APP-2026-003', 'demo-application-003.pdf', repeat('3',64)),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'DEMO-APP-2026-004', 'demo-application-004.pdf', repeat('4',64)),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'DEMO-APP-2026-005', 'demo-application-005.pdf', repeat('5',64))
) as v(document_id, application_number, file_name, sha256)
join public.applications a on a.application_number = v.application_number
on conflict (id) do nothing;

insert into public.extracted_fields (application_id, document_id, field_key, field_value, page, bbox, confidence, extractor)
select a.id, d.id, 'institution_name', to_jsonb(i.name), 1, '[0.12,0.18,0.74,0.23]'::jsonb, 0.9900, 'synthetic-seed'
from public.applications a
join public.institutions i on i.id = a.institution_id
join public.documents d on d.application_id = a.id
where a.application_number like 'DEMO-APP-2026-%'
on conflict (document_id, field_key, page) do nothing;

insert into public.extracted_fields (application_id, document_id, field_key, field_value, page, bbox, confidence, extractor)
select a.id, d.id, 'valid_until', to_jsonb(v.valid_until), 1,
  '[0.10,0.54,0.36,0.57]'::jsonb, 0.9700, 'synthetic-seed'
from (values
  ('DEMO-APP-2026-001', to_char(current_date - interval '26 days', 'YYYY-MM-DD')),
  ('DEMO-APP-2026-002', to_char(current_date + interval '36 days', 'YYYY-MM-DD')),
  ('DEMO-APP-2026-003', to_char(current_date + interval '309 days', 'YYYY-MM-DD')),
  ('DEMO-APP-2026-004', to_char(current_date - interval '11 days', 'YYYY-MM-DD')),
  ('DEMO-APP-2026-005', to_char(current_date + interval '446 days', 'YYYY-MM-DD'))
) as v(application_number, valid_until)
join public.applications a on a.application_number = v.application_number
join public.documents d on d.application_id = a.id
on conflict (document_id, field_key, page) do nothing;

insert into public.claims (application_id, document_id, field_key, claim_value, source)
select a.id, d.id, 'institution_name', to_jsonb(i.name), 'synthetic-seed'
from public.applications a
join public.institutions i on i.id = a.institution_id
join public.documents d on d.application_id = a.id
where a.application_number like 'DEMO-APP-2026-%'
on conflict (application_id, document_id, field_key, source) do nothing;

insert into public.findings (finding_id, application_id, type, severity, document, evidence, rule_id, reason, confidence, status)
select v.finding_id, a.id, 'document_completeness', v.severity::public.finding_severity,
  jsonb_build_object('document_id', d.id, 'name', d.file_name),
  jsonb_build_object('page', 1, 'bbox', null, 'extracted', v.reason),
  'DEMO-DOC-001', v.reason, 0.75, 'open'
from (values
  ('40000000-0000-4000-8000-000000000001'::uuid, 'DEMO-APP-2026-001', 'info', 'Synthetic sample indicator requiring human verification.'),
  ('40000000-0000-4000-8000-000000000002'::uuid, 'DEMO-APP-2026-002', 'medium', 'A synthetic sample document has a field that needs human verification.'),
  ('40000000-0000-4000-8000-000000000003'::uuid, 'DEMO-APP-2026-003', 'high', 'A synthetic sample document has a high-priority indicator requiring human verification.'),
  ('40000000-0000-4000-8000-000000000004'::uuid, 'DEMO-APP-2026-004', 'critical', 'A synthetic sample document has a critical-priority indicator requiring human verification.'),
  ('40000000-0000-4000-8000-000000000005'::uuid, 'DEMO-APP-2026-005', 'info', 'Synthetic sample indicator requiring human verification.')
) as v(finding_id, application_number, severity, reason)
join public.applications a on a.application_number = v.application_number
join public.documents d on d.application_id = a.id
on conflict (finding_id) do update set
  severity = excluded.severity,
  reason = excluded.reason,
  evidence = excluded.evidence,
  status = 'open';
