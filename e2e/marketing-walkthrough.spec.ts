import { test, expect } from '@playwright/test'

// ── Marketing walkthrough ────────────────────────────────────────────────────
// Five sentences, in order, each with the screen that proves it:
//
//   1. כל חשבונית נכנסת לבד            — invoices → one invoice → its notes
//   2. כל ספק מתועד                    — suppliers → one supplier → its notes
//   3. כל תשלום בשליטה                 — payments → add a payment
//   4. הגיעה סחורה, פשוט מצלמת מהנייד  — capture → goods tracking → orders
//   5. ואם משהו לא ברור, המערכת עוצרת  — alerts → an alert → its decision popup
//      בלי ניחושים ובלי טעויות          — statement reconciliation
//
// Runs against the STANDALONE demo build, which carries the `incontrol` name and
// logo instead of the client's (.env.demo → src/brand.config.ts). That is not a
// detail: a video recorded on the dev server shows "הדס" and the Hadas wordmark,
// which must not appear in anything shown outside the business.
//
//   npm run build:demo
//   npx playwright test --config=playwright.marketing.config.ts
//
// Every name, number and document on screen is fictitious and no Supabase project
// is contacted. Video lands in test-results/.
//
// Paced deliberately: `beat()` holds each state long enough to read. This is a
// recording, not a test — it asserts only enough to fail loudly if a screen it
// is meant to film never appeared, so a silent black frame is impossible.

const HOLD = 1400          // how long a finished state stays on screen
const STEP = 550           // between two actions inside one beat

type Page = import('@playwright/test').Page

const beat = (page: Page, ms = HOLD) => page.waitForTimeout(ms)

// Navigation goes through the SIDEBAR, never a bare role lookup. Several screens
// carry their own tab strip with the same words — a supplier card has a
// "תשלומים · 1" tab — and a page-wide lookup picks whichever is first in the DOM,
// which is how this run stalled on an invisible one.
// A RegExp where the item carries a count badge: the alerts button's accessible
// name is "התראות 6", so an exact match never resolves.
const nav = async (page: Page, label: string | RegExp) => {
  const byName = typeof label === 'string'
    ? { name: label, exact: true as const }
    : { name: label }
  await page.locator('aside').getByRole('button', byName).first().click()
}

test('marketing walkthrough', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')

  // ── The door ───────────────────────────────────────────────────────────────
  // The standalone demo asks for a password, and the password IS the product tier
  // the visitor sees. `advanced` is the level this walkthrough shows: the money
  // picture and the goods chain, without the integrations page that only exists
  // to sell the tier above it.
  const gate = page.getByLabel('סיסמת כניסה')
  if (await gate.isVisible({ timeout: 20_000 }).catch(() => false)) {
    await gate.fill(process.env.DEMO_PASSWORD ?? 'INCONTROL-PRO')
    await beat(page, STEP)
    await page.keyboard.press('Enter')
  }

  await expect(page.locator('aside').getByRole('button', { name: 'ספקים', exact: true })).toBeVisible({ timeout: 20_000 })
  await beat(page)

  // ── 1 · כל חשבונית נכנסת לבד ───────────────────────────────────────────────
  await nav(page, 'חשבוניות')
  await expect(page.getByRole('heading', { name: 'חשבוניות' }).first()).toBeVisible()
  await beat(page)

  // Into a single invoice — the one carrying the demo note, so the scroll below
  // lands on something written rather than an empty box.
  await page.getByText('טקסטיל הגליל בע"מ').first().click()
  await beat(page, STEP)
  await page.mouse.wheel(0, 900)
  await beat(page)
  await page.mouse.wheel(0, 900)
  await beat(page)

  // ── 2 · כל ספק מתועד ──────────────────────────────────────────────────────
  await nav(page, 'ספקים')
  await beat(page)
  await page.getByRole('button', { name: 'פרטים' }).first().click()
  await beat(page, STEP)
  await page.mouse.wheel(0, 700)
  await beat(page)

  // ── 3 · כל תשלום בשליטה ───────────────────────────────────────────────────
  await nav(page, 'תשלומים')
  await beat(page)
  // The add-payment form is a card that starts collapsed; "הצג" opens it.
  const showForm = page.getByRole('button', { name: 'הצג', exact: true }).first()
  if (await showForm.isVisible().catch(() => false)) {
    await showForm.click()
    await beat(page, HOLD + 400)
  }

  // ── 4 · הגיעה סחורה — פשוט מצלמת מהנייד ───────────────────────────────────
  await nav(page, 'צילום מסמך')
  await beat(page)
  await nav(page, 'מעקב הזמנות וסחורה')
  await expect(page.getByRole('button', { name: /^סחורה/ })).toBeVisible({ timeout: 15_000 })
  await beat(page)          // the pipeline strip, ticked, across the list
  await page.mouse.wheel(0, 400)
  await beat(page)
  await page.getByRole('button', { name: /^הזמנות/ }).first().click()
  await beat(page)          // the orders board — what is on its way
  await page.mouse.wheel(0, 0)

  // ── 5 · ואם משהו לא ברור, המערכת עוצרת ────────────────────────────────────
  await nav(page, /^התראות/)
  // The screen prints no heading of its own — Layout puts the page title in the
  // top bar. Waiting on an alert card is both the honest check and the thing the
  // next click needs.
  await expect(page.getByText('נקלטה פעמיים').first()).toBeVisible({ timeout: 15_000 })
  await beat(page)
  // The duplicate alert opens the side-by-side comparison: the same invoice twice,
  // with the difference called out. That IS "the system stops and asks for a look".
  await page.getByText('נקלטה פעמיים').first().click()
  await beat(page, HOLD + 800)
  // The comparison popup closes on a backdrop click, not on Escape — same gesture
  // the original walkthrough used. Without it the overlay blocks the sidebar and
  // the next navigation never lands.
  await page.mouse.click(40, 360)
  await beat(page, STEP)

  // ── בלי ניחושים ובלי טעויות ───────────────────────────────────────────────
  await nav(page, 'התאמת כרטסות')
  await beat(page, HOLD + 600)
})
