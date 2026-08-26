// ─── DEMO GATE — the front door of the public demo build ─────────────────────
// One password to get in, then a role (manager / employee) that decides which UI
// the visitor lands on. Both live in sessionStorage, so closing the tab ends the
// session and the next visitor sees the door again.
//
// ⚠️ THIS IS NOT SECURITY, AND MUST NEVER BE TREATED AS SUCH.
// The password is compiled into the JavaScript that is served to the browser —
// anyone who opens devtools can read it. It is a doorbell, not a lock: it stops
// a passer-by from wandering in, and that is all it is for.
//
// That is acceptable here for exactly one reason: there is nothing behind the
// door. The standalone build has no Supabase credentials, no API key and no
// network path to any real system; every row it shows comes from demo-seed.json
// and is fictitious. The worst case of a leaked password is that someone sees the
// same demo we hand out on purpose.
//
// When real access control is needed (a private preview, a named client, anything
// that must be auditable) the answer is NOT to make this file cleverer — obfuscating
// a client-side password buys nothing. Put the protection in front of the origin:
// Cloudflare Access (free tier, email-verified, no code change) or Basic Auth on
// the container. Both are written up in docs/08-DEMO-DEPLOYMENT.md.

export type DemoRole = 'manager' | 'employee'
export type DemoTier = 'basic' | 'advanced' | 'custom'

const UNLOCK_KEY = 'hadas-demo-unlocked'
const ROLE_KEY = 'hadas-demo-role'
const TIER_KEY = 'hadas-demo-tier'

// One password per product tier. Which password the visitor was given IS which
// tier they see — deliberately, instead of letting them pick at the door: a
// prospect who can choose will always choose the top level, and the point of the
// three demos is to show each person the one that fits them.
//
// The tier is therefore NOT offered as a control anywhere in the UI. The role
// switcher is, because manager-vs-employee is something to explore within a tier.
const TIER_PASSWORDS: { tier: DemoTier; password: string }[] = [
  { tier: 'basic',    password: import.meta.env.VITE_DEMO_PASSWORD_BASIC ?? '' },
  { tier: 'advanced', password: import.meta.env.VITE_DEMO_PASSWORD_ADVANCED ?? '' },
  { tier: 'custom',   password: import.meta.env.VITE_DEMO_PASSWORD ?? '' },
]

/** Session storage is unavailable in some privacy modes — never let that crash the app. */
function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* ignore — the gate simply re-asks on the next page load */
  }
}

export function isUnlocked(): boolean {
  return safeGet(UNLOCK_KEY) === 'true'
}

/**
 * Checks the typed password against every tier and, on success, records the
 * unlock, the tier that password belongs to, and the chosen role. Returns false
 * on a wrong password without touching stored state.
 */
export function unlock(password: string, role: DemoRole): boolean {
  // An empty configured password must never match an empty box.
  const hit = TIER_PASSWORDS.find((t) => t.password && password === t.password)
  if (!hit) return false

  safeSet(UNLOCK_KEY, 'true')
  safeSet(TIER_KEY, hit.tier)
  setDemoRole(role)
  return true
}

/**
 * The product tier this session unlocked. Read by src/lib/tiers.ts, which is what
 * every screen, tile and alert actually consults.
 *
 * Falls back to `basic` — the LEAST it could be. A storage read that fails should
 * not hand a visitor the full product; the demo showing too little is a question
 * they will ask, showing too much is a promise nobody meant to make.
 */
export function getDemoTier(): DemoTier {
  const v = safeGet(TIER_KEY)
  return v === 'advanced' || v === 'custom' ? v : 'basic'
}

/**
 * The role the demo visitor is currently browsing as. Read by the demo Supabase
 * client when the app asks `allowed_users` who this user is (see demoClient.ts),
 * which is what makes App.tsx route to the employee dashboard or the full Layout.
 * Defaults to manager so the local `?demo=1` walkthrough is unaffected.
 */
export function getDemoRole(): DemoRole {
  return safeGet(ROLE_KEY) === 'employee' ? 'employee' : 'manager'
}

export function setDemoRole(role: DemoRole): void {
  safeSet(ROLE_KEY, role)
}

export const ROLE_LABEL: Record<DemoRole, string> = {
  manager: 'מנהלת',
  employee: 'עובדת',
}
