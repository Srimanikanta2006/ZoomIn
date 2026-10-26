import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "web" / "supabase" / "migrations"
SEED_FILE = ROOT / "web" / "supabase" / "seed.sql"
OUTPUT_FILE = ROOT / "web" / "supabase" / "complete_setup.sql"

migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

sql_parts = []

for mf in migration_files:
    content = mf.read_text(encoding="utf-8")
    sql_parts.append(f"-- ==========================================\n-- Migration: {mf.name}\n-- ==========================================\n")
    sql_parts.append(content)
    sql_parts.append("\n\n")

if SEED_FILE.is_file():
    sql_parts.append("-- ==========================================\n-- Seed Demo Data\n-- ==========================================\n")
    sql_parts.append(SEED_FILE.read_text(encoding="utf-8"))
    sql_parts.append("\n\n")

full_sql = "".join(sql_parts)

# 1. Transform `create type public.X as enum (...)` -> `do $$ begin create type public.X ... exception when duplicate_object then null; end $$;`
enum_pattern = re.compile(
    r"create\s+type\s+public\.([a-z0-9_]+)\s+as\s+enum\s*\((.*?)\);",
    re.DOTALL | re.IGNORECASE
)

def enum_replacer(match):
    name = match.group(1)
    values = match.group(2).strip()
    return f"""do $$ begin
  create type public.{name} as enum (
{values}
  );
exception when duplicate_object then null;
end $$;"""

full_sql = enum_pattern.sub(enum_replacer, full_sql)

# 2. Transform `create table public.X` -> `create table if not exists public.X`
full_sql = re.sub(
    r"create\s+table\s+public\.",
    "create table if not exists public.",
    full_sql,
    flags=re.IGNORECASE
)

# 2b. Transform `add column X` -> `add column if not exists X`
full_sql = re.sub(
    r"\badd\s+column\s+(?!if\s+not\s+exists\b)",
    "add column if not exists ",
    full_sql,
    flags=re.IGNORECASE
)

# 3. Transform `create index X` -> `create index if not exists X`
full_sql = re.sub(
    r"create\s+index\s+([a-z0-9_]+)\s+on",
    r"create index if not exists \1 on",
    full_sql,
    flags=re.IGNORECASE
)

# 4. Transform `create trigger X ... on public.Y` -> `drop trigger if exists X on public.Y;\ncreate trigger X ... on public.Y`
trigger_pattern = re.compile(
    r"(create\s+trigger\s+([a-z0-9_]+)\s+.*?on\s+public\.([a-z0-9_]+))",
    re.IGNORECASE
)
full_sql = trigger_pattern.sub(
    r"drop trigger if exists \2 on public.\3;\n\1",
    full_sql
)

# 5. Transform `create policy "X" on public.Y` -> `drop policy if exists "X" on public.Y;\ncreate policy "X" on public.Y`
policy_pattern = re.compile(
    r'(create\s+policy\s+"([^"]+)"\s+on\s+public\.([a-z0-9_]+))',
    re.IGNORECASE
)
full_sql = policy_pattern.sub(
    r'drop policy if exists "\2" on public.\3;\n\1',
    full_sql
)

# 6. Append safe profile provisioning trigger
extra_setup = """
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
"""

full_sql += extra_setup

OUTPUT_FILE.write_text(full_sql, encoding="utf-8")
print(f"Generated idempotent setup script at {OUTPUT_FILE} ({len(full_sql)} bytes)")
