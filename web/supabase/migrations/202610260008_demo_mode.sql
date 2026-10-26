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
