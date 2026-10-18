import { useEffect } from 'react'
import { notifyAll } from './dataBus'

// ── The screen refreshes itself ──────────────────────────────────────────────
//
// `dataBus` already answers "something changed — read again", but only for a
// write made in THIS browser. An order opened on the tablet at the counter, an
// invoice that just landed from the mail, a payment the manager recorded on her
// phone — none of them reached a screen already open, so the honest answer to
// "why don't I see it?" was F5. The owner's words: *"כל הזמנה או שינוי קטן צריך
// לרענן כדי לראות וזה חופר."*
//
// This is the other half of the wire: the same `notify` the writes use, fired on
// a timer. No new fetching code, no sockets, no per-screen polling — thirteen
// hooks already know how to reload themselves.
//
// Three rules it keeps, and each one exists because of how the system is used:
//
//   · **Nothing happens while the tab is hidden.** A tablet left on the counter
//     all day would otherwise run queries into an empty room. The interval is
//     stopped, not skipped, so a backgrounded tab costs nothing.
//   · **Coming back to the tab refreshes immediately.** Returning to a screen
//     after ten minutes away is exactly when stale data misleads, and waiting out
//     the remainder of a tick there is the one case where the timer feels broken.
//   · **A tick is skipped while she is typing.** Every form holds its own state,
//     so a reload cannot eat a keystroke — but a list re-sorting under a cursor
//     mid-sentence reads as a glitch, and the next tick is a minute away.

/** How often, while the tab is open and in front. */
export const AUTO_REFRESH_MS = 60_000

/** Returning to the tab refreshes at once — unless it just did. */
const MIN_GAP_MS = 20_000

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Start the periodic refresh for as long as the component is mounted.
 *
 * Called once, from `<App>`, and deliberately not per screen: two of these
 * running means two reloads a minute, and every screen reloads anyway because
 * they all listen on the same bus.
 */
export function useAutoRefresh(enabled = true): void {
  useEffect(() => {
    if (!enabled) return

    let timer: ReturnType<typeof setInterval> | null = null
    let last = Date.now()

    const tick = () => {
      if (document.visibilityState !== 'visible') return
      if (isTyping()) return
      last = Date.now()
      notifyAll()
    }

    const start = () => {
      if (timer !== null) return
      timer = setInterval(tick, AUTO_REFRESH_MS)
    }
    const stop = () => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        stop()
        return
      }
      start()
      if (Date.now() - last >= MIN_GAP_MS) tick()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    // A desktop window switched away from without the tab changing stays
    // `visible`; `focus` is what catches coming back to it.
    window.addEventListener('focus', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [enabled])
}
