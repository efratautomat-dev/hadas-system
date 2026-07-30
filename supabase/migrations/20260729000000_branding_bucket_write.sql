-- ─────────────────────────────────────────────────────────────────────────────
-- "branding" storage bucket + write policy
--
-- WHY
-- Two features write here and BOTH are broken on dev today, for the same reason:
-- the bucket was never created. PROD-MIGRATION-CHECKLIST.sql §6 says so outright
-- ("branding was never created on dev either, which is why logo upload is
-- dev-broken"). It was a manual checklist step that nothing enforced.
--
--   1. Settings → system logo        (storage.from('branding'), public URL)
--   2. Settings → ייצוא לביזיבוקס    (bizbox-template.xlsx — the export template)
--
-- The Bizibox export fills Bizibox's own template rather than imitating it, and
-- Bizibox revises that template, so the owner must be able to upload a new one
-- without a deploy. That upload needs this bucket to exist AND to be writable.
--
-- The bucket is PUBLIC because the logo is served by public URL. The template is
-- read back with download(), which works either way.
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do update set public = true;

-- Write access for signed-in users.
--
-- SCOPE NOTE: this grants write to any authenticated user, not managers only.
-- Both writers live behind Settings, which employees cannot reach (App.tsx routes
-- them to EmployeeDashboard), so the UI boundary holds today — but this is a UI
-- boundary, not a data one, and it is the weaker of the two. Tightening it means
-- routing the upload through hadas-api with the service-role key, the pattern
-- every other write in the app already uses. Tracked in 07-OPEN-ISSUES.
drop policy if exists "authenticated write branding" on storage.objects;
create policy "authenticated write branding" on storage.objects
  for all to authenticated
  using      (bucket_id = 'branding')
  with check (bucket_id = 'branding');

-- Public read: the logo is embedded by public URL, so anonymous reads must work.
drop policy if exists "public read branding" on storage.objects;
create policy "public read branding" on storage.objects
  for select to public
  using (bucket_id = 'branding');
