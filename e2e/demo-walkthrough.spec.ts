import { test, expect, type Locator } from '@playwright/test'

/**
 * Marketing walkthrough — records a smooth ~60s tour of the Hadas supplier
 * management system running in DEMO MODE (100% fictitious data, no real
 * Supabase). Video is recorded via the `video: 'on'` setting in
 * playwright.config.ts and lands under `test-results/`.
 *
 * Tour order:
 *   a. Dashboard overview (alert count)
 *   b. Suppliers list → open a supplier card
 *   c. Invoices → open one invoice (extracted fields)
 *   d. Alerts → click the duplicate alert (side-by-side compare)
 *   e. Returns → the one with a matched credit note
 *   f. Open a document (PDF) preview
 */
test('Hadas marketing walkthrough (demo mode)', async ({ page }) => {
  test.setTimeout(120_000)

  const pause = (ms: number) => page.waitForTimeout(ms)

  // Cinematic, deliberate mouse glide to an element before interacting with it.
  const glideTo = async (loc: Locator) => {
    await loc.scrollIntoViewIfNeeded().catch(() => {})
    const box = await loc.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 })
    }
    await pause(500)
  }

  const sidebar = page.locator('aside')
  const main = page.getByRole('main')
  const heading = (name: string) => main.getByRole('heading', { name, exact: true })
  const navTo = async (name: RegExp) => {
    const btn = sidebar.getByRole('button', { name })
    await glideTo(btn)
    await btn.click()
    await pause(1200)
  }

  // ── Enter demo mode ────────────────────────────────────────────────────────
  await page.goto('/?demo=1')

  // ── a. Dashboard overview + alert count ────────────────────────────────────
  await expect(sidebar).toBeVisible()
  await expect(page.getByText('ספקים פעילים')).toBeVisible()
  await pause(1500)
  // Linger on the unread-alerts badge (red "4") next to the bell.
  await glideTo(sidebar.getByRole('button', { name: /התראות/ }))
  await pause(1800)

  // ── b. Suppliers list → open a supplier card ───────────────────────────────
  await navTo(/ספקים/)
  await expect(heading('ספקים')).toBeVisible()
  await pause(1500)
  const detailsBtn = page.getByRole('button', { name: 'פרטים' }).first()
  await glideTo(detailsBtn)
  await detailsBtn.click()
  await expect(heading('פרטי קשר')).toBeVisible()
  await pause(2200)

  // ── c. Invoices → open one invoice (number / date / amount / category) ──────
  await navTo(/חשבוניות/)
  await expect(heading('חשבוניות')).toBeVisible()
  await pause(1500)
  const invoiceRow = page.getByText('טקסטיל הגליל בע"מ').first()
  await glideTo(invoiceRow)
  await invoiceRow.click()
  await expect(heading('פרטי חשבונית')).toBeVisible()
  await pause(2500)

  // ── d. Alerts → click the duplicate alert (side-by-side comparison) ─────────
  await navTo(/התראות/)
  await expect(heading('התראות מערכת')).toBeVisible()
  await pause(1500)
  const dupAlert = page.getByText('נקלטה פעמיים')
  await glideTo(dupAlert)
  await dupAlert.click()
  await expect(heading('השוואת חשבוניות כפולות')).toBeVisible()
  await pause(3000)
  // Dismiss the comparison overlay (click the backdrop, away from the dialog).
  await page.mouse.click(40, 360)
  await pause(1000)

  // ── e. Returns → the one with a matched credit note ────────────────────────
  await navTo(/חזרות/)
  await expect(heading('חזרות וזיכויים')).toBeVisible()
  await pause(1500)
  const creditNote = page.getByText('Z-3391')
  await glideTo(creditNote)
  await pause(2500)

  // ── f. Open a document (PDF) preview ───────────────────────────────────────
  await navTo(/חשבוניות/)
  const invoiceRow2 = page.getByText('טקסטיל הגליל בע"מ').first()
  await glideTo(invoiceRow2)
  await invoiceRow2.click()
  const previewBtn = page.getByRole('button', { name: 'צפייה במסמך' })
  await glideTo(previewBtn)
  await previewBtn.click()
  await expect(heading('תצוגה מקדימה')).toBeVisible()
  await expect(page.locator('iframe[title="PDF preview"]')).toBeVisible()
  await pause(3500)
})
