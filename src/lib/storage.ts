import { supabase } from './supabase'

// Opens a stored document. A value in the private "documents" bucket is a PATH
// (e.g. "statements/2026/06/foo.pdf"), so we mint a short-lived signed URL on
// demand and open it in a new tab. A full http(s) link (e.g. a Drive link) is
// opened directly. NOTE: signing requires an authenticated read policy on the
// bucket — see migration 20260605000000_documents_read_policy.sql.
// Shared by the statements page and the alerts routing.
export async function openStoredFile(pathOrUrl: string | null | undefined) {
  if (!pathOrUrl) return
  if (/^https?:\/\//i.test(pathOrUrl)) {
    window.open(pathOrUrl, '_blank', 'noopener')
    return
  }
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(pathOrUrl, 120)
  if (error || !data?.signedUrl) {
    console.error('[storage] createSignedUrl failed:', error)
    alert('לא ניתן לפתוח את הקובץ כעת')
    return
  }
  window.open(data.signedUrl, '_blank', 'noopener')
}
