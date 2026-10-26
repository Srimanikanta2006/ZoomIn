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

create table public.deficiency_letters (
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
create policy "Application members read deficiency letters" on public.deficiency_letters
  for select to authenticated using (public.can_access_application(application_id));
grant select on public.deficiency_letters to authenticated;
revoke insert, update, delete on public.deficiency_letters from anon, authenticated;
grant select, insert, update, delete on public.deficiency_letters to service_role;

create table public.handbook_rule_proposals (
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
