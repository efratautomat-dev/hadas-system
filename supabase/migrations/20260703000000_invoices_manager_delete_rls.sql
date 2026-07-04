-- Allow MANAGERS to delete invoices via the anon/authenticated client.
--
-- Why: writes normally go through the hadas-api edge function (service role,
-- bypasses RLS). When that function is unavailable (e.g. a dev project where it
-- isn't deployed), the duplicate-resolution flow falls back to a direct
-- `supabase.from('invoices').delete()` from the browser — which RLS otherwise
-- blocks (invoices only had a SELECT policy). This adds the missing manager-only
-- DELETE policy so that fallback works. Employees still cannot delete invoices.
--
-- Mirrors the role model in 20260604120000_employee_rls.sql (public.current_user_role()).

alter table public.invoices enable row level security;

drop policy if exists "managers delete invoices" on public.invoices;
create policy "managers delete invoices" on public.invoices
  for delete to authenticated
  using (public.current_user_role() = 'manager');
