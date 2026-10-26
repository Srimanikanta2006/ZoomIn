-- Applicant draft, upload, and submission persistence.
alter type public.document_type add value if not exists 'affidavit';
alter type public.document_type add value if not exists 'fire_noc';
alter type public.document_type add value if not exists 'lease';
alter type public.document_type add value if not exists 'accreditation_letter';
alter type public.document_type add value if not exists 'structural_certificate';
alter type public.document_type add value if not exists 'ter_receipt';

update public.profiles p
set institution_id = i.id
from auth.users u, public.institutions i
where u.id = p.id
  and u.email = 'applicant@institution.edu'
  and i.institution_code = 'DEMO-INST-001'
  and p.role = 'institution'
  and p.institution_id is null;

create policy "Applicants upload documents to their own applications"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'application-documents'
    and public.can_access_application(
      nullif(split_part(name, '/', 1), '')::uuid
    )
    and exists (
      select 1
      from public.applications a
      join public.profiles p on p.id = (select auth.uid())
      where a.id = nullif(split_part(name, '/', 1), '')::uuid
        and a.institution_id = p.institution_id
        and p.role = 'institution'
        and a.status in ('draft', 'returned_for_clarification')
    )
  );

create or replace function public.create_applicant_draft(
  p_application_type text,
  p_academic_year text
) returns public.applications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_institution_id uuid;
  v_application public.applications;
begin
  select institution_id into v_institution_id
  from public.profiles
  where id = v_actor and role = 'institution';
  if v_actor is null or v_institution_id is null then
    raise exception 'Applicant account with an institution is required';
  end if;
  if length(trim(coalesce(p_application_type, ''))) = 0 then
    raise exception 'Application type is required';
  end if;
  if p_academic_year !~ '^20[0-9]{2}-[0-9]{2}$' then
    raise exception 'Academic year is invalid';
  end if;

  insert into public.applications (
    institution_id, application_number, application_type, academic_year
  ) values (
    v_institution_id,
    'PF-' || replace(p_academic_year, '-', '') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    p_application_type,
    p_academic_year
  ) returning * into v_application;

  perform public.write_audit_log(
    'application.draft_created', 'application', v_application.id::text,
    jsonb_build_object('application_type', p_application_type, 'academic_year', p_academic_year)
  );
  return v_application;
end;
$$;
revoke all on function public.create_applicant_draft(text, text) from public, anon;
grant execute on function public.create_applicant_draft(text, text) to authenticated;

create or replace function public.register_applicant_document(
  p_application_id uuid,
  p_document_type text,
  p_file_name text,
  p_storage_path text,
  p_sha256 text,
  p_mime_type text,
  p_page_count integer,
  p_metadata jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_document_id uuid;
begin
  if not exists (
    select 1 from public.profiles p
    join public.applications a on a.institution_id = p.institution_id
    where p.id = v_actor and p.role = 'institution'
      and a.id = p_application_id
      and a.status in ('draft', 'returned_for_clarification')
  ) then
    raise exception 'Applicant access to an editable application is required';
  end if;
  if p_document_type not in (
    'application_form', 'land_record', 'building_plan', 'faculty_record', 'other',
    'affidavit', 'fire_noc', 'lease', 'accreditation_letter',
    'structural_certificate', 'ter_receipt'
  ) then
    raise exception 'Unsupported document type';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' or p_page_count is null or p_page_count < 1
     or p_mime_type <> 'application/pdf' or length(trim(coalesce(p_file_name, ''))) = 0 then
    raise exception 'Document metadata is invalid';
  end if;
  if p_storage_path !~ ('^' || p_application_id::text || '/[0-9a-f-]+\.pdf$') then
    raise exception 'Document storage path is invalid';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'application-documents' and o.name = p_storage_path
  ) then
    raise exception 'Uploaded document could not be found';
  end if;

  insert into public.documents (
    application_id, document_type, file_name, storage_path, sha256,
    mime_type, page_count, metadata
  ) values (
    p_application_id, p_document_type::public.document_type, p_file_name,
    p_storage_path, p_sha256, p_mime_type, p_page_count, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_document_id;

  perform public.write_audit_log(
    'application.document_uploaded', 'document', v_document_id::text,
    jsonb_build_object('application_id', p_application_id, 'document_type', p_document_type, 'sha256', p_sha256)
  );
  return v_document_id;
end;
$$;
revoke all on function public.register_applicant_document(uuid, text, text, text, text, text, integer, jsonb) from public, anon;
grant execute on function public.register_applicant_document(uuid, text, text, text, text, text, integer, jsonb) to authenticated;

create or replace function public.submit_applicant_application(
  p_application_id uuid,
  p_required_document_types text[]
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_application public.applications;
  v_missing text[];
begin
  select a.* into v_application
  from public.applications a
  join public.profiles p on p.institution_id = a.institution_id
  where a.id = p_application_id and p.id = v_actor and p.role = 'institution'
  for update;
  if not found then raise exception 'Applicant access denied'; end if;
  if v_application.status not in ('draft', 'returned_for_clarification') then
    raise exception 'Application cannot be submitted in its current status';
  end if;
  if coalesce(cardinality(p_required_document_types), 0) = 0 then
    raise exception 'Required document checklist is empty';
  end if;

  select array_agg(required.document_type) into v_missing
  from unnest(p_required_document_types) as required(document_type)
  where not exists (
    select 1 from public.documents d
    where d.application_id = p_application_id
      and d.document_type::text = required.document_type
      and d.metadata #>> '{precheck,blocker}' = 'false'
      and not exists (
        select 1 from public.documents newer
        where newer.application_id = d.application_id
          and newer.document_type = d.document_type
          and (newer.uploaded_at, newer.id) > (d.uploaded_at, d.id)
      )
  );
  if coalesce(cardinality(v_missing), 0) > 0 then
    raise exception 'Required documents are missing or have unresolved pre-check blockers';
  end if;

  update public.applications
  set status = 'submitted', submitted_at = now(), updated_at = now()
  where id = p_application_id;
  perform public.write_audit_log(
    'application.submitted', 'application', p_application_id::text,
    jsonb_build_object('document_count', cardinality(p_required_document_types))
  );
  return 'submitted';
end;
$$;
revoke all on function public.submit_applicant_application(uuid, text[]) from public, anon;
grant execute on function public.submit_applicant_application(uuid, text[]) to authenticated;
