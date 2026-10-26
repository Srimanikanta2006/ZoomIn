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
