#!/usr/bin/env node
// statement-drift-report — WHICH `matched` statements are no longer matched?
//
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  READ-ONLY. This script never writes. It issues SELECTs and prints a report. ║
// ║  It changes no status, resolves no alert, updates no balance. The output is  ║
// ║  a WORKLIST FOR A HUMAN — decide each row yourself, in the app.              ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
//
// Why it exists — docs/07-OPEN-ISSUES.md item 3b, spec/06-RULES.md §9:
//
//   `vendor_statements.our_balance` is written once, when the statement is filed,
//   and nothing ever refreshes it. Every invoice, payment and credit-note
//   correction that lands afterwards moves the real balance and leaves that column
//   behind. A statement was marked `תואם` (matched) by comparing the vendor's
//   figure against that number — so a row can read "matched, diff 0" while the
//   real gap today is large. The screens now recompute live, but the STORED
//   VERDICT on rows matched before that fix was never revisited.
//
// This walks every statement still sitting in `matched`, recomputes our balance
// TODAY with the same ledger engine the app uses, and prints the ones whose
// difference is no longer exactly zero.
//
// ── The balance rule is IMPORTED, never re-implemented ────────────────────────
// §9 is the record of what happens when this rule gets copied: four copies, four
// answers, one supplier reading 9,000 / 7,000 / 6,000. So this script imports
// `src/lib/ledgerEngine.ts` directly — the very file the frontend bundles — using
// Node's native TypeScript type stripping. `ledgerEngine.ts` has no imports and no
// non-erasable syntax, so stripping its types is enough to run it unmodified.
// Node >= 22.18 / 23.6 does this by default; on older Node the guard below
// re-executes this file with `--experimental-strip-types`. No new dependency, no
// build step, and — the point — no third copy of the rule.
//
// (The DB-row → engine-input MAPPING is duplicated, deliberately and verbatim,
// from `computeStatementLedger` in invoices-ingest / hadas-api. That is field
// renaming, not the rule; keep the three byte-identical.)
//
// ── Running it ────────────────────────────────────────────────────────────────
//
//   node scripts/statement-drift-report.mjs
//   node scripts/statement-drift-report.mjs --json      # machine-readable
//   node scripts/statement-drift-report.mjs --all       # include the still-matched rows
//
// Environment (read from the shell, or from a local `.env` if one exists):
//
//   SUPABASE_URL           or VITE_SUPABASE_URL       — project URL
//   VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY       — the ANON key. Read access
//                                                       is all this needs.
//   HADAS_REPORT_EMAIL / HADAS_REPORT_PASSWORD        — optional. `vendor_statements`
//                                                       and `payments` are manager-only
//                                                       under RLS
//                                                       (20260604120000_employee_rls.sql),
//                                                       so the anon key alone reads
//                                                       nothing. Supply a MANAGER's
//                                                       login and the script signs in
//                                                       for the duration of the run.
//
// ⚠️ It refuses a service-role key on purpose. A service-role key bypasses RLS AND
// carries full write authority — exactly what a read-only report must not hold. If
// you find yourself reaching for one, the fix is a manager login, not more power.

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SELF = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SELF), '..')

// ── Node < 22.18: re-exec with type stripping so the .ts import below resolves ──
if (!process.features.typescript) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', SELF, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  )
  if (r.error) {
    console.error(
      'statement-drift-report: this Node build cannot strip TypeScript types.\n' +
      '  Node >= 22.6 is required (>= 22.18 runs it without the flag).\n' +
      `  Current: ${process.version}`,
    )
    process.exit(1)
  }
  process.exit(r.status ?? 1)
}

// THE rule. Imported from the frontend source — not copied. See the header.
const { buildLedger } = await import('../src/lib/ledgerEngine.ts')
const { round2 }      = await import('../src/lib/vat.ts')

// ── Args ──────────────────────────────────────────────────────────────────────
const args    = new Set(process.argv.slice(2))
const asJson  = args.has('--json')
const showAll = args.has('--all')

// ── Environment ───────────────────────────────────────────────────────────────
if (existsSync(resolve(ROOT, '.env'))) {
  try { process.loadEnvFile(resolve(ROOT, '.env')) } catch { /* shell env only */ }
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

const die = msg => { console.error(`statement-drift-report: ${msg}`); process.exit(1) }

if (!url) die('no project URL. Set SUPABASE_URL (or VITE_SUPABASE_URL). See .env.example.')
if (!key) die('no anon key. Set VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY). See .env.example.')

/**
 * Is this a service-role / secret key? Two shapes are in circulation:
 *   · legacy — a JWT whose payload carries `"role": "service_role"`;
 *   · current — an opaque secret key prefixed `sb_secret_`.
 * Either one bypasses RLS and can write. This script needs neither, so holding one
 * is a mistake worth stopping for rather than a convenience worth allowing.
 */
function isPrivilegedKey(k) {
  if (/^sb_secret_/.test(k)) return true
  const parts = k.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload?.role === 'service_role' || payload?.role === 'supabase_admin'
  } catch { return false }
}

