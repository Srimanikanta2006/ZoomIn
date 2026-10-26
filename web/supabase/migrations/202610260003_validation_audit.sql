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

create type public.claim_ledger_status as enum ('Supported', 'Contradicted', 'Unsupported', 'Expired');
alter table public.claims
  add column status public.claim_ledger_status,
  add column evidence_fields jsonb not null default '[]'::jsonb,
  add column finding_id uuid references public.findings(finding_id) on delete set null;
