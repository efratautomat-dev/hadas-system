// Pre-flight inspection of suppliers + invoices CSV exports.
// Prints counts, samples, empty-required checks, and distinct categorical values.
// Run with: node inspect.cjs

const fs = require('fs')
const path = require('path')

const SUPPLIERS_PATH = path.join(__dirname, 'suppliers.csv.csv')
const INVOICES_PATH  = path.join(__dirname, 'invoices.csv.csv')

// Minimal RFC-4180 CSV parser that handles "" escaping and quoted commas.
function parseCSV(text) {
  // Strip a UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const rows = []
  let cur = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else { inQuotes = false }
      } else {
        field += c
      }
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        cur.push(field); field = ''
      } else if (c === '\n') {
        cur.push(field); field = ''
        rows.push(cur); cur = []
      } else if (c === '\r') {
        // skip
      } else {
        field += c
      }
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur) }
  return rows
}

function toObjects(rows) {
  const [header, ...data] = rows
  return data.map(r => {
    const o = {}
    header.forEach((h, i) => { o[h] = (r[i] ?? '').trim() })
    return o
  })
}

function distinct(records, col) {
  const m = new Map()
  for (const r of records) {
    const v = r[col] ?? ''
    m.set(v, (m.get(v) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

function inspectFile(label, p, requiredCols, distinctCols) {
  console.log(`\n=== ${label} :: ${path.basename(p)} ===`)
  const text = fs.readFileSync(p, 'utf8')
  const rows = parseCSV(text)
  if (rows.length === 0) { console.log('(empty)'); return }
  const header = rows[0]
  console.log('Columns (' + header.length + '):')
  header.forEach((h, i) => console.log(`  [${i}] ${JSON.stringify(h)}`))
  const records = toObjects(rows).filter(r => Object.values(r).some(v => v && v.length))
  console.log(`Data rows (non-empty): ${records.length}`)
  console.log(`File lines incl. header: ${rows.length}`)

  console.log('\nSample (first 3 records):')
  records.slice(0, 3).forEach((r, i) => {
    console.log(`-- row ${i + 1} --`)
    for (const [k, v] of Object.entries(r)) {
      if (v) console.log(`  ${k} = ${v.length > 120 ? v.slice(0, 120) + '…' : v}`)
    }
  })

  console.log('\nRequired-field check:')
  for (const c of requiredCols) {
    const missing = records.filter(r => !r[c] || !r[c].trim())
    console.log(`  ${c}: ${missing.length} row(s) empty`)
    if (missing.length > 0 && missing.length <= 5) {
      missing.forEach((m, i) => console.log(`    miss[${i}] keys-present=${Object.entries(m).filter(([_, v]) => v).map(([k]) => k).join('|')}`))
    }
  }

  console.log('\nDistinct values:')
  for (const c of distinctCols) {
    const d = distinct(records, c)
    console.log(`  ${c} (${d.length} distinct):`)
    d.slice(0, 30).forEach(([val, n]) => console.log(`    ${n.toString().padStart(4)}× ${JSON.stringify(val)}`))
    if (d.length > 30) console.log(`    … (+${d.length - 30} more)`)
  }
}

inspectFile(
  'SUPPLIERS',
  SUPPLIERS_PATH,
  ['שם ספק'],
  ['קטגוריה ברירת מחדל'],
)

inspectFile(
  'INVOICES',
  INVOICES_PATH,
  ['מספר חשבונית', 'שם ספק'],
  ['איכות פענוח', 'ai_confidence', 'קטגוריה', 'הועבר לרוח', 'החזר חלקי'],
)