if (isPrivilegedKey(key)) {
  die(
    'that is a SERVICE-ROLE key, and this report refuses to run with one.\n' +
    '  A service-role key bypasses RLS and carries full write authority. This script\n' +
    '  only ever SELECTs, and must not be able to do more than it needs.\n' +
    '  Use VITE_SUPABASE_ANON_KEY, plus HADAS_REPORT_EMAIL / HADAS_REPORT_PASSWORD for a\n' +
    '  manager login if RLS is enabled.',
  )
}
if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY === key) {
  die('SUPABASE_SERVICE_ROLE_KEY was supplied as the client key. Read access is enough — use the anon key.')
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

// ── Optional manager sign-in (RLS: vendor_statements + payments are manager-only) ──
const email    = process.env.HADAS_REPORT_EMAIL || ''
const password = process.env.HADAS_REPORT_PASSWORD || ''
if (email && password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) die(`sign-in failed for ${email}: ${error.message}`)
}

// ── Read ──────────────────────────────────────────────────────────────────────
const read = async (table, columns, apply = q => q) => {
  const { data, error } = await apply(supabase.from(table).select(columns))
  if (error) die(`read of ${table} failed: ${error.message}`)
  return data ?? []
}

const statements = await read(
  'vendor_statements',
  'id, supplier_id, month, our_balance, vendor_balance, diff, status',
  q => q.eq('status', 'matched'),
)

if (statements.length === 0) {
  // Silence here is ambiguous, and reporting "all clear" would be a lie if RLS
  // simply returned nothing. Say which it is.
  const signedIn = Boolean(email && password)
  console.log('No statements in `matched` status were returned.')
  if (!signedIn) {
    console.log(
      '\n⚠️  No manager login was supplied. `vendor_statements` is manager-only under RLS\n' +
      '   (supabase/migrations/20260604120000_employee_rls.sql), so an anonymous read returns\n' +
      '   zero rows whether or not any exist. Set HADAS_REPORT_EMAIL / HADAS_REPORT_PASSWORD\n' +
      '   and re-run before treating this as "nothing to review".',
    )
    process.exit(2)
  }
  process.exit(0)
}

const supplierIds = [...new Set(statements.map(s => s.supplier_id).filter(Boolean))]

const suppliers = await read(
  'suppliers', 'id, name, opening_balance, payment_arrangement',
  q => q.in('id', supplierIds),
)
const invRows = await read(
  'invoices', 'id, supplier_id, total_amount, invoice_date, invoice_number, is_duplicate, has_error',
  q => q.in('supplier_id', supplierIds),
)
const payRows = await read(
  'payments', 'id, supplier_id, amount, payment_date, payment_type, status',
  q => q.in('supplier_id', supplierIds),
)

// ── The mapping, field for field, as the frontend hooks do it ──
// Byte-identical to `computeStatementLedger` in invoices-ingest and hadas-api.
// useInvoices:  supplier_id→supplierId, invoice_date→invoiceDate (ISO, sliced to
//               10), invoice_number→invoiceNumber, is_duplicate→isDuplicate,
//               has_error→hasError; total_amount rides along under its own name.
// usePayments:  supplier_id, amount, payment_date→date, payment_type→type, status
//               (null → "pending", as the hook's `?? 'pending'` does).
const invoices = invRows.map(r => ({
  id:            String(r.id),
  supplierId:    r.supplier_id ?? '',
  total_amount:  Number(r.total_amount ?? 0),
  invoiceDate:   String(r.invoice_date ?? '').slice(0, 10),
  invoiceNumber: r.invoice_number ?? '',
  isDuplicate:   r.is_duplicate ?? false,
  hasError:      r.has_error ?? false,
}))
const payments = payRows.map(r => ({
  id:          String(r.id),
  supplier_id: r.supplier_id ?? '',
  amount:      Number(r.amount ?? 0),
  date:        r.payment_date ?? '',
  type:        r.payment_type ?? '',
  status:      String(r.status ?? 'pending'),
}))

const supById = Object.fromEntries(suppliers.map(s => [s.id, s]))

// ── Recompute ─────────────────────────────────────────────────────────────────
const drifted  = []
const clean    = []
const skipped  = []

