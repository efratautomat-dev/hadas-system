-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0 — Inspect CURRENT RLS state BEFORE applying 20260604120000_employee_rls.sql
-- Run this in the Supabase SQL editor (or psql) and review the output.
-- It is read-only; it changes nothing.
-- ─────────────────────────────────────────────────────────────────────────────

-- (a) Which tables currently have RLS enabled?
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in (
    'payments', 'alerts', 'vendor_statements',
    'suppliers', 'invoices', 'delivery_notes', 'returns',
    'employees', 'allowed_users'
  )
order by tablename;

-- (b) Every policy that already exists in the public schema.
--     cmd = command it applies to; roles = who it targets;
--     qual = USING expression; with_check = WITH CHECK expression.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- Expected (from migration history): only `alerts` has rls_enabled = true,
-- with a single permissive "service role full access" USING (true) policy.
-- If you see OTHER policies on these tables, paste the output back so the
-- migration can be adjusted to preserve existing manager access.
