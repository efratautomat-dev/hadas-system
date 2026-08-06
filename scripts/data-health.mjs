#!/usr/bin/env node
// data-health — ONE morning report: what in the production data needs cleaning?
//
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  READ-ONLY. Every query is a SELECT. It deletes nothing, flags nothing,      ║
// ║  merges nothing, and moves no balance. The output is a worklist for a human. ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
//
// Built to answer a question that should not be guessed at: HOW MUCH is there?
// Twelve duplicates is twenty minutes of clicking through tools that already
// exist. Three hundred is a screen worth building. This report is what decides
// which of those is true, before any of it is built.
//
// ── Sections ──────────────────────────────────────────────────────────────────
//   A · Duplicate invoices — flagged AND unflagged (the unflagged ones still
//       count toward supplier balances, so they are the ones costing money)
//   B · Duplicate suppliers — same ח.פ, or names that normalise to the same thing
//   C · Receipts sitting in `invoices` (rule shared with receipt-audit)
//   D · Statements needing attention — orphans, and `תואם` rows that no longer are
//   E · Invoices missing the pieces the system needs
//   F · The alert queue
//
// Each section prints a COUNT and a money figure where money is involved, plus a
// handful of examples. For the full row-by-row list of any one section, run its
// dedicated script — this one is deliberately a summary.
//
// ── Running it ────────────────────────────────────────────────────────────────
//
//   node scripts/data-health.mjs
//   node scripts/data-health.mjs --json
//   node scripts/data-health.mjs --full     # every row, not just examples
//   node scripts/data-health.mjs --fixture <file.json>
//        Read the tables from a JSON file instead of the database. Exists so the
//        REPORT LOGIC can be exercised without production access — the shape is
//        { invoices: [], suppliers: [], payments: [], vendor_statements: [], alerts: [] }
//        with the same column names the DB uses.
//
// Environment:
//   SUPABASE_URL           or VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY
//   HADAS_REPORT_EMAIL / HADAS_REPORT_PASSWORD   — a MANAGER login. Most of these
//                                                  tables are manager-only under RLS.
//
// ⚠️ It PRINTS THE PROJECT IT CONNECTED TO before anything else, and refuses a
// service-role key. Reading TEST while believing you are reading PROD is the one
// failure that would make this whole report worse than useless — the repo's `.env`
// points at TEST, so the default is exactly the wrong project for this job.

import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { receiptMatches } from './lib/receiptRule.mjs'
import { connect } from './lib/connect.mjs'

const SELF = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SELF), '..')

// Node < 22.18 needs the flag to import the .ts ledger engine below.
if (!process.features.typescript) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', SELF, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  )
  if (r.error) {
    console.error(`data-health: this Node cannot strip TypeScript types (need >= 22.6). Current: ${process.version}`)
    process.exit(1)
  }
  process.exit(r.status ?? 1)
}

// THE balance rule, imported from the frontend source — never re-implemented.
const { buildLedger } = await import('../src/lib/ledgerEngine.ts')

const argv = process.argv.slice(2)
const args = new Set(argv)
const asJson = args.has('--json')
const full = args.has('--full')
const fixture = argv.includes('--fixture') ? argv[argv.indexOf('--fixture') + 1] : null

let invoices, suppliers, payments, statements, alerts, projectRef, signedIn = false, email = ''

if (fixture) {
  const { readFileSync } = await import('node:fs')
  const f = JSON.parse(readFileSync(resolve(ROOT, fixture), 'utf8'))
  ;({ invoices = [], suppliers = [], payments = [], alerts = [] } = f)
  statements = f.vendor_statements ?? []
  projectRef = `FIXTURE ${fixture}`
} else {
  const conn = await connect(ROOT, 'data-health')
  ;({ projectRef, signedIn, email } = conn)
  ;[invoices, suppliers, payments, statements, alerts] = await Promise.all([
    conn.read('invoices', 'id, supplier_id, supplier_name, invoice_number, invoice_date, total_amount, ' +
                          'amount_before_vat, vat_amount, email_subject, invoice_type, line_items, ' +
                          'is_duplicate, has_error, created_at'),
    conn.read('suppliers', 'id, name, hp, alt_names, email, opening_balance, payment_arrangement'),
    conn.read('payments', 'id, supplier_id, amount, payment_date, payment_type, status'),
    // Only what the report actually uses — asking for a column it does not need
    // would make the whole run fail on a project where that column is missing.
    conn.read('vendor_statements', 'id, supplier_id, month, our_balance, vendor_balance, diff, status'),
    conn.read('alerts', 'id, type, status, created_at'),
  ])
}

