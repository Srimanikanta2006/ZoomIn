-- Application data model. Human review remains the decision authority.
create type public.application_status as enum (
  'draft', 'submitted', 'under_review', 'returned_for_clarification', 'completed'
);
create type public.document_type as enum (
  'application_form', 'land_record', 'building_plan', 'faculty_record', 'other'
);
create type public.verification_status as enum (
  'not_started', 'in_progress', 'verified', 'discrepancy', 'inconclusive', 'unable_to_verify'
);
create type public.finding_severity as enum ('info', 'low', 'medium', 'high', 'critical');
create type public.finding_status as enum ('open', 'under_review', 'resolved', 'dismissed');
create type public.review_action as enum ('accept', 'dismiss', 'request');

create table public.institutions (
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
  add column institution_id uuid references public.institutions(id) on delete restrict;

create table public.applications (
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

create table public.documents (
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
create index documents_application_id_idx on public.documents(application_id);
create index documents_sha256_idx on public.documents(sha256);

create table public.extracted_fields (
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

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  field_key text not null,
  claim_value jsonb not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique (application_id, document_id, field_key, source)
);

create table public.findings (
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
create index findings_application_id_idx on public.findings(application_id);

create table public.verifications (
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

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  finding_id uuid references public.findings(finding_id) on delete set null,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  action public.review_action not null,
  remarks text not null check (length(trim(remarks)) > 0),
  created_at timestamptz not null default now()
);

create table public.graph_edges (
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
create index graph_edges_application_id_idx on public.graph_edges(application_id);
create index graph_edges_source_idx on public.graph_edges(source_type, source_id);
create index graph_edges_target_idx on public.graph_edges(target_type, target_id);

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

create policy "Institution members and officers read institutions" on public.institutions
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.institution_id = institutions.id)
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('scrutiny_officer', 'regional_officer', 'admin'))
  );
create policy "Assigned roles read applications" on public.applications
  for select to authenticated using (public.can_access_application(id));

create policy "Assigned roles read documents" on public.documents
  for select to authenticated using (public.can_access_application(application_id));
create policy "Assigned roles read extracted fields" on public.extracted_fields
  for select to authenticated using (public.can_access_application(application_id));
create policy "Assigned roles read claims" on public.claims
  for select to authenticated using (public.can_access_application(application_id));
create policy "Assigned roles read findings" on public.findings
  for select to authenticated using (public.can_access_application(application_id));
create policy "Assigned roles read verifications" on public.verifications
  for select to authenticated using (public.can_access_application(application_id));
create policy "Assigned roles read reviews" on public.reviews
  for select to authenticated using (public.can_access_application(application_id));
create policy "Assigned roles read graph edges" on public.graph_edges
  for select to authenticated using (public.can_access_application(application_id));

grant select on public.institutions, public.applications, public.documents,
  public.extracted_fields, public.claims, public.findings, public.verifications,
  public.reviews, public.graph_edges to authenticated;
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

create trigger institutions_audit after insert or update or delete on public.institutions
  for each row execute function public.audit_row_change();
create trigger applications_audit after insert or update or delete on public.applications
  for each row execute function public.audit_row_change();
create trigger documents_audit after insert or update or delete on public.documents
  for each row execute function public.audit_row_change();
create trigger extracted_fields_audit after insert or update or delete on public.extracted_fields
  for each row execute function public.audit_row_change();
create trigger claims_audit after insert or update or delete on public.claims
  for each row execute function public.audit_row_change();
create trigger findings_audit after insert or update or delete on public.findings
  for each row execute function public.audit_row_change();
create trigger verifications_audit after insert or update or delete on public.verifications
  for each row execute function public.audit_row_change();
create trigger reviews_audit after insert or update or delete on public.reviews
  for each row execute function public.audit_row_change();
create trigger graph_edges_audit after insert or update or delete on public.graph_edges
  for each row execute function public.audit_row_change();

create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();
