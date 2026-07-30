// Date display helpers.
//
// Israeli dates are DAY-FIRST (`DD/MM/YYYY`) — never the US month-first form.
// See CLAUDE.md and `docs/04-BUSINESS-LOGIC.md`.
//
// `isoToDisplay` used to exist as FIVE separate copies in two different shapes.
// The unguarded shape (`const [y, m, d] = iso.split('-')`) turns an empty string
// into the literal text "undefined/undefined/" and mangles a full timestamp into
// "03T10:00:00/05/2026". This is the guarded shape, and it is now the only one.

/** ISO `YYYY-MM-DD` (or a full timestamp) → `DD/MM/YYYY`. */
export function isoToDisplay(iso: string): string {
  if (!iso) return ''
  // Tolerate a full timestamp — `2026-05-03T10:00:00` must not leak the time
  // into the day field.
  const parts = iso.split('T')[0].split('-')
  // Anything that isn't three ISO parts is passed through untouched rather than
  // rendered as "undefined/..." — a value already in DD/MM/YYYY stays as it is.
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}
