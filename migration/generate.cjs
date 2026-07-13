// Generator for suppliers + invoices import SQL.
//
// Reads suppliers.csv.csv + invoices.csv.csv, applies the agreed transformations,
// writes:
//   - 01_suppliers.sql
//   - 02_invoices.sql
// And prints any data anomalies to stderr before completion.
//
// Run: node generate.cjs

const fs   = require('fs')
const path = require('path')

const SUPPLIERS_CSV  = path.join(__dirname, 'suppliers.csv.csv')
const INVOICES_CSV   = path.join(__dirname, 'invoices.csv.csv')
const OUT_SUPPLIERS  = path.join(__dirname, '01_suppliers.sql')
const OUT_INVOICES   = path.join(__dirname, '02_invoices.sql')

// ─── CSV parser ─────────────────────────────────────────────────────────────
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const rows = []
  let cur = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else field += c
    } else {
      if (c === '"')      inQuotes = true
      else if (c === ',') { cur.push(field); field = '' }
      else if (c === '\n'){ cur.push(field); field = ''; rows.push(cur); cur = [] }
      else if (c === '\r'){}
      else                field += c
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur) }
  return rows
}

function toRecords(rows) {
  const [hdr, ...rest] = rows
  return rest
    .filter(r => r.some(v => (v ?? '').trim().length > 0))
    .map(r => Object.fromEntries(hdr.map((h, i) => [h, (r[i] ?? '').trim()])))
}

// ─── SQL helpers ───────────────────────────────────────────────────────────
function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}
function sqlNum(v) {
  if (v === null || v === undefined || v === '') return 'NULL'
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : 'NULL'
}
function sqlBool(v)  { return v ? 'true' : 'false' }
function sqlDate(v)  { return v ? `'${v}'::date` : 'NULL' }
function sqlTs(v)    { return v ? `'${v}'::timestamptz` : 'NULL' }

// ─── Date helpers ───────────────────────────────────────────────────────────
// Hebrew Airtable format: "D/M/YYYY HH:MM" or "D/M/YYYY"
function parseHebrewDate(s) {
  if (!s) return null
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (!m) return null
  const [, d, mo, y, hh, mm] = m
  const pad = (x, n = 2) => String(x).padStart(n, '0')
  const date = `${y}-${pad(mo)}-${pad(d)}`
  const time = hh != null ? `${pad(hh)}:${pad(mm)}:00+00` : null
  return { date, ts: time ? `${date} ${time}` : `${date} 00:00:00+00` }
}

function isoToTs(s) {
  // Already in ISO 8601 form: "2026-04-27T04:25:17.000Z" — keep as-is, Postgres
  // accepts it directly into timestamptz.
  return s || null
}

// ─── Category normalization (rule #1) ───────────────────────────────────────
function normalizeCategory(v) {
  if (!v) return ''
  if (v === 'ספקים כיסויי ראש') return 'ספקים כיסויי ראש ומטפחות'
  if (v === 'ספקים שונות')       return 'שונות'
  return v
}

// ─── Build supplier rows ────────────────────────────────────────────────────
const suppliersRaw = toRecords(parseCSV(fs.readFileSync(SUPPLIERS_CSV, 'utf8')))

const suppliers = suppliersRaw.map(r => {
  const created = parseHebrewDate(r['תאריך יצירת הרשומה']) // { date, ts } | null
  const balDate = parseHebrewDate(r['נכון לתאריך'])
  const obStr   = r['יתרת פתיחה']
  const ob      = obStr === '' ? null : Number(obStr)
  return {
    rawName:     r['שם ספק'],
    name:        r['שם ספק'],
    contact:     r['שם איש קשר']         || null,
    hp:          r['מספר ע.מ. או ח.פ.']  || null,
    email:       r['מייל']                || null,
    phone:       r['טלפון']               || null,
    category:    normalizeCategory(r['קטגוריה ברירת מחדל']) || null,
    notes:       r['הערות']               || null,
    created_ts:  created?.ts ?? null,
    created_sort: created?.ts ?? '9999-12-31', // empty created sorts last, deterministic
    opening_balance:      (ob === null || Number.isNaN(ob)) ? null : ob,
    opening_balance_date: balDate?.date ?? null,
  }
})

// Order suppliers oldest-first by created_at and assign SUP-001..SUP-NNN.
suppliers.sort((a, b) => a.created_sort.localeCompare(b.created_sort))
suppliers.forEach((s, i) => { s.id = `SUP-${String(i + 1).padStart(3, '0')}` })

// name → id lookup for invoice linking
const nameToSupplierId = new Map()
for (const s of suppliers) nameToSupplierId.set(s.name, s.id)