for (const st of statements) {
  const sup = st.supplier_id ? supById[st.supplier_id] : null
  if (!sup) {
    // No supplier row → no ledger → no honest verdict either way. Surfaced, not dropped.
    skipped.push({ ...st, supplierName: null, reason: st.supplier_id ? 'supplier row not readable' : 'no supplier assigned' })
    continue
  }
  if (sup.payment_arrangement) {
    // בהסדר תשלום: the engine reports 0 for display, so comparing it against a
    // vendor statement compares a deliberate zero to a real number. Same call as
    // invoices-ingest — record it, draw no verdict.
    skipped.push({ ...st, supplierName: sup.name, reason: 'supplier is on a payment arrangement (בהסדר תשלום) — no automatic verdict' })
    continue
  }

  // `paymentArrangement` deliberately NOT passed: this is the TRUE ledger figure.
  const live       = round2(buildLedger(st.supplier_id, invoices, payments, sup.opening_balance ?? 0).closingBalance)
  const vendor     = Number(st.vendor_balance ?? 0)
  const liveDiff   = round2(live - vendor)
  const storedOurs = Number(st.our_balance ?? 0)

  const row = {
    id:           st.id,
    supplier:     sup.name ?? st.supplier_id,
    supplierId:   st.supplier_id,
    month:        st.month ?? '',
    vendorBalance: vendor,
    storedOurBalance: storedOurs,
    liveOurBalance:   live,
    storedDiff:   round2(Number(st.diff ?? 0)),
    liveDiff,
    balanceDrift: round2(live - storedOurs),
  }
  // The owner's rule: `תואם` is EXACTLY zero, no tolerance band.
  if (liveDiff === 0) clean.push(row); else drifted.push(row)
}

drifted.sort((a, b) => Math.abs(b.liveDiff) - Math.abs(a.liveDiff))

// ── Report ────────────────────────────────────────────────────────────────────
if (asJson) {
  console.log(JSON.stringify({
    readOnly: true,
    generatedAt: new Date().toISOString(),
    matchedStatementsExamined: statements.length,
    noLongerMatched: drifted,
    stillMatched: showAll ? clean : clean.length,
    notVerdictable: skipped,
  }, null, 2))
  process.exit(0)
}

const money = n => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pad   = (s, w) => String(s).length >= w ? String(s) : String(s) + ' '.repeat(w - String(s).length)
const padL  = (s, w) => String(s).length >= w ? String(s) : ' '.repeat(w - String(s).length) + String(s)
const rule  = n => '─'.repeat(n)

console.log('')
console.log('  STATEMENTS MARKED `matched` THAT NO LONGER MATCH')
console.log('  ' + rule(96))
console.log('  READ-ONLY report. Nothing below has been changed. docs/07-OPEN-ISSUES.md item 3b.')
console.log(`  Examined ${statements.length} statement(s) in \`matched\` status.`)
console.log('')

if (drifted.length === 0) {
  console.log(`  ✓ None. All ${clean.length} verdictable matched statement(s) still reconcile to exactly zero.`)
} else {
  console.log(`  ✗ ${drifted.length} of ${statements.length} no longer reconcile to zero:`)
  console.log('')
  console.log('  ' +
    pad('STATEMENT', 14) + pad('SUPPLIER', 26) + pad('MONTH', 9) +
    padL('VENDOR', 14) + padL('OURS (STORED)', 15) + padL('OURS (LIVE)', 14) + padL('DIFF NOW', 13))
  console.log('  ' + rule(105))
  for (const d of drifted) {
    console.log('  ' +
      pad(d.id, 14) + pad((d.supplier ?? '').slice(0, 24), 26) + pad(d.month, 9) +
      padL(money(d.vendorBalance), 14) + padL(money(d.storedOurBalance), 15) +
      padL(money(d.liveOurBalance), 14) + padL(money(d.liveDiff), 13))
  }
  console.log('')
  console.log('  DIFF NOW = our live balance − the vendor\'s figure. `תואם` means EXACTLY zero,')
  console.log('  so every row above is a real open gap. OURS (STORED) is what the column still')
  console.log('  says — kept as the record of the filing date, never used for the verdict.')
  console.log(`  ${clean.length} other matched statement(s) still reconcile to zero.`)
}

if (skipped.length) {
  console.log('')
  console.log(`  NOT VERDICTABLE — ${skipped.length} matched statement(s) skipped, listed so they are not silently dropped:`)
  for (const s of skipped) {
    console.log(`    ${pad(s.id, 14)} ${pad((s.supplierName ?? '—').slice(0, 24), 26)} ${pad(s.month ?? '', 9)} ${s.reason}`)
  }
}

console.log('')
console.log('  Nothing was written. Review each row and decide in the app.')
console.log('')
process.exit(drifted.length ? 3 : 0)
