-- ─────────────────────────────────────────────────────────────────────────────
-- Employee role-based access enforcement (RLS) — defense in depth.
--
-- ⚠️  DO NOT APPLY TO PRODUCTION before running the inspection query in
--     docs/rls-inspection.sql and confirming no conflicting policies exist.
--
-- Architecture this relies on:
--   • Frontend READS go through the anon Supabase client (supabase.from(...)),
--     so the `authenticated` role is what these policies govern.
--   • Frontend WRITES go through the hadas-api edge function with the
--     SERVICE ROLE key, which BYPASSES RLS — so create/update/delete are
--     unaffected by everything below.
--   • EXCEPTION: alerts mark-read / resolve / delete run via the anon client
--     (src/hooks/useAlerts.ts), so the alerts policy below is FOR ALL and is
--     scoped to managers (employees lose alerts access entirely).
--
-- Role source of truth: public.allowed_users (email -> role). 'employee' = employee,
-- anything else (e.g. 'manager') = manager. Mirrors src/hooks/useAuth.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: current caller's role. SECURITY DEFINER so the lookup against
-- allowed_users is not itself subject to RLS (avoids recursion / lockout).
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.allowed_users where email = auth.email() limit 1
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- ── Manager-only READ: payments, vendor_statements ───────────────────────────
alter table public.payments          enable row level security;
alter table public.vendor_statements enable row level security;

drop policy if exists "managers read payments" on public.payments;
create policy "managers read payments" on public.payments
  for select to authenticated
  using (public.current_user_role() = 'manager');

drop policy if exists "managers read vendor_statements" on public.vendor_statements;
create policy "managers read vendor_statements" on public.vendor_statements
  for select to authenticated
  using (public.current_user_role() = 'manager');

-- ── alerts: manager-only for ALL ops; remove the permissive using(true) policy ─
alter table public.alerts enable row level security;
drop policy if exists "service role full access" on public.alerts;
drop policy if exists "managers manage alerts"    on public.alerts;
create policy "managers manage alerts" on public.alerts
  for all to authenticated
  using      (public.current_user_role() = 'manager')
  with check (public.current_user_role() = 'manager');

-- ── Allowed-user READ: suppliers, invoices, delivery_notes, returns, employees ─
-- Any signed-in user that exists in allowed_users (manager OR employee) may read.
do $$
declare t text;
begin
  foreach t in array array['suppliers','invoices','delivery_notes','returns','employees']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "allowed users read %1$s" on public.%1$I', t);
    execute format(
      'create policy "allowed users read %1$s" on public.%1$I '
      || 'for select to authenticated using (public.current_user_role() is not null)',
      t);
  end loop;
end $$;

-- ── allowed_users: self-read only, so useAuth (queries own email) keeps working ─
alter table public.allowed_users enable row level security;
drop policy if exists "users read own allowed_users row" on public.allowed_users;
create policy "users read own allowed_users row" on public.allowed_users
  for select to authenticated
  using (email = auth.email());
