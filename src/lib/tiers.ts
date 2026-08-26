// ─── PRODUCT TIERS ───────────────────────────────────────────────────────────
// The system is sold at three levels, and a customer sees only the one they
// bought. This file is the single definition of what each level contains —
// screens, dashboard tiles and alerts all derive from the lists below, so moving
// a feature between tiers is one edit here and nothing else.
//
// Deliberately NOT a demo-only concept. The public demo is the first consumer
// (a password at the door picks which tier the visitor browses), but the same
// catalogue is what a real per-customer entitlement would read. Building it as a
// demo trick would mean building it twice.
//
// Until customers carry a tier of their own, `currentTier()` answers `custom`
// outside the demo — i.e. the live system keeps showing everything it shows
// today. Nothing about the production build changes because this file exists.
//
// Tiers are CUMULATIVE by construction: each level spreads the one below it
// rather than repeating its list, so a feature can never fall out of a higher
// tier by an editing slip.

import { DEMO_STANDALONE } from './demo'
import { getDemoTier } from './demoGate'

export type Tier = 'basic' | 'advanced' | 'custom'

// ── what each level unlocks ──────────────────────────────────────────────────

// Documents arrive from the mailbox, get filed, and can be found. The floor the
// product stands on — every tier has it.
const BASIC_PAGES = [
  'dashboard',
  'capture',
  'alerts',
  'suppliers',
  'invoices',
  'invoices-duplicates', // same screen, reached from the duplicate alert
  'settings',
]

// The money picture: what is owed, what was paid, what came back — and the
// supplier's own statement measured against ours.
const ADVANCED_PAGES = [
  ...BASIC_PAGES,
  'ledger',
  'payments',
  'deliveries',
  'returns',
  'reconciliation',
]

// Where the system meets the customer's other systems, plus the work of fitting
// it to them. This tier sells adaptation, not screens.
const CUSTOM_PAGES = [
  ...ADVANCED_PAGES,
  'system-logs',
  // Sales-facing overview of the connection points this tier sells — demo only.
  // In a system somebody already bought, an integration is either configured or
  // it is not; a page listing what they could buy has no place inside the tool.
  ...(DEMO_STANDALONE ? ['integrations'] : []),
]

export interface TierDef {
  id: Tier
  label: string
  tagline: string
  pages: string[]
}

export const TIERS: Record<Tier, TierDef> = {
  basic: {
    id: 'basic',
    label: 'בסיסי',
    tagline: 'החשבוניות נכנסות לבד מהמייל, מסודרות ונגישות',
    pages: BASIC_PAGES,
  },
  advanced: {
    id: 'advanced',
    label: 'מתקדם',
    tagline: 'התמונה הכספית המלאה — והכרטסת של הספק מול שלך',
    pages: ADVANCED_PAGES,
  },
  custom: {
    id: 'custom',
    label: 'מותאם',
    tagline: 'המערכת מדברת עם המערכות האחרות שלך, ומותאמת אלייך',
    pages: CUSTOM_PAGES,
  },
}

export const TIER_ORDER: Tier[] = ['basic', 'advanced', 'custom']

/**
 * The tier the current viewer is browsing.
 *
 * Only the STANDALONE demo is tiered, because only it has a door that establishes
 * which tier the visitor was invited to. The local `?demo=1` walkthrough and the
 * Playwright run have no door and must keep seeing the whole product — as does
 * production, which has no per-customer entitlement yet.
 */
export function currentTier(): Tier {
  return DEMO_STANDALONE ? getDemoTier() : 'custom'
}

/**
 * Does the viewer's tier include the integration layer — the connections to other
 * systems, and the bespoke fitting that comes with them?
 *
 * A named question rather than a page lookup, because the answer gates things that
 * are not pages: the Bizibox export tab inside Settings is one of them.
 */
export function tierAllowsIntegrations(tier: Tier = currentTier()): boolean {
  return tier === 'custom'
}

/** Is this screen part of the viewer's tier? */
export function tierAllows(page: string, tier: Tier = currentTier()): boolean {
  return TIERS[tier].pages.includes(page)
}

// ── alerts ───────────────────────────────────────────────────────────────────
// An alert belongs to the feature it is about: a statement mismatch has nothing
// to say to someone whose tier has no statement reconciliation, and showing it
// would advertise a screen they cannot open.
//
// Types absent from this map stay VISIBLE. Hiding a warning we failed to
// classify is the worse of the two mistakes — an unexplained alert is a question,
// a missing one is a problem nobody knows about.
const ALERT_PAGE: Record<string, string> = {
  invoice_duplicate:       'invoices',
  duplicate_invoice:       'invoices',
  invoice_old_date:        'invoices',
  invoice_link_failed:     'invoices',
  supplier_incomplete:     'suppliers',
  supplier_details_review: 'suppliers',
  unmatched_credit_note:   'returns',
  statement_mismatch:      'reconciliation',
  statement_save_failed:   'reconciliation',
}

export function tierAllowsAlert(type: string | null | undefined, tier: Tier = currentTier()): boolean {
  const page = type ? ALERT_PAGE[type] : undefined
  return page ? tierAllows(page, tier) : true
}
