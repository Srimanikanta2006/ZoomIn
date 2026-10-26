-- Core roles and immutable, hash-chained audit log.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.preflight_role as enum (
  'institution',
  'scrutiny_officer',
  'regional_officer',
  'admin'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.preflight_role not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create policy "Users can read their own role"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create table public.audit_log (
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
