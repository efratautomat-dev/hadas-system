import { DEMO_MODE } from './demo'

// ── What "today" is, for anything that counts days ───────────────────────────
//
// The home screen measures age — "stuck 9 days", "value date tomorrow" — and an
// age is only as honest as the today it is measured from. In the live system that
// is the calendar. In the demo it cannot be: the whole dataset is a fixed story set
// in June 2026, so measured against the real date every open delivery would read
// "stuck 120 days" and no payment would ever fall due this week. The demo would
// then be demonstrating a business that stopped working in the summer.
//
// So the demo carries its own today: a few days after the newest row in its seed,
// which is when the story is "happening". One constant, one place — a screen that
// computes an age imports `todayIso()` from here rather than calling `new Date()`.

const DEMO_TODAY = '2026-06-17'

/** Today as YYYY-MM-DD, local time. */
export function todayIso(): string {
  if (DEMO_MODE) return DEMO_TODAY
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Whole days from `fromIso` to `toIso`, by calendar date. Either side may be a
 * full timestamp — only the date part is read, so a row that came in at 23:50
 * yesterday is one day old, not zero. Null when either side is not a date.
 */
export function daysBetween(fromIso: string | null | undefined, toIso: string): number | null {
  const a = (fromIso ?? '').slice(0, 10)
  const b = toIso.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null
  const ms = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
           - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  return Math.round(ms / 86_400_000)
}

/** DD/MM — the short form a chip has room for. */
export function shortDate(iso: string | null | undefined): string {
  const s = (iso ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  return `${s.slice(8, 10)}/${s.slice(5, 7)}`
}
