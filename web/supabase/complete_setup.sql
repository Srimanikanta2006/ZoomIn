-- ==========================================
-- Migration: 202610260001_core_auth_audit.sql
-- ==========================================
-- Core roles and immutable, hash-chained audit log.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.preflight_role as enum (
'institution',
  'scrutiny_officer',
  'regional_officer',
  'admin'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.preflight_role not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

drop policy if exists "Users can read their own role" on public.profiles;
create policy "Users can read their own role"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  occurred_at timestamptz not null,
  details jsonb not null default '{}'::jsonb,
  prev_hash text,
  hash text not null
);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated, service_role;

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Audit log is append-only';
end;
$$;

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.prevent_audit_log_mutation();

create or replace function public.write_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_details jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id bigint;
  v_actor uuid := auth.uid();
  v_time timestamptz := clock_timestamp();
  v_prev text;
  v_hash text;
  v_payload text;
begin
  perform pg_advisory_xact_lock(74612026);
  select hash into v_prev from public.audit_log order by id desc limit 1;
  v_payload := jsonb_build_object(
    'actor_id', v_actor,
    'action', p_action,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'occurred_at', v_time,
    'details', p_details,
    'prev_hash', v_prev
  )::text;
  v_hash := encode(digest(v_payload, 'sha256'), 'hex');
  insert into public.audit_log (actor_id, action, entity_type, entity_id, occurred_at, details, prev_hash, hash)
  values (v_actor, p_action, p_entity_type, p_entity_id, v_time, p_details, v_prev, v_hash)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.write_audit_log(text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.append_audit_event(
  p_action text,
  p_details jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_action not in ('auth.login.attempt', 'auth.login.success', 'auth.logout') then
    raise exception 'Unsupported audit action';
  end if;
  if p_details is distinct from '{}'::jsonb then
    raise exception 'Authentication audit details must be empty';
  end if;
  if p_action <> 'auth.login.attempt' and auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  return public.write_audit_log(p_action, 'auth', null, p_details);
end;
$$;

grant execute on function public.append_audit_event(text, jsonb) to anon, authenticated;


-- ==========================================
-- Migration: 202610260002_application_schema.sql
-- ==========================================
-- Application data model. Human review remains the decision authority.
do $$ begin
  create type public.application_status as enum (
'draft', 'submitted', 'under_review', 'returned_for_clarification', 'completed'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.document_type as enum (
'application_form', 'land_record', 'building_plan', 'faculty_record', 'other'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.verification_status as enum (
'not_started', 'in_progress', 'verified', 'discrepancy', 'inconclusive', 'unable_to_verify'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.finding_severity as enum (
'info', 'low', 'medium', 'high', 'critical'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.finding_status as enum (
'open', 'under_review', 'resolved', 'dismissed'
  );
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.review_action as enum (
'accept', 'dismiss', 'request'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  institution_code text not null unique,
  name text not null,
  institution_type text not null,
  state text not null,
  district text not null,
  created_at timestamptz not null default now(),
  constraint institution_code_nonempty check (length(trim(institution_code)) > 0)
);

alter table public.profiles
  add column if not exists institution_id uuid references public.institutions(id) on delete restrict;

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  application_number text not null unique,
  application_type text not null,
  academic_year text not null,
  status public.application_status not null default 'draft',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_year_format check (academic_year ~ '^20[0-9]{2}-[0-9]{2}$')
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  document_type public.document_type not null,
  file_name text not null,
  storage_path text not null,
  sha256 text not null,
  mime_type text not null,
  page_count integer check (page_count is null or page_count > 0),
  uploaded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint document_sha256_format check (sha256 ~ '^[0-9a-f]{64}$')
);
create index if not exists documents_application_id_idx on public.documents(application_id);
create index if not exists documents_sha256_idx on public.documents(sha256);

create table if not exists public.extracted_fields (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  field_key text not null,
  field_value jsonb not null,
  page integer check (page is null or page > 0),
  bbox jsonb,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  extractor text not null,
  created_at timestamptz not null default now(),
  unique (document_id, field_key, page)
);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  field_key text not null,
  claim_value jsonb not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique (application_id, document_id, field_key, source)
);

create table if not exists public.findings (
  finding_id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  type text not null,
  severity public.finding_severity not null,
  document jsonb not null,
  evidence jsonb not null,
  rule_id text not null,
  reason text not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  status public.finding_status not null default 'open',
  constraint finding_evidence_shape check (
    evidence ? 'page' and evidence ? 'bbox' and evidence ? 'extracted'
  )
);
create index if not exists findings_application_id_idx on public.findings(application_id);

create table if not exists public.verifications (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  finding_id uuid references public.findings(finding_id) on delete set null,
  verification_type text not null,
  status public.verification_status not null default 'not_started',
  verifier_id uuid references auth.users(id) on delete set null,
  remarks text not null default '',
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  finding_id uuid references public.findings(finding_id) on delete set null,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  action public.review_action not null,
  remarks text not null check (length(trim(remarks)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.graph_edges (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  edge_type text not null,
  weight numeric(7,6) check (weight is null or weight between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint graph_edge_not_self check (source_type <> target_type or source_id <> target_id)
);
create index if not exists graph_edges_application_id_idx on public.graph_edges(application_id);
create index if not exists graph_edges_source_idx on public.graph_edges(source_type, source_id);
create index if not exists graph_edges_target_idx on public.graph_edges(target_type, target_id);

-- Read access is scoped to the institution linked to an institution profile;
-- scrutiny/regional officers and admins can read applications across institutions.
create or replace function public.can_access_application(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.applications a
    join public.profiles p on p.id = (select auth.uid())
    where a.id = p_application_id
      and (p.role <> 'institution' or p.institution_id = a.institution_id)
  );
$$;
revoke all on function public.can_access_application(uuid) from public, anon;
grant execute on function public.can_access_application(uuid) to authenticated;

alter table public.institutions enable row level security;
alter table public.applications enable row level security;
alter table public.documents enable row level security;
alter table public.extracted_fields enable row level security;
alter table public.claims enable row level security;
alter table public.findings enable row level security;
alter table public.verifications enable row level security;
alter table public.reviews enable row level security;
alter table public.graph_edges enable row level security;

drop policy if exists "Institution members and officers read institutions" on public.institutions;
create policy "Institution members and officers read institutions" on public.institutions
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.institution_id = institutions.id)
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('scrutiny_officer', 'regional_officer', 'admin'))
  );
drop policy if exists "Assigned roles read applications" on public.applications;
create policy "Assigned roles read applications" on public.applications
  for select to authenticated using (public.can_access_application(id));

drop policy if exists "Assigned roles read documents" on public.documents;
create policy "Assigned roles read documents" on public.documents
  for select to authenticated using (public.can_access_application(application_id));
drop policy if exists "Assigned roles read extracted fields" on public.extracted_fields;
create policy "Assigned roles read extracted fields" on public.extracted_fields
  for select to authenticated using (public.can_access_application(application_id));
drop policy if exists "Assigned roles read claims" on public.claims;
create policy "Assigned roles read claims" on public.claims
  for select to authenticated using (public.can_access_application(application_id));
drop policy if exists "Assigned roles read findings" on public.findings;
create policy "Assigned roles read findings" on public.findings
  for select to authenticated using (public.can_access_application(application_id));
drop policy if exists "Assigned roles read verifications" on public.verifications;
create policy "Assigned roles read verifications" on public.verifications
  for select to authenticated using (public.can_access_application(application_id));
drop policy if exists "Assigned roles read reviews" on public.reviews;
create policy "Assigned roles read reviews" on public.reviews
  for select to authenticated using (public.can_access_application(application_id));
drop policy if exists "Assigned roles read graph edges" on public.graph_edges;
create policy "Assigned roles read graph edges" on public.graph_edges
  for select to authenticated using (public.can_access_application(application_id));

grant select on public.institutions, public.applications, public.documents,
  public.extracted_fields, public.claims, public.findings, public.verifications,
  public.reviews, public.graph_edges to authenticated;
drop policy if exists "Admins can read audit log" on public.audit_log;
create policy "Admins can read audit log" on public.audit_log
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
grant select on public.audit_log to authenticated;
revoke insert, update, delete on public.institutions, public.applications,
  public.documents, public.extracted_fields, public.claims, public.findings,
  public.verifications, public.reviews, public.graph_edges from anon, authenticated;
grant select, insert, update, delete on public.institutions, public.applications,
  public.documents, public.extracted_fields, public.claims, public.findings,
  public.verifications, public.reviews, public.graph_edges to service_role;
grant select on public.audit_log to service_role;

-- Record every row mutation without copying row contents into the audit log.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_id text;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  v_id := coalesce(v_row ->> 'id', v_row ->> 'finding_id');
  perform public.write_audit_log(
    lower(tg_op),
    tg_table_name,
    v_id,
    jsonb_build_object('operation', lower(tg_op))
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.audit_row_change() from public, anon, authenticated;

drop trigger if exists institutions_audit on public.institutions;
create trigger institutions_audit after insert or update or delete on public.institutions
  for each row execute function public.audit_row_change();
drop trigger if exists applications_audit on public.applications;
create trigger applications_audit after insert or update or delete on public.applications
  for each row execute function public.audit_row_change();
drop trigger if exists documents_audit on public.documents;
create trigger documents_audit after insert or update or delete on public.documents
  for each row execute function public.audit_row_change();
drop trigger if exists extracted_fields_audit on public.extracted_fields;
create trigger extracted_fields_audit after insert or update or delete on public.extracted_fields
  for each row execute function public.audit_row_change();
drop trigger if exists claims_audit on public.claims;
create trigger claims_audit after insert or update or delete on public.claims
  for each row execute function public.audit_row_change();
drop trigger if exists findings_audit on public.findings;
create trigger findings_audit after insert or update or delete on public.findings
  for each row execute function public.audit_row_change();
drop trigger if exists verifications_audit on public.verifications;
create trigger verifications_audit after insert or update or delete on public.verifications
  for each row execute function public.audit_row_change();
drop trigger if exists reviews_audit on public.reviews;
create trigger reviews_audit after insert or update or delete on public.reviews
  for each row execute function public.audit_row_change();
drop trigger if exists graph_edges_audit on public.graph_edges;
create trigger graph_edges_audit after insert or update or delete on public.graph_edges
  for each row execute function public.audit_row_change();

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();


-- ==========================================
-- Migration: 202610260003_validation_audit.sql
-- ==========================================
-- Permit signed-in validation runs to append a low-detail event to the
-- existing hash chain. Claim values, names, and document contents are omitted.
create or replace function public.append_validation_audit(
  p_entity_id text,
  p_details jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  return public.write_audit_log('validation.run', 'validation', p_entity_id, p_details);
end;
$$;

revoke all on function public.append_validation_audit(text, jsonb) from public, anon;
grant execute on function public.append_validation_audit(text, jsonb) to authenticated;

do $$ begin
  create type public.claim_ledger_status as enum (
'Supported', 'Contradicted', 'Unsupported', 'Expired'
  );
exception when duplicate_object then null;
end $$;
alter table public.claims
  add column if not exists status public.claim_ledger_status,
  add column if not exists evidence_fields jsonb not null default '[]'::jsonb,
  add column if not exists finding_id uuid references public.findings(finding_id) on delete set null;


-- ==========================================
-- Migration: 202610260004_verification_checks.sql
-- ==========================================
-- Store each source check separately from the human verification decision.
alter table public.verifications
  add column if not exists source text,
  add column if not exists checked_at timestamptz,
  add column if not exists result jsonb not null default '{}'::jsonb,
  add column if not exists requires_manual_review boolean not null default true;

update public.verifications
set source = verification_type,
    checked_at = coalesce(verified_at, created_at)
where source is null or checked_at is null;

alter table public.verifications
  alter column source set not null,
  alter column checked_at set not null;

create or replace function public.append_verification_check(p_check jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_application_id uuid := (p_check ->> 'application_id')::uuid;
  v_document_id uuid := (p_check ->> 'document_id')::uuid;
  v_source text := p_check ->> 'source';
  v_checked_at timestamptz := (p_check ->> 'checked_at')::timestamptz;
  v_status public.verification_status := (p_check ->> 'status')::public.verification_status;
  v_result jsonb := coalesce(p_check -> 'result', '{}'::jsonb);
  v_manual boolean := coalesce((p_check ->> 'requires_manual_review')::boolean, true);
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if not public.can_access_application(v_application_id) then
    raise exception 'Application access denied';
  end if;
  if not exists (
    select 1 from public.documents d
    where d.id = v_document_id and d.application_id = v_application_id
  ) then
    raise exception 'Document does not belong to the application';
  end if;
  if coalesce(trim(v_source), '') = '' or v_checked_at is null then
    raise exception 'Source and check timestamp are required';
  end if;

  v_manual := v_status <> 'verified';
  insert into public.verifications (
    application_id, document_id, verification_type, source, checked_at,
    status, result, requires_manual_review, verifier_id, remarks
  ) values (
    v_application_id, v_document_id, v_source, v_source, v_checked_at,
    v_status, v_result, v_manual, v_actor,
    coalesce(v_result ->> 'reason', 'Automated source check; human review remains the decision authority.')
  ) returning id into v_id;

  perform public.write_audit_log(
    'verification.check',
    'verification',
    v_id::text,
    jsonb_build_object(
      'source', v_source,
      'checked_at', v_checked_at,
      'status', v_status,
      'result', v_result,
      'requires_manual_review', v_manual
    )
  );
  return v_id;
end;
$$;

revoke all on function public.append_verification_check(jsonb) from public, anon;
grant execute on function public.append_verification_check(jsonb) to authenticated;


-- ==========================================
-- Migration: 202610260005_graph_audit.sql
-- ==========================================
create or replace function public.append_graph_audit(p_details jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.role in ('scrutiny_officer', 'regional_officer', 'admin')
  ) then
    raise exception 'Officer role required';
  end if;
  return public.write_audit_log('graph.view', 'trust_graph', null, coalesce(p_details, '{}'::jsonb));
end;
$$;

revoke all on function public.append_graph_audit(jsonb) from public, anon;
grant execute on function public.append_graph_audit(jsonb) to authenticated;


-- ==========================================
-- Migration: 202610260006_workspace_actions.sql
-- ==========================================
create or replace function public.append_workspace_view(p_page text, p_application_id uuid default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.preflight_role;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = v_actor;
  if v_role is null then raise exception 'PreFlight role required'; end if;
  if p_page not in ('institution_portal', 'officer_lanes', 'case_file', 'validity_timeline', 'rule_studio', 'audit_page') then
    raise exception 'Unsupported workspace';
  end if;
  if p_page = 'institution_portal' and v_role not in ('institution', 'scrutiny_officer', 'regional_officer', 'admin') then
    raise exception 'Workspace access denied';
  end if;
  if p_page in ('officer_lanes', 'validity_timeline') and v_role not in ('scrutiny_officer', 'regional_officer', 'admin') then
    raise exception 'Officer role required';
  end if;
  if p_page = 'rule_studio' and v_role <> 'admin' then raise exception 'Admin role required'; end if;
  if p_page = 'audit_page' and v_role <> 'admin' then raise exception 'Admin role required'; end if;
  if p_page = 'case_file' and (p_application_id is null or not public.can_access_application(p_application_id)) then
    raise exception 'Application access denied';
  end if;
  return public.write_audit_log('workspace.view', p_page, p_application_id::text, jsonb_build_object('role', v_role));
end;
$$;
revoke all on function public.append_workspace_view(text, uuid) from public, anon;
grant execute on function public.append_workspace_view(text, uuid) to authenticated;

create or replace function public.record_finding_review(
  p_application_id uuid,
  p_finding_id uuid,
  p_action public.review_action,
  p_remarks text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.preflight_role;
  v_review_id uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = v_actor;
  if v_role is null or v_role not in ('scrutiny_officer', 'regional_officer', 'admin') then raise exception 'Officer role required'; end if;
  if not public.can_access_application(p_application_id) then raise exception 'Application access denied'; end if;
  if length(trim(coalesce(p_remarks, ''))) = 0 then raise exception 'Remarks are required'; end if;
  if not exists (select 1 from public.findings f where f.finding_id = p_finding_id and f.application_id = p_application_id) then
    raise exception 'Finding does not belong to the application';
  end if;
  insert into public.reviews (application_id, finding_id, reviewer_id, action, remarks)
  values (p_application_id, p_finding_id, v_actor, p_action, trim(p_remarks))
  returning id into v_review_id;
  update public.findings
    set status = case
      when p_action = 'accept' then 'resolved'::public.finding_status
      when p_action = 'dismiss' then 'dismissed'::public.finding_status
      else 'under_review'::public.finding_status
    end
    where finding_id = p_finding_id and application_id = p_application_id;
  perform public.write_audit_log(
    'finding.reviewed', 'finding', p_finding_id::text,
    jsonb_build_object('application_id', p_application_id, 'action', p_action)
  );
  return v_review_id;
end;
$$;
revoke all on function public.record_finding_review(uuid, uuid, public.review_action, text) from public, anon;
grant execute on function public.record_finding_review(uuid, uuid, public.review_action, text) to authenticated;

insert into storage.buckets (id, name, public)
values ('application-documents', 'application-documents', false)
on conflict (id) do nothing;

create policy "Assigned application members can read stored PDFs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'application-documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and public.can_access_application(d.application_id)
    )
  );


-- ==========================================
-- Migration: 202610260007_integrity_letters_handbook.sql
-- ==========================================
-- Integrity checks, deficiency letters, and YAML handbook rule proposals.

create or replace function public.append_workspace_view(p_page text, p_application_id uuid default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.preflight_role;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = v_actor;
  if v_role is null then raise exception 'PreFlight role required'; end if;
  if p_page not in ('institution_portal', 'officer_lanes', 'case_file', 'validity_timeline', 'rule_studio', 'audit_page', 'deficiency_letters', 'metrics_page') then raise exception 'Unsupported workspace'; end if;
  if p_page = 'institution_portal' and v_role not in ('institution', 'scrutiny_officer', 'regional_officer', 'admin') then raise exception 'Workspace access denied'; end if;
  if p_page in ('officer_lanes', 'validity_timeline', 'deficiency_letters', 'metrics_page') and v_role not in ('scrutiny_officer', 'regional_officer', 'admin') then raise exception 'Officer role required'; end if;
  if p_page in ('rule_studio', 'audit_page') and v_role <> 'admin' then raise exception 'Admin role required'; end if;
  if p_page = 'case_file' and (p_application_id is null or not public.can_access_application(p_application_id)) then raise exception 'Application access denied'; end if;
  return public.write_audit_log('workspace.view', p_page, p_application_id::text, jsonb_build_object('role', v_role));
end;
$$;
revoke all on function public.append_workspace_view(text, uuid) from public, anon;
grant execute on function public.append_workspace_view(text, uuid) to authenticated;

create table if not exists public.deficiency_letters (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  language text not null check (language in ('en', 'hi')),
  content text not null check (length(trim(content)) > 0),
  finding_ids uuid[] not null check (cardinality(finding_ids) > 0),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_remarks text not null default '',
  constraint deficiency_letter_approval_consistent check (
    (status = 'draft' and approved_by is null and approved_at is null)
    or (status = 'approved' and approved_by is not null and approved_at is not null)
  )
);
alter table public.deficiency_letters enable row level security;
drop policy if exists "Application members read deficiency letters" on public.deficiency_letters;
create policy "Application members read deficiency letters" on public.deficiency_letters
  for select to authenticated using (public.can_access_application(application_id));
grant select on public.deficiency_letters to authenticated;
revoke insert, update, delete on public.deficiency_letters from anon, authenticated;
grant select, insert, update, delete on public.deficiency_letters to service_role;

create table if not exists public.handbook_rule_proposals (
  id uuid primary key default gen_random_uuid(),
  source_sha256 text not null unique check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_redacted text not null,
  redaction_summary jsonb not null default '{}'::jsonb,
  proposed_rule_yaml text not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  constraint handbook_rule_approval_consistent check (
    (status = 'approved' and approved_by is not null and approved_at is not null)
    or (status <> 'approved' and approved_by is null and approved_at is null)
  )
);
alter table public.handbook_rule_proposals enable row level security;
drop policy if exists "Admins read handbook rule proposals" on public.handbook_rule_proposals;
create policy "Admins read handbook rule proposals" on public.handbook_rule_proposals
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );
grant select on public.handbook_rule_proposals to authenticated;
revoke insert, update, delete on public.handbook_rule_proposals from anon, authenticated;
grant select, insert, update, delete on public.handbook_rule_proposals to service_role;

create or replace function public.verify_audit_chain()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_role public.preflight_role;
  v_row record;
  v_expected_prev text := null;
  v_expected_hash text;
  v_payload text;
  v_checked bigint := 0;
  v_valid boolean := true;
  v_bad_id bigint := null;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin'::public.preflight_role then raise exception 'Admin role required'; end if;

  for v_row in
    select id, actor_id, action, entity_type, entity_id, occurred_at, details, prev_hash, hash
    from public.audit_log order by id
  loop
    v_checked := v_checked + 1;
    v_payload := jsonb_build_object(
      'actor_id', v_row.actor_id,
      'action', v_row.action,
      'entity_type', v_row.entity_type,
      'entity_id', v_row.entity_id,
      'occurred_at', v_row.occurred_at,
      'details', v_row.details,
      'prev_hash', v_row.prev_hash
    )::text;
    v_expected_hash := encode(digest(v_payload, 'sha256'), 'hex');
    if v_row.prev_hash is distinct from v_expected_prev or v_row.hash is distinct from v_expected_hash then
      v_valid := false;
      v_bad_id := v_row.id;
      exit;
    end if;
    v_expected_prev := v_row.hash;
  end loop;

  perform public.write_audit_log(
    'audit.integrity.checked', 'audit_log', coalesce(v_bad_id::text, 'chain'),
    jsonb_build_object('valid', v_valid, 'checked_count', v_checked, 'first_invalid_id', v_bad_id)
  );
  return jsonb_build_object(
    'valid', v_valid,
    'checked_count', v_checked,
    'first_invalid_id', v_bad_id,
    'checked_at', clock_timestamp()
  );
end;
$$;
revoke all on function public.verify_audit_chain() from public, anon;
grant execute on function public.verify_audit_chain() to authenticated;
alter function public.write_audit_log(text, text, text, jsonb) set timezone to 'UTC';
alter function public.verify_audit_chain() set timezone to 'UTC';

create or replace function public.create_deficiency_letter(
  p_application_id uuid,
  p_language text,
  p_content text,
  p_finding_ids uuid[]
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.preflight_role;
  v_id uuid;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role is null or v_role not in ('scrutiny_officer', 'regional_officer', 'admin') then raise exception 'Officer role required'; end if;
  if not public.can_access_application(p_application_id) then raise exception 'Application access denied'; end if;
  if p_language not in ('en', 'hi') or length(trim(coalesce(p_content, ''))) = 0 then raise exception 'Letter language and content are required'; end if;
  if cardinality(p_finding_ids) is null or cardinality(p_finding_ids) = 0 then raise exception 'At least one accepted finding is required'; end if;
  if exists (
    select 1 from unnest(p_finding_ids) as requested(finding_id)
    where not exists (
      select 1 from public.reviews r
      join public.findings f on f.finding_id = r.finding_id
      where r.application_id = p_application_id and r.finding_id = requested.finding_id
        and f.application_id = p_application_id
        and r.action = 'accept'
        and not exists (
          select 1 from public.reviews r2 where r2.application_id = p_application_id and r2.finding_id = requested.finding_id
            and (r2.created_at, r2.id) > (r.created_at, r.id)
        )
    )
  ) then raise exception 'Letters may include accepted findings only'; end if;
  insert into public.deficiency_letters (application_id, language, content, finding_ids, created_by)
  values (p_application_id, p_language, trim(p_content), p_finding_ids, v_actor)
  returning id into v_id;
  perform public.write_audit_log('deficiency_letter.created', 'deficiency_letter', v_id::text,
    jsonb_build_object('application_id', p_application_id, 'language', p_language, 'finding_count', cardinality(p_finding_ids)));
  return v_id;
end;
$$;
revoke all on function public.create_deficiency_letter(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.create_deficiency_letter(uuid, text, text, uuid[]) to authenticated;

create or replace function public.update_deficiency_letter(p_letter_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_letter public.deficiency_letters;
  v_role public.preflight_role;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('scrutiny_officer', 'regional_officer', 'admin') then raise exception 'Officer role required'; end if;
  select * into v_letter from public.deficiency_letters where id = p_letter_id for update;
  if not found or not public.can_access_application(v_letter.application_id) then raise exception 'Letter access denied'; end if;
  if v_letter.status <> 'draft' then raise exception 'Approved letters cannot be changed'; end if;
  if length(trim(coalesce(p_content, ''))) = 0 then raise exception 'Letter content is required'; end if;
  update public.deficiency_letters set content = trim(p_content), updated_at = now() where id = p_letter_id;
  perform public.write_audit_log('deficiency_letter.edited', 'deficiency_letter', p_letter_id::text,
    jsonb_build_object('application_id', v_letter.application_id, 'language', v_letter.language));
  return p_letter_id;
end;
$$;
revoke all on function public.update_deficiency_letter(uuid, text) from public, anon;
grant execute on function public.update_deficiency_letter(uuid, text) to authenticated;

create or replace function public.approve_deficiency_letter(p_letter_id uuid, p_remarks text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_letter public.deficiency_letters;
  v_actor uuid := auth.uid();
  v_role public.preflight_role;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role is null or v_role not in ('scrutiny_officer', 'regional_officer', 'admin') then raise exception 'Officer role required'; end if;
  select * into v_letter from public.deficiency_letters where id = p_letter_id for update;
  if not found or not public.can_access_application(v_letter.application_id) then raise exception 'Letter access denied'; end if;
  if v_letter.status <> 'draft' then raise exception 'Letter is not awaiting approval'; end if;
  if length(trim(coalesce(p_remarks, ''))) = 0 then raise exception 'Approval remarks are required'; end if;
  if exists (
    select 1 from unnest(v_letter.finding_ids) as requested(finding_id)
    where not exists (
      select 1 from public.reviews r where r.application_id = v_letter.application_id and r.finding_id = requested.finding_id
        and r.action = 'accept'
        and not exists (
          select 1 from public.reviews r2 where r2.application_id = v_letter.application_id and r2.finding_id = requested.finding_id
            and (r2.created_at, r2.id) > (r.created_at, r.id)
        )
    )
  ) then raise exception 'Every listed finding must have an officer acceptance'; end if;
  update public.deficiency_letters set status = 'approved', approved_by = v_actor, approved_at = now(), approval_remarks = trim(p_remarks), updated_at = now()
    where id = p_letter_id;
  perform public.write_audit_log('deficiency_letter.approved', 'deficiency_letter', p_letter_id::text,
    jsonb_build_object('application_id', v_letter.application_id, 'language', v_letter.language));
  return p_letter_id;
end;
$$;
revoke all on function public.approve_deficiency_letter(uuid, text) from public, anon;
grant execute on function public.approve_deficiency_letter(uuid, text) to authenticated;

create or replace function public.get_handbook_proposal_by_hash(p_source_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then raise exception 'Admin role required'; end if;
  return (select to_jsonb(p) from public.handbook_rule_proposals p where p.source_sha256 = p_source_sha256);
end;
$$;
revoke all on function public.get_handbook_proposal_by_hash(text) from public, anon;
grant execute on function public.get_handbook_proposal_by_hash(text) to authenticated;

create or replace function public.log_handbook_redaction(p_source_sha256 text, p_redaction_summary jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then raise exception 'Admin role required'; end if;
  if p_source_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid source hash'; end if;
  return public.write_audit_log('handbook_clause.redacted', 'handbook_rule_proposal', p_source_sha256,
    jsonb_build_object('redactions', coalesce(p_redaction_summary, '{}'::jsonb)));
end;
$$;
revoke all on function public.log_handbook_redaction(text, jsonb) from public, anon;
grant execute on function public.log_handbook_redaction(text, jsonb) to authenticated;

create or replace function public.save_handbook_proposal(
  p_source_sha256 text,
  p_source_redacted text,
  p_redaction_summary jsonb,
  p_rule_yaml text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_existing public.handbook_rule_proposals;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then raise exception 'Admin role required'; end if;
  if p_source_sha256 !~ '^[0-9a-f]{64}$' or length(trim(p_source_redacted)) = 0 or length(trim(p_rule_yaml)) = 0 then raise exception 'Invalid proposal'; end if;
  insert into public.handbook_rule_proposals (source_sha256, source_redacted, redaction_summary, proposed_rule_yaml, created_by)
    values (p_source_sha256, p_source_redacted, coalesce(p_redaction_summary, '{}'::jsonb), p_rule_yaml, auth.uid())
    on conflict (source_sha256) do nothing returning id into v_id;
  if v_id is null then
    select * into v_existing from public.handbook_rule_proposals where source_sha256 = p_source_sha256;
    return to_jsonb(v_existing);
  end if;
  perform public.write_audit_log('handbook_rule.proposed', 'handbook_rule_proposal', v_id::text,
    jsonb_build_object('source_sha256', p_source_sha256, 'redactions', coalesce(p_redaction_summary, '{}'::jsonb)));
  return (select to_jsonb(p) from public.handbook_rule_proposals p where id = v_id);
end;
$$;
revoke all on function public.save_handbook_proposal(text, text, jsonb, text) from public, anon;
grant execute on function public.save_handbook_proposal(text, text, jsonb, text) to authenticated;

create or replace function public.approve_handbook_rule_proposal(p_proposal_id uuid, p_rule_yaml text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.handbook_rule_proposals;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then raise exception 'Admin role required'; end if;
  select * into v_row from public.handbook_rule_proposals where id = p_proposal_id for update;
  if not found then raise exception 'Proposal not found'; end if;
  if v_row.status <> 'proposed' then raise exception 'Proposal is not awaiting approval'; end if;
  if length(trim(coalesce(p_rule_yaml, ''))) = 0 then raise exception 'Rule YAML is required'; end if;
  update public.handbook_rule_proposals set proposed_rule_yaml = trim(p_rule_yaml), status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_proposal_id;
  perform public.write_audit_log('handbook_rule.approved', 'handbook_rule_proposal', p_proposal_id::text,
    jsonb_build_object('source_sha256', v_row.source_sha256));
  return (select to_jsonb(p) from public.handbook_rule_proposals p where id = p_proposal_id);
end;
$$;
revoke all on function public.approve_handbook_rule_proposal(uuid, text) from public, anon;
grant execute on function public.approve_handbook_rule_proposal(uuid, text) to authenticated;

create or replace function public.get_approved_handbook_rules()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return coalesce((select jsonb_agg(proposed_rule_yaml order by approved_at, id) from public.handbook_rule_proposals where status = 'approved'), '[]'::jsonb);
end;
$$;
revoke all on function public.get_approved_handbook_rules() from public, anon;
grant execute on function public.get_approved_handbook_rules() to authenticated;


-- ==========================================
-- Migration: 202610260008_demo_mode.sql
-- ==========================================
-- Admin controls for restoring the five synthetic demo applications.
create or replace function public.append_demo_action(p_action text, p_details jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.preflight_role;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = v_actor;
  if v_role is distinct from 'admin' then raise exception 'Admin role required'; end if;
  if p_action not in ('demo.issuer_outage') then raise exception 'Unsupported demo action'; end if;
  return public.write_audit_log(p_action, 'demo', null, coalesce(p_details, '{}'::jsonb));
end;
$$;
revoke all on function public.append_demo_action(text, jsonb) from public, anon;
grant execute on function public.append_demo_action(text, jsonb) to authenticated;

create or replace function public.reset_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.preflight_role;
  v_app_ids uuid[];
  v_review_count integer;
  v_verification_count integer;
  v_letter_count integer;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select role into v_role from public.profiles where id = v_actor;
  if v_role is distinct from 'admin' then raise exception 'Admin role required'; end if;
  select array_agg(id) into v_app_ids from public.applications
    where application_number in ('DEMO-APP-2026-001','DEMO-APP-2026-002','DEMO-APP-2026-003','DEMO-APP-2026-004','DEMO-APP-2026-005');
  if coalesce(cardinality(v_app_ids), 0) <> 5 then raise exception 'Demo seed is incomplete; run web/supabase/seed.sql first'; end if;

  delete from public.reviews where application_id = any(v_app_ids);
  get diagnostics v_review_count = row_count;
  delete from public.verifications where application_id = any(v_app_ids);
  get diagnostics v_verification_count = row_count;
  delete from public.deficiency_letters where application_id = any(v_app_ids);
  get diagnostics v_letter_count = row_count;
  update public.findings set status = 'open' where application_id = any(v_app_ids);
  update public.applications set status = 'submitted', updated_at = now() where id = any(v_app_ids);
  perform public.write_audit_log('demo.reset', 'demo', null, jsonb_build_object(
    'application_count', 5, 'reviews_removed', v_review_count,
    'verifications_removed', v_verification_count, 'letters_removed', v_letter_count
  ));
  return jsonb_build_object('applications_reset', 5, 'reviews_removed', v_review_count,
    'verifications_removed', v_verification_count, 'letters_removed', v_letter_count);
end;
$$;
revoke all on function public.reset_demo_data() from public, anon;
grant execute on function public.reset_demo_data() to authenticated;


-- ==========================================
-- Migration: 202610260009_applicant_uploads.sql
-- ==========================================
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


-- ==========================================
-- Migration: 202610260010_case_actions.sql
-- ==========================================
alter table public.applications
  add column if not exists assigned_officer uuid references public.profiles(id) on delete set null;

create or replace function public.assign_case_to_me(p_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.preflight_role;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role is null or v_role not in ('scrutiny_officer', 'regional_officer', 'admin') then
    raise exception 'Officer role required';
  end if;
  if not public.can_access_application(p_application_id) then
    raise exception 'Application access denied';
  end if;
  update public.applications set assigned_officer = v_actor, updated_at = now()
  where id = p_application_id;
  if not found then raise exception 'Application not found'; end if;
  perform public.write_audit_log(
    'case.assigned_to_me', 'application', p_application_id::text,
    jsonb_build_object('assigned_officer', v_actor)
  );
  return v_actor;
end;
$$;
revoke all on function public.assign_case_to_me(uuid) from public, anon;
grant execute on function public.assign_case_to_me(uuid) to authenticated;

create or replace function public.record_case_outcome(
  p_application_id uuid,
  p_outcome text,
  p_remarks text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.preflight_role;
  v_status public.application_status;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role is null or v_role not in ('scrutiny_officer', 'regional_officer', 'admin') then
    raise exception 'Officer role required';
  end if;
  if not public.can_access_application(p_application_id) then
    raise exception 'Application access denied';
  end if;
  if length(trim(coalesce(p_remarks, ''))) = 0 then raise exception 'Outcome remarks are required'; end if;
  v_status := case p_outcome
    when 'clear' then 'completed'::public.application_status
    when 'return_for_clarification' then 'returned_for_clarification'::public.application_status
    when 'refer_for_inspection' then 'under_review'::public.application_status
    else null
  end;
  if v_status is null then raise exception 'Unsupported case outcome'; end if;
  update public.applications
  set status = v_status, updated_at = now()
  where id = p_application_id;
  if not found then raise exception 'Application not found'; end if;
  perform public.write_audit_log(
    'case.outcome.' || p_outcome, 'application', p_application_id::text,
    jsonb_build_object('remarks', trim(p_remarks), 'status', v_status)
  );
  return v_status::text;
end;
$$;
revoke all on function public.record_case_outcome(uuid, text, text) from public, anon;
grant execute on function public.record_case_outcome(uuid, text, text) to authenticated;

create or replace function public.get_case_history(p_application_id uuid)
returns setof public.audit_log
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.preflight_role;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('scrutiny_officer', 'regional_officer', 'admin') then
    raise exception 'Officer role required';
  end if;
  if not public.can_access_application(p_application_id) then
    raise exception 'Application access denied';
  end if;
  return query
    select recent.*
    from (
      select entry.*
      from public.audit_log entry
      where entry.entity_id = p_application_id::text
         or entry.details->>'application_id' = p_application_id::text
      order by entry.id desc
      limit 100
    ) recent
    order by recent.id;
end;
$$;
revoke all on function public.get_case_history(uuid) from public, anon;
grant execute on function public.get_case_history(uuid) to authenticated;

create or replace function public.log_case_report_export(p_application_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.preflight_role;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('institution', 'scrutiny_officer', 'regional_officer', 'admin') then
    raise exception 'Workspace role required';
  end if;
  if not public.can_access_application(p_application_id) then raise exception 'Application access denied'; end if;
  return public.write_audit_log(
    'case.report.exported', 'application', p_application_id::text,
    jsonb_build_object('format', 'print-to-pdf')
  );
end;
$$;
revoke all on function public.log_case_report_export(uuid) from public, anon;
grant execute on function public.log_case_report_export(uuid) to authenticated;


-- ==========================================
-- Seed Demo Data
-- ==========================================
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



-- ==========================================
-- Automatic User Profile Role Provisioning
-- ==========================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'institution'::public.preflight_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create users through Supabase Auth (Dashboard or Auth Admin API). Never
-- write directly to auth.users or auth.identities. Roles other than the
-- default institution role must be assigned by a trusted administrator.