// ─── Build invoice rows ─────────────────────────────────────────────────────
const invoicesRawAll = toRecords(parseCSV(fs.readFileSync(INVOICES_CSV, 'utf8')))

// One-off typo fix: Airtable stored 2003-05-26 for invoice 01/011501 from
// "בס״ד ציפורה אחדות א.צ.ל" — the actual date is 2026-05-03 (Hebrew DD/MM/YY
// reading of "03/05/26"; the received_at is 2026-05-26, which corroborates).
function maybeFixDateTypo(r) {
  if (r['שם ספק']        === 'בס״ד ציפורה אחדות א.צ.ל' &&
      r['מספר חשבונית']  === '01/011501' &&
      r['תאריך חשבונית'] === '2003-05-26') {
    return { ...r, 'תאריך חשבונית': '2026-05-03' }
  }
  return r
}

// Drop rows that share a gmail_message_id with an earlier row (same email
// ingested into Airtable multiple times — would violate invoices_gmail_message_id_uidx
// on insert). User-confirmed: keep the first occurrence, drop the rest.
// Rows with no gmail_message_id are never deduped against each other.
const seenGmail = new Set()
const droppedDuplicates = []
const invoicesRaw = []
for (const r0 of invoicesRawAll) {
  const r = maybeFixDateTypo(r0)
  const g = r['מזהה מייל']
  if (g && seenGmail.has(g)) {
    droppedDuplicates.push({
      gmail_message_id: g,
      invoice_number:   r['מספר חשבונית'],
      supplier_name:    r['שם ספק'],
    })
    continue
  }
  if (g) seenGmail.add(g)
  invoicesRaw.push(r)
}

const invoices = invoicesRaw.map(r => {
  const receivedRaw = r['תאריך ושעת קבלת המייל']  // ISO string
  const transferredFlag = r['הועבר לרוח'] !== ''   // any non-empty → true (rule #3)
  return {
    rawSupplierName: r['שם ספק'],
    supplier_name:   r['שם ספק'],
    supplier_id:     nameToSupplierId.get(r['שם ספק']) ?? null,
    invoice_number:  r['מספר חשבונית'],
    invoice_date:    r['תאריך חשבונית'] || null,   // already YYYY-MM-DD
    total_amount:        r['סכום כולל מע\'\'מ'] || '',
    amount_before_vat:   r['סכום לפני מע\'\'מ']   || '',
    vat_amount:          r['סכום מע\'\'מ']         || '',
    category:        normalizeCategory(r['קטגוריה']) || null,
    line_items:      r['פירוט שורות'] || null,
    partial_return:  r['החזר חלקי'] !== '',         // boolean
    sender_name:     r['שם השולח']         || null,
    email_sender:    r['כתובת מייל שולח'] || null,
    drive_file_link: r['קישור לקובץ בדרייב']  || null,
    month_folder_link: r['קישור לתיקית החודש'] || null,
    message_link:    r['קישור למייל המקורי']  || null,
    received_at:     receivedRaw || null,
    gmail_message_id: r['מזהה מייל'] || null,
    ai_confidence:   r['איכות פענוח'] || null,
    transferred_at:  transferredFlag ? (receivedRaw || null) : null,
    ai_missing_fields: r['ai_missing_fields'] || null,
  }
})

// Year prefix comes from invoice_date (the invoice's actual year, per user spec).
// Within a year, ordering is by received_at ascending. invoice_date is preferred
// because received_at for migrated rows reflects when N8N batch-processed them
// (all 2026) rather than the underlying invoice year.
function yearOf(inv) {
  const d = inv.invoice_date
  if (d && /^\d{4}/.test(d)) return d.slice(0, 4)
  const r = inv.received_at
  if (r && /^\d{4}/.test(r)) return r.slice(0, 4)
  return '0000'
}

const byYear = new Map()
for (const inv of invoices) {
  const y = yearOf(inv)
  if (!byYear.has(y)) byYear.set(y, [])
  byYear.get(y).push(inv)
}
for (const [, list] of byYear) {
  list.sort((a, b) => (a.received_at ?? '9999').localeCompare(b.received_at ?? '9999'))
  list.forEach((inv, i) => {
    inv.id = `INV-${yearOf(inv)}-${String(i + 1).padStart(3, '0')}`
  })
}

// ─── Anomaly detection ──────────────────────────────────────────────────────
const anomalies = []

const missingSupplier = invoices.filter(i => !i.supplier_id)
if (missingSupplier.length) {
  const names = [...new Set(missingSupplier.map(i => i.rawSupplierName))]
  anomalies.push(
    `[A1] ${missingSupplier.length} invoice(s) reference supplier names not in suppliers.csv — supplier_id will be NULL.\n` +
    `     Distinct unmatched names (${names.length}): ${names.map(n => JSON.stringify(n)).join(', ')}`
  )
}

