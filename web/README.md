# PreFlight web

Next.js App Router frontend with Supabase password login. Copy the repository `.env.example` values into `web/.env.local`; set the Supabase URL and anon key, then run `npm install` and `npm run dev` from `web/`.

Run `supabase start` and `supabase db reset` from `web/` to apply migrations and load five synthetic sample applications. Apply the migrations with `supabase db push` for a linked project; run `supabase/seed.sql` separately only when you want demo data in that project. The setup SQL creates no Auth users. The app reads the server-managed `app_metadata.role` claim first, then the user's own row in `profiles`. Valid roles are institution, scrutiny_officer, regional_officer, and admin. Never assign roles from `user_metadata` or a client-side form. Authentication attempts, successful sign-ins, sign-outs, and domain table mutations are appended to the hash-chained `audit_log` table; audit entries do not copy row contents.

### Provision synthetic demo logins

When `NEXT_PUBLIC_DEMO_MODE=true`, the sign-in page offers these synthetic accounts (password `password123`):

- Admin: `admin@preflight.org`
- Scrutiny officer: `officer@preflight.gov`
- Applicant: `applicant@institution.edu`

Create each user through Supabase **Authentication > Users**. Confirm the email and set the demo password there; never insert into `auth.users` or `auth.identities`. Then run the matching role statement in the SQL Editor:

```sql
insert into public.profiles (id, role)
select id, 'admin'::public.preflight_role
from auth.users where email = 'admin@preflight.org'
on conflict (id) do update set role = excluded.role;

insert into public.profiles (id, role)
select id, 'scrutiny_officer'::public.preflight_role
from auth.users where email = 'officer@preflight.gov'
on conflict (id) do update set role = excluded.role;

insert into public.profiles (id, role)
select id, 'institution'::public.preflight_role
from auth.users where email = 'applicant@institution.edu'
on conflict (id) do update set role = excluded.role;

update public.profiles p
set institution_id = i.id
from auth.users u, public.institutions i
where p.id = u.id
  and u.email = 'applicant@institution.edu'
  and i.institution_code = 'DEMO-INST-001';
```

If an older demo account returns `Database error querying schema`, delete only that affected Auth user in the Dashboard, recreate it there, and re-run its profile statement. Do not repair Auth records with SQL. Assign production roles only through trusted administrator tooling; never use the synthetic password outside the demo environment.

The web app calls `NEXT_PUBLIC_API_URL/health` on load. Set the API's `WEB_ORIGIN` to the exact deployed web origin.

TypeScript database models live in `src/lib/models.ts`; the corresponding Pydantic models live in `../api/models.py`.
