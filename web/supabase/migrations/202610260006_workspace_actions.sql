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