const dupKey = new Map()
for (const inv of invoices) {
  const key = `${inv.invoice_number}::${inv.supplier_id ?? '∅'}`
  if (!dupKey.has(key)) dupKey.set(key, [])
  dupKey.get(key).push(inv.id)
}
const dups = [...dupKey.entries()].filter(([, list]) => list.length > 1)
if (dups.length) {
  anomalies.push(
    `[A2] ${dups.length} duplicate (invoice_number, supplier_id) combination(s):\n` +
    dups.map(([k, list]) => `     ${k}  →  ${list.join(', ')}`).join('\n')
  )
}

const gmailMap = new Map()
for (const inv of invoices) {
  if (!inv.gmail_message_id) continue
  if (!gmailMap.has(inv.gmail_message_id)) gmailMap.set(inv.gmail_message_id, [])
  gmailMap.get(inv.gmail_message_id).push(inv.id)
}
const dupGmail = [...gmailMap.entries()].filter(([, list]) => list.length > 1)
if (dupGmail.length) {
  anomalies.push(
    `[A3] ${dupGmail.length} duplicate gmail_message_id (would violate invoices_gmail_message_id_uidx):\n` +
    dupGmail.map(([k, list]) => `     ${k}  →  ${list.join(', ')}`).join('\n')
  )
}

const invMissingDate = invoices.filter(i => !i.received_at && !i.invoice_date)
if (invMissingDate.length) {
  anomalies.push(`[A4] ${invMissingDate.length} invoice(s) have neither received_at nor invoice_date — landed in year 0000`)
}

// Flag invoice dates outside a plausible range. Receipts in this system can't
// reasonably be older than 2023 (Airtable's own oldest data is 2024) and can't
// be in the future. Anything older than 2023 is almost certainly a typo.
const NOW_YEAR  = new Date().getUTCFullYear()
const oddDates  = invoices.filter(i => {
  if (!i.invoice_date) return false
  const y = Number(i.invoice_date.slice(0, 4))
  return y < 2023 || y > NOW_YEAR
})
if (oddDates.length) {
  anomalies.push(
    `[A6] ${oddDates.length} invoice(s) have an invoice_date that looks like a typo (year < 2023 or > ${NOW_YEAR}):\n` +
    oddDates.map(i => `     ${i.id}  invoice_date=${i.invoice_date}  received_at=${i.received_at}  supplier=${JSON.stringify(i.supplier_name)}  inv#=${i.invoice_number}`).join('\n')
  )
}

const supDupName = new Map()
for (const s of suppliers) {
  if (!supDupName.has(s.name)) supDupName.set(s.name, [])
  supDupName.get(s.name).push(s.id)
}
const dupSupName = [...supDupName.entries()].filter(([, list]) => list.length > 1)
if (dupSupName.length) {
  anomalies.push(
    `[A5] ${dupSupName.length} supplier name(s) appear more than once in suppliers.csv:\n` +
    dupSupName.map(([k, list]) => `     ${JSON.stringify(k)}  →  ${list.join(', ')}`).join('\n')
  )
}

// ─── Write 01_suppliers.sql ─────────────────────────────────────────────────
const supCols = [
  'id', 'name', 'hp', 'contact', 'email', 'phone',
  'category', 'notes', 'opening_balance', 'opening_balance_date', 'created_at',
]

const supRows = suppliers.map(s =>
  '  (' + [
    sqlStr(s.id),
    sqlStr(s.name),
    sqlStr(s.hp),
    sqlStr(s.contact),
    sqlStr(s.email),
    sqlStr(s.phone),
    sqlStr(s.category),
    sqlStr(s.notes),
    sqlNum(s.opening_balance),
    sqlDate(s.opening_balance_date),
    sqlTs(s.created_ts),
  ].join(', ') + ')'
)

const supSQL = [
  '-- Generated by migration/generate.cjs — DO NOT edit by hand.',
  `-- ${suppliers.length} suppliers from Airtable export, ordered by created_at ascending.`,
  '-- IDs SUP-001..SUP-' + String(suppliers.length).padStart(3, '0') + '.',
  '',
  'BEGIN;',
  '',
  `INSERT INTO public.suppliers (${supCols.join(', ')}) VALUES`,
  supRows.join(',\n') + ';',
  '',
  'COMMIT;',
  '',
].join('\n')

fs.writeFileSync(OUT_SUPPLIERS, supSQL, 'utf8')

// ─── Write 02_invoices.sql ──────────────────────────────────────────────────
const invCols = [
  'id', 'invoice_number', 'invoice_date',
  'supplier_id', 'supplier_name',
  'total_amount', 'amount_before_vat', 'vat_amount',
  'category', 'line_items',
  'partial_return',
  'sender_name', 'email_sender',
  'drive_file_link', 'month_folder_link', 'message_link',
  'received_at', 'gmail_message_id', 'ai_confidence',
  'transferred_at', 'ai_missing_fields',
]

