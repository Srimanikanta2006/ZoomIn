-- Store each source check separately from the human verification decision.
alter table public.verifications
  add column source text,
  add column checked_at timestamptz,
  add column result jsonb not null default '{}'::jsonb,
  add column requires_manual_review boolean not null default true;

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
