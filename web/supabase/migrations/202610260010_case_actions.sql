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