const invRows = invoices.map(inv =>
  '  (' + [
    sqlStr(inv.id),
    sqlStr(inv.invoice_number),
    sqlDate(inv.invoice_date),
    sqlStr(inv.supplier_id),
    sqlStr(inv.supplier_name),
    sqlNum(inv.total_amount),
    sqlNum(inv.amount_before_vat),
    sqlNum(inv.vat_amount),
    sqlStr(inv.category),
    sqlStr(inv.line_items),
    sqlBool(inv.partial_return),
    sqlStr(inv.sender_name),
    sqlStr(inv.email_sender),
    sqlStr(inv.drive_file_link),
    sqlStr(inv.month_folder_link),
    sqlStr(inv.message_link),
    sqlTs(inv.received_at),
    sqlStr(inv.gmail_message_id),
    sqlStr(inv.ai_confidence),
    sqlTs(inv.transferred_at),
    sqlStr(inv.ai_missing_fields),
  ].join(', ') + ')'
)

// Sort invoices for output by year then numeric suffix so the SQL file reads
// chronologically — purely cosmetic.
invoices.sort((a, b) => a.id.localeCompare(b.id))
const invRowsSorted = invoices.map(inv =>
  '  (' + [
    sqlStr(inv.id),
    sqlStr(inv.invoice_number),
    sqlDate(inv.invoice_date),
    sqlStr(inv.supplier_id),
    sqlStr(inv.supplier_name),
    sqlNum(inv.total_amount),
    sqlNum(inv.amount_before_vat),
    sqlNum(inv.vat_amount),
    sqlStr(inv.category),
    sqlStr(inv.line_items),
    sqlBool(inv.partial_return),
    sqlStr(inv.sender_name),
    sqlStr(inv.email_sender),
    sqlStr(inv.drive_file_link),
    sqlStr(inv.month_folder_link),
    sqlStr(inv.message_link),
    sqlTs(inv.received_at),
    sqlStr(inv.gmail_message_id),
    sqlStr(inv.ai_confidence),
    sqlTs(inv.transferred_at),
    sqlStr(inv.ai_missing_fields),
  ].join(', ') + ')'
)

const invSQL = [
  '-- Generated by migration/generate.cjs — DO NOT edit by hand.',
  `-- ${invoices.length} invoices from Airtable export.`,
  '-- IDs: year prefix from invoice_date (invoice\'s actual year), ordered by',
  '-- received_at ascending within each year: INV-YYYY-NNN.',
  '-- IDs are provided explicitly to override the table DEFAULT (invoices_seq is NOT advanced).',
  '',
  'BEGIN;',
  '',
  `INSERT INTO public.invoices (${invCols.join(', ')}) VALUES`,
  invRowsSorted.join(',\n') + ';',
  '',
  'COMMIT;',
  '',
].join('\n')

fs.writeFileSync(OUT_INVOICES, invSQL, 'utf8')

// ─── Report ────────────────────────────────────────────────────────────────
console.log(`Wrote ${OUT_SUPPLIERS}  (${suppliers.length} rows)`)
console.log(`Wrote ${OUT_INVOICES}  (${invoices.length} rows)`)
if (droppedDuplicates.length) {
  console.log(`\nDropped ${droppedDuplicates.length} duplicate-gmail_message_id row(s) per user decision:`)
  for (const d of droppedDuplicates) {
    console.log(`  gmail=${d.gmail_message_id}  inv#=${d.invoice_number}  supplier=${JSON.stringify(d.supplier_name)}`)
  }
}

// Invoice ID distribution per year
const yearCounts = new Map()
for (const inv of invoices) {
  const y = inv.id.split('-')[1]
  yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1)
}
console.log('\nInvoice IDs assigned:')
for (const [y, n] of [...yearCounts.entries()].sort()) {
  console.log(`  INV-${y}-001 .. INV-${y}-${String(n).padStart(3, '0')}  (${n} rows)`)
}

// transferred_at count check
const tCount = invoices.filter(i => i.transferred_at).length
console.log(`\ntransferred_at populated: ${tCount} / ${invoices.length} (expected 129)`)

console.log('\nCategory distribution after normalization (invoices):')
const cats = new Map()
for (const inv of invoices) cats.set(inv.category, (cats.get(inv.category) ?? 0) + 1)
for (const [c, n] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}× ${JSON.stringify(c)}`)
}

if (anomalies.length) {
  console.log('\n=== ANOMALIES ===')
  for (const a of anomalies) console.log(a)
} else {
  console.log('\nNo anomalies detected.')
}
