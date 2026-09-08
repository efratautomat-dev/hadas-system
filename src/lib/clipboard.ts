// ── Copy to the clipboard, everywhere the app runs ───────────────────────────
//
// `navigator.clipboard` is the right API and it is not always there: it exists
// only in a secure context (https, localhost, and the Capacitor WebView), and it
// can still reject — a browser that has not granted permission, or a call that
// did not come from a real click. The old `execCommand('copy')` path works in
// exactly the cases the new one does not, so both are kept and tried in order.
//
// Returns whether it worked, because a copy button that says "הועתק" over an
// empty clipboard is worse than one that says nothing: the next thing she does is
// paste into a supplier's email and send it.

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Blocked or unavailable — the fallback below is exactly for this.
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    // Off-screen but focusable. `display:none` cannot be selected, and a visible
    // box would flash on the page for the length of the copy.
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
