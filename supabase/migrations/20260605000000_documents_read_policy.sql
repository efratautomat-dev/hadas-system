-- ─────────────────────────────────────────────────────────────────────────────
-- Allow signed-in users to READ objects in the private "documents" bucket, so the
-- frontend can mint signed URLs via supabase.storage.from('documents')
-- .createSignedUrl(path, …) to view stored statements / invoices / etc.
--
-- ⚠️  REQUIRED for the "צפה בקובץ" button on the statements page to work — without
--     a SELECT policy, createSignedUrl() returns an error for the authenticated
--     role (the bucket is private; only service_role can read by default).
--
-- RLS is already enabled on storage.objects by Supabase; we only add the policy.
--
-- NOTE: this grants any authenticated user read access to ALL documents (invoices,
-- delivery notes, returns, statements). When the employee-RLS migration
-- (20260604120000_employee_rls.sql) is applied, revisit this if document access
-- should be scoped by role/folder — today only managers reach these screens.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "authenticated read documents bucket" on storage.objects;
create policy "authenticated read documents bucket"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'documents');
