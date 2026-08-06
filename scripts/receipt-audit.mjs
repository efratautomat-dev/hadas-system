#!/usr/bin/env node
// receipt-audit — which rows in `invoices` are actually RECEIPTS?
//
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  READ-ONLY. This script never writes. It SELECTs and prints a worklist.      ║
// ║  It deletes nothing, flags nothing, changes no balance. YOU decide per row.  ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
//
// Why it exists — owner's rule, 2026-08-05: a קבלה is proof that a payment was
// made. It is not a tax document, and the invoice it confirms already exists (or
// will). A receipt sitting in `invoices` is therefore a PHANTOM invoice: it
// inflates what the supplier appears to be owed, and it double-counts against the
// real invoice.
//
// Ingest now refuses receipts at the door. This script is about the ones that got
// in BEFORE that — it cannot un-ingest them, only find them.
//
// ── How it decides, and why it cannot be certain ──────────────────────────────
// The document itself is not in the database; only the text extracted from it is.
// So this matches on the text fields that would carry the word — the email
// subject, `invoice_type`, the invoice number and the line items — and then
// EXCLUDES the combined document.
//
//   ⚠️ "חשבונית מס קבלה" IS A VALID TAX INVOICE and must stay.
//   It is extremely common in Israel and it contains the word קבלה, so a naive
//   search for קבלה would tell you to delete real invoices. Every exclusion
//   spelling is listed in COMBINED below.
//
// This is a HEURISTIC over text, not a verdict. It is deliberately biased toward
// showing you too much: every hit prints its document link so you can open the
// document and decide. Do not act on a row you have not looked at.
//
// ── Running it ────────────────────────────────────────────────────────────────
//
//   node scripts/receipt-audit.mjs
//   node scripts/receipt-audit.mjs --json
//
// Environment — same contract as scripts/statement-drift-report.mjs:
//
//   SUPABASE_URL           or VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY      — read access is all it needs
//   HADAS_REPORT_EMAIL / HADAS_REPORT_PASSWORD       — optional manager login
//
// ⚠️ Refuses a service-role key on purpose: it bypasses RLS and can write, which
// is exactly what a read-only audit must not be able to do.

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { receiptMatches } from './lib/receiptRule.mjs'
import { connect } from './lib/connect.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const asJson = process.argv.includes('--json')

// Credentials, project-match verification and sign-in all live in lib/connect.mjs
// — shared with the other reports, because a copy of this had a precedence bug
// that silently used the TEST key against the PRODUCTION url.
const { read, projectRef, signedIn, email } = await connect(ROOT, 'receipt-audit')

// The rule lives in scripts/lib/receiptRule.mjs — shared with data-health so the
// two reports can never disagree about what a receipt is.

const rows = await read('invoices_v',
  'id, supplier_id, supplier_name, invoice_number, invoice_date, total_amount, ' +
  'email_subject, invoice_type, line_items, is_duplicate, has_error, ' +
  'drive_file_link, storage_url, message_link, created_at')
const all = rows ?? []
if (all.length === 0) {
  console.log('No invoices were returned.')
  if (!signedIn) {
    console.log(
      '\n⚠️  No manager login was supplied. If RLS restricts `invoices`, an anonymous read\n' +
      '   returns zero rows whether or not any exist. Set HADAS_REPORT_EMAIL /\n' +
      '   HADAS_REPORT_PASSWORD and re-run before treating this as "nothing found".',
    )
    process.exit(2)
  }
  process.exit(0)
}

const hits = []
for (const r of all) {
  const matched = receiptMatches(r)
  if (matched.length) hits.push({ row: r, matched })
}

// Rows already excluded from the balance (duplicate/errored) are called out
// separately: they are ALREADY not counted, so they are not costing anything.
const counted = hits.filter(h => !h.row.is_duplicate && !h.row.has_error)
const already = hits.filter(h => h.row.is_duplicate || h.row.has_error)

if (asJson) {
  console.log(JSON.stringify({
    scanned: all.length,
    hits: hits.map(h => ({ ...h.row, matchedFields: h.matched })),
    countedTotal: counted.reduce((s, h) => s + Number(h.row.total_amount ?? 0), 0),
  }, null, 2))
  process.exit(hits.length ? 3 : 0)
}

const money = n => '₪' + Number(n ?? 0).toLocaleString('he-IL')
const pad = (s, n) => String(s ?? '').padEnd(n)

console.log('')
console.log(`  receipt-audit — ${projectRef} — scanned ${all.length} invoice row(s).`)
console.log('')

if (hits.length === 0) {
  console.log('  No row matched. Nothing that reads like a receipt is sitting in `invoices`.')
  console.log('')
  console.log('  Note this is a text heuristic: a receipt whose extracted text never contains')
  console.log('  the word קבלה would not be found here. A clean result is good news, not proof.')
  console.log('')
  process.exit(0)
}

console.log(`  ${counted.length} row(s) look like RECEIPTS and are currently COUNTED in the supplier balance:`)
console.log('')
console.log('  ' + pad('ID', 16) + pad('ספק', 24) + pad('מסמך', 14) + pad('תאריך', 12) +
            pad('סכום', 12) + 'נמצא ב')
console.log('  ' + '─'.repeat(96))
for (const { row, matched } of counted) {
  console.log('  ' + pad(row.id, 16) + pad(String(row.supplier_name ?? '').slice(0, 22), 24) +
              pad(row.invoice_number, 14) + pad(String(row.invoice_date ?? '').slice(0, 10), 12) +
              pad(money(row.total_amount), 12) + matched.join(' · '))
  const link = row.drive_file_link || row.message_link || row.storage_url
  if (link) console.log('  ' + ' '.repeat(16) + '↳ ' + link)
}

const total = counted.reduce((s, h) => s + Number(h.row.total_amount ?? 0), 0)
console.log('')
console.log(`  Together these inflate supplier balances by ${money(total)}.`)

if (already.length) {
  console.log('')
  console.log(`  ${already.length} more matched but are ALREADY excluded from the balance`)
  console.log('  (flagged duplicate/errored), so they are not costing anything today:')
  for (const { row } of already) {
    console.log(`    ${pad(row.id, 16)}${pad(String(row.supplier_name ?? '').slice(0, 22), 24)}${money(row.total_amount)}`)
  }
}

console.log('')
console.log('  ── What to do with them ────────────────────────────────────────────────')
console.log('')
console.log('  OPEN EACH DOCUMENT FIRST. "חשבונית מס קבלה" is a real tax invoice and is')
console.log('  excluded above, but no text rule is perfect — confirm before acting.')
console.log('')
console.log('  Then prefer MARKING over DELETING. Setting `has_error = true` removes the')
console.log('  row from every balance while keeping it visible and auditable — the same')
console.log('  "shown but not counted" rule the ledger already applies to duplicates')
console.log('  (spec/06-RULES.md §9). Deleting destroys the record of what arrived, and')
console.log('  the Drive/Storage file is orphaned rather than removed.')
console.log('')
console.log('  Either way the change is yours to make, in the app or in PROD SQL.')
console.log('  This script will not do it for you.')
console.log('')
process.exit(3)