// ── helpers ───────────────────────────────────────────────────────────────────
const money = n => '₪' + Number(n ?? 0).toLocaleString('he-IL')
const num = n => Number(n ?? 0) || 0
const groupBy = (rows, keyFn) => {
  const m = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (k == null || k === '') continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}
/** Trim the noise that makes the same company name look like two companies. */
const normName = s => String(s ?? '')
  .replace(/["'׳״]/g, '')
  .replace(/\bבע["']?מ\b/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()
const normHp = s => String(s ?? '').replace(/\D/g, '')
const normDoc = s => String(s ?? '').replace(/\s+/g, '').replace(/^0+/, '').toLowerCase()
const excluded = i => !!i.is_duplicate || !!i.has_error

// ── A · duplicate invoices ────────────────────────────────────────────────────
// Same supplier + same document number is the strong signal. Same supplier +
// same amount + same date catches the ones that arrived without a number.
const dupGroups = []
for (const [, rows] of groupBy(
  invoices.filter(i => i.supplier_id && i.invoice_number),
  i => `${i.supplier_id}|${normDoc(i.invoice_number)}`,
)) if (rows.length > 1) dupGroups.push({ by: 'מספר מסמך', rows })

const seen = new Set(dupGroups.flatMap(g => g.rows.map(r => r.id)))
for (const [, rows] of groupBy(
  invoices.filter(i => i.supplier_id && !seen.has(i.id) && num(i.total_amount) !== 0),
  i => `${i.supplier_id}|${num(i.total_amount)}|${String(i.invoice_date ?? '').slice(0, 10)}`,
)) if (rows.length > 1) dupGroups.push({ by: 'סכום + תאריך', rows })

// Within a group, everything after the first copy is surplus. Surplus rows that
// are NOT excluded are the ones actually inflating a balance.
const surplus = dupGroups.flatMap(g => g.rows.slice(1))
const surplusCounted = surplus.filter(r => !excluded(r))
const dupCost = surplusCounted.reduce((s, r) => s + num(r.total_amount), 0)

// ── B · duplicate suppliers ───────────────────────────────────────────────────
const supByHp = [...groupBy(suppliers.filter(s => normHp(s.hp)), s => normHp(s.hp))]
  .filter(([, rows]) => rows.length > 1)

// The name pass runs over EVERY supplier, including ones already in an ח.פ group.
// Excluding them was wrong: a card can share a ח.פ with one supplier and a name
// with a different one, and dropping it from this pass hid the second pair
// entirely. Only a name group whose members are exactly an ח.פ group is dropped,
// since that is the same finding reported twice.
const hpGroupKeys = new Set(supByHp.map(([, rows]) => rows.map(r => r.id).sort().join('|')))
const supByName = [...groupBy(suppliers.filter(s => normName(s.name)), s => normName(s.name))]
  .filter(([, rows]) => rows.length > 1)
  .filter(([, rows]) => !hpGroupKeys.has(rows.map(r => r.id).sort().join('|')))

const invCountBySupplier = new Map()
for (const i of invoices) invCountBySupplier.set(i.supplier_id, (invCountBySupplier.get(i.supplier_id) ?? 0) + 1)

// ── C · receipts ──────────────────────────────────────────────────────────────
const receipts = invoices.map(r => ({ row: r, matched: receiptMatches(r) })).filter(h => h.matched.length)
const receiptsCounted = receipts.filter(h => !excluded(h.row))
const receiptCost = receiptsCounted.reduce((s, h) => s + num(h.row.total_amount), 0)

// ── D · statements ────────────────────────────────────────────────────────────
const orphanStatements = statements.filter(s => !s.supplier_id)
const supplierById = new Map(suppliers.map(s => [s.id, s]))
const invBySupplier = groupBy(invoices.filter(i => i.supplier_id), i => i.supplier_id)
const payBySupplier = groupBy(payments.filter(p => p.supplier_id), p => p.supplier_id)

// Same mapping the app uses, so the balance here is the balance on screen.
const toEngine = supplierId => ({
  invoices: (invBySupplier.get(supplierId) ?? []).map(r => ({
    id: String(r.id), supplierId: r.supplier_id ?? '', total_amount: num(r.total_amount),
    invoiceDate: String(r.invoice_date ?? '').slice(0, 10), invoiceNumber: r.invoice_number ?? '',
    isDuplicate: !!r.is_duplicate, hasError: !!r.has_error,
  })),
  payments: (payBySupplier.get(supplierId) ?? []).map(r => ({
    id: String(r.id), supplier_id: r.supplier_id ?? '', amount: num(r.amount),
    date: r.payment_date ?? '', type: r.payment_type ?? '', status: String(r.status ?? 'pending'),
  })),
})

const staleMatched = []
for (const st of statements.filter(s => s.status === 'matched' && s.supplier_id)) {
  const sup = supplierById.get(st.supplier_id)
  if (!sup || sup.payment_arrangement) continue
  if (st.vendor_balance == null) continue
  const { invoices: inv, payments: pay } = toEngine(st.supplier_id)
  const live = buildLedger(st.supplier_id, inv, pay, num(sup.opening_balance)).closingBalance
  const diff = Math.round((live - num(st.vendor_balance)) * 100) / 100
  if (diff !== 0) staleMatched.push({ st, live, diff, name: sup.name })
}

// ── E · incomplete invoices ───────────────────────────────────────────────────
const noSupplier = invoices.filter(i => !i.supplier_id)
const noAmount = invoices.filter(i => num(i.total_amount) === 0)
const noSplit = invoices.filter(i => num(i.total_amount) !== 0 &&
                                     num(i.amount_before_vat) === 0 && num(i.vat_amount) === 0)
const errored = invoices.filter(i => i.has_error)

// ── F · alerts ────────────────────────────────────────────────────────────────
const openAlerts = alerts.filter(a => a.status !== 'resolved')
const alertsByType = [...groupBy(openAlerts, a => a.type)].sort((a, b) => b[1].length - a[1].length)
const DAY = 86400000
const oldAlerts = openAlerts.filter(a => a.created_at && Date.now() - Date.parse(a.created_at) > 30 * DAY)

// ── output ────────────────────────────────────────────────────────────────────
if (asJson) {
  console.log(JSON.stringify({
    project: projectRef,
    duplicateInvoices: { groups: dupGroups.length, surplus: surplus.length, surplusCounted: surplusCounted.length, cost: dupCost },
    duplicateSuppliers: { byHp: supByHp.length, byName: supByName.length },
    receipts: { total: receipts.length, counted: receiptsCounted.length, cost: receiptCost },
    statements: { orphans: orphanStatements.length, staleMatched: staleMatched.length },
    invoices: { total: invoices.length, noSupplier: noSupplier.length, noAmount: noAmount.length, noSplit: noSplit.length, errored: errored.length },
    alerts: { open: openAlerts.length, olderThan30d: oldAlerts.length, byType: Object.fromEntries(alertsByType.map(([t, r]) => [t, r.length])) },
  }, null, 2))
  process.exit(0)
}

const say = (...m) => console.log(...m)
const head = t => { say(''); say(`  ${t}`); say('  ' + '─'.repeat(74)) }
const examples = rows => full ? rows : rows.slice(0, 5)
const more = rows => (!full && rows.length > 5) ? `    …ועוד ${rows.length - 5}. הרצה עם --full לרשימה המלאה.` : null

say('')
say('  ╭──────────────────────────────────────────────────────────────────────────╮')
say('  │  דוח בריאות נתונים — קריאה בלבד. שום דבר לא שונה, נמחק או מוזג.          │')
say('  ╰──────────────────────────────────────────────────────────────────────────╯')
say('')
say(`  פרויקט: ${projectRef}`)
say(`  התחברות: ${signedIn ? `${email} (מנהלת)` : 'אנונימית — ייתכן ש-RLS מסתיר שורות'}`)
say(`  נסרקו: ${invoices.length} חשבוניות · ${suppliers.length} ספקים · ${payments.length} תשלומים · ${statements.length} כרטסות`)
say('')
say('  ⚠️  ודאי שהפרויקט למעלה הוא הפרודקשן. קובץ ה-.env בריפו מצביע על TEST.')

head(`A · חשבוניות כפולות — ${dupGroups.length} קבוצות`)
if (!dupGroups.length) say('    לא נמצאו.')
else {
  say(`    ${surplus.length} שורות עודפות, מתוכן ${surplusCounted.length} עדיין נספרות ביתרה.`)
  say(`    ההשפעה על יתרות הספקים: ${money(dupCost)}`)
  say('')
  for (const g of examples(dupGroups)) {
    const r = g.rows[0]
    say(`    ${r.supplier_name || r.supplier_id} · מסמך ${r.invoice_number || '—'} · ${money(r.total_amount)} · ${g.rows.length} עותקים (${g.by})`)
    for (const c of g.rows) say(`        ${c.id}  ${String(c.invoice_date ?? '').slice(0, 10)}  ${excluded(c) ? 'לא נספרת' : 'נספרת'}`)
  }
  const m = more(dupGroups); if (m) say(m)
  say('')
  say('    לטיפול: מסך חשבוניות ← מסנן "כפילויות". מחיקת כפילות סוגרת גם את ההתראה.')
}

head(`B · ספקים כפולים — ${supByHp.length + supByName.length} קבוצות`)
if (!supByHp.length && !supByName.length) say('    לא נמצאו.')
else {
  if (supByHp.length) {
    say(`    ${supByHp.length} קבוצות עם אותו ח.פ:`)
    for (const [hp, rows] of examples(supByHp)) {
      say(`      ח.פ ${hp}`)
      for (const s of rows) say(`        ${s.id}  ${s.name}  (${invCountBySupplier.get(s.id) ?? 0} חשבוניות)`)
    }
    say('')
    say('    ⚠️  שימי לב: LUMIERE ו-ST FASHION חולקות ח.פ בכוונה ואסור למזג אותן')
    say('        (spec/06-RULES.md §7). אם הן מופיעות כאן — זו לא כפילות.')
  }
  if (supByName.length) {
    say('')
    say(`    ${supByName.length} קבוצות עם שם זהה אחרי ניקוי (בע"מ, גרשיים, רווחים):`)
    for (const [, rows] of examples(supByName)) {
      say(`      ${rows.map(s => `${s.name} (${s.id}, ${invCountBySupplier.get(s.id) ?? 0} חשבוניות)`).join('  ↔  ')}`)
    }
  }
  say('')
  say('    לטיפול: מסך ספקים ← מיזוג. הפעולה אטומית ולא מאבדת היסטוריה.')
}

head(`C · קבלות שנכנסו כחשבוניות — ${receipts.length}`)
if (!receipts.length) say('    לא נמצאו. (היוריסטיקה על טקסט — תוצאה נקייה היא בשורה טובה, לא הוכחה.)')
else {
  say(`    ${receiptsCounted.length} מתוכן עדיין נספרות ביתרה — ${money(receiptCost)}.`)
  for (const h of examples(receiptsCounted)) {
    say(`      ${h.row.id}  ${h.row.supplier_name}  ${money(h.row.total_amount)}  ← ${h.matched.join(' · ')}`)
  }
  const m = more(receiptsCounted); if (m) say(m)
  say('')
  say('    לפירוט מלא + קישור לכל מסמך:  node scripts/receipt-audit.mjs')
  say('    מומלץ לסמן has_error ולא למחוק — מוציא מהיתרה ומשאיר תיעוד.')
}

head(`D · כרטסות — ${orphanStatements.length} יתומות, ${staleMatched.length} "תואם" שכבר לא`)
if (orphanStatements.length) {
  say(`    ${orphanStatements.length} ממתינות לשיוך ספק:`)
  for (const s of examples(orphanStatements)) say(`      ${s.id}  ${s.month}  ספק: ${money(s.vendor_balance)}`)
  say('    לטיפול: מסך התאמת כרטסות ← "שינוי ספק".')
}
if (staleMatched.length) {
  say('')
  say(`    ${staleMatched.length} מסומנות "תואם" אבל ההפרש כבר אינו אפס:`)
  for (const s of examples(staleMatched)) {
    say(`      ${s.st.id}  ${s.name}  ${s.st.month}  ספק ${money(s.st.vendor_balance)} · שלנו ${money(s.live)} · הפרש ${money(s.diff)}`)
  }
  const m = more(staleMatched); if (m) say(m)
  say('    לפירוט:  node scripts/statement-drift-report.mjs')
}
if (!orphanStatements.length && !staleMatched.length) say('    הכל תקין.')

head('E · חשבוניות חסרות')
say(`    ${noSupplier.length} בלי ספק · ${noAmount.length} בלי סכום · ${errored.length} מסומנות כשגויות`)
say(`    ${noSplit.length} עם סה"כ אבל בלי פיצול מע"מ`)
if (noSplit.length) {
  say('      אלו קדמו לפריסת השלמת הסכומים. הן מושלמות אוטומטית ברגע שפותחים אותן')
  say('      במסך החשבוניות — לא דורש טיפול יזום.')
}

head(`F · תור ההתראות — ${openAlerts.length} פתוחות`)
if (!openAlerts.length) say('    ריק.')
else {
  for (const [type, rows] of alertsByType.slice(0, full ? 99 : 8)) say(`    ${String(rows.length).padStart(4)}  ${type}`)
  if (oldAlerts.length) {
    say('')
    say(`    ${oldAlerts.length} מהן פתוחות מעל 30 יום. שווה לעבור עליהן — התראה שאיש`)
    say('    לא נגע בה חודש היא בדרך כלל רעש שמסתיר את מה שכן דורש טיפול.')
  }
}

say('')
say('  ──────────────────────────────────────────────────────────────────────────')
say('  שום דבר לא שונה. תעברי על הסעיפים ותחליטי מה מטפלים ובאיזה סדר.')
say('')
