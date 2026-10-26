// ── בקרת תשומות — the accountant's input-VAT file against our month ─────────
//
// DEMO ONLY for now (26.10.2026): the owner wants to try it in the demo before the
// business sees it. Settings shows the tab under DEMO_MODE, so the production
// bundle folds the whole module away.
//
// "Our side" is the month's invoices — in the live system that is exactly what the
// month's Drive folder holds, since every filed invoice lands there. The
// accountant's side is whatever sheet she uploads; its columns are matched by
// header name (VAT_COLUMNS), because the real file's layout is not known yet and
// the owner's word was "תמציא עמודות".
//
// Matching, from the spec doc (בקרת דיווח מע"מ, 25.10):
//   1. supplier ח.פ + document number;
//   2. else supplier + date + amount within ±1 ₪.
// Six gap kinds: not reported, reported-but-missing, amount, duplicate, wrong
// month, credit note not offset.

import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'

export type GapKind = 'missing' | 'extra' | 'amount' | 'dup' | 'month' | 'credit'

export const GAP_LABEL: Record<GapKind, string> = {
  missing: 'לא דווח',
  extra:   'דווח ולא קיים',
  amount:  'הפרש סכום',
  dup:     'כפילות',
  month:   'חודש שגוי',
  credit:  'זיכוי לא קוזז',
}

export const GAP_TODO: Record<GapKind, string> = {
  missing: 'להעביר לרו״ח את המסמך ולדווח אותו',
  extra:   'לבדוק אם המסמך קיים / לבקש מהספק',
  amount:  'לתקן את הסכום בדיווח לפי המסמך',
  dup:     'למחוק את השורה הכפולה מהדיווח',
  month:   'לדווח בחודש של המסמך',
  credit:  'לקזז את הזיכוי בדיווח',
}

/** One document on our side. */
export interface OurDoc {
  id: string
  supplierId: string
  supplierName: string
  hp: string
  number: string
  date: string          // ISO
  net: number
  vat: number
  link: string
}

/** One row of the accountant's sheet, after column mapping. */
export interface CpaRow {
  row: number           // 1-based sheet row, for the report
  hp: string
  name: string
  number: string
  date: string          // ISO, '' when unreadable
  net: number
  vat: number
}

export interface DocLine {
  key: string
  number: string
  date: string
  ours: number | null
  cpa: number | null
  kind: GapKind | null
  link: string
  note?: string
}

export interface SupplierResult {
  key: string
  name: string
  hp: string
  docs: DocLine[]
  vatOurs: number
  vatCpa: number
}

export interface VatResult {
  period: string        // YYYY-MM
  fileName: string
  cpaRows: number
  ourDocs: number
  suppliers: SupplierResult[]
}

// ── Columns ──────────────────────────────────────────────────────────────────

export type Field = 'hp' | 'name' | 'number' | 'date' | 'net' | 'vat' | 'type'

export const FIELD_LABEL: Record<Field, string> = {
  hp: 'ח.פ ספק', name: 'שם ספק', number: 'מספר מסמך', date: 'תאריך מסמך',
  net: 'סכום לפני מע״מ', vat: 'מע״מ', type: 'סוג מסמך',
}

// Header spellings recognised per field. The first is what the sample file uses.
const VAT_COLUMNS: Record<Field, string[]> = {
  hp:     ['ח.פ. עוסק', 'ח.פ', 'חפ', 'עוסק מורשה', 'מספר עוסק', 'ח"פ'],
  name:   ['שם עוסק', 'שם ספק', 'ספק', 'שם'],
  number: ['אסמכתא', 'מספר מסמך', 'מס מסמך', 'מספר חשבונית', 'אסמכתה'],
  date:   ['ת. מסמך', 'תאריך מסמך', 'תאריך', 'תאריך חשבונית'],
  net:    ['סכום ללא מע"מ', 'סכום לפני מע"מ', 'סכום נטו', 'נטו'],
  vat:    ['מע"מ תשומות', 'מע"מ', 'סכום מע"מ'],
  type:   ['סוג', 'סוג מסמך'],
}

const norm = (s: unknown) => String(s ?? '').replace(/[״“”"'׳.\s]/g, '').trim()

export type Mapping = Partial<Record<Field, string>>

export function autoMap(headers: string[]): Mapping {
  const m: Mapping = {}
  for (const f of Object.keys(VAT_COLUMNS) as Field[]) {
    const wanted = VAT_COLUMNS[f].map(norm)
    const hit = headers.find(h => wanted.includes(norm(h)))
    if (hit) m[f] = hit
  }
  return m
}

export interface Sheet { headers: string[]; rows: Record<string, unknown>[] }

export async function readSheet(file: File): Promise<Sheet> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  const headers = rows.length ? Object.keys(rows[0]) : []
  return { headers, rows }
}

const toNum = (v: unknown) => {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(/[,\s₪]/g, '').replace(/−/g, '-'))
  return Number.isFinite(n) ? n : 0
}

/** Israeli sheets are day-first. Excel dates arrive as Date objects. */
function toIso(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000)
    return d.toISOString().slice(0, 10)
  }
  const s = String(v ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (!m) return ''
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

export function toCpaRows(sheet: Sheet, map: Mapping): CpaRow[] {
  const get = (r: Record<string, unknown>, f: Field) => (map[f] ? r[map[f]!] : '')
  return sheet.rows
    .map((r, i) => {
      const isCredit = /זיכוי/.test(String(get(r, 'type')))
      const sign = (n: number) => (isCredit && n > 0 ? -n : n)
      return {
        row: i + 2,
        hp: String(get(r, 'hp')).replace(/\D/g, ''),
        name: String(get(r, 'name')).trim(),
        number: String(get(r, 'number')).trim(),
        date: toIso(get(r, 'date')),
        net: sign(toNum(get(r, 'net'))),
        vat: sign(toNum(get(r, 'vat'))),
      }
    })
    .filter(r => r.number || r.vat)
}

// ── Matching ─────────────────────────────────────────────────────────────────

const docNo = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '')
const r2 = (n: number) => Math.round(n * 100) / 100

export function reconcile(
  period: string,
  fileName: string,
  ourAll: OurDoc[],
  cpa: CpaRow[],
): VatResult {
  const ours = ourAll.filter(d => d.date.startsWith(period))
  const used = new Set<string>()
  const lines: (DocLine & { sup: { name: string; hp: string; id: string } })[] = []
  const supOf = (d: OurDoc) => ({ name: d.supplierName, hp: d.hp, id: d.supplierId })
  const sameSupplier = (d: OurDoc, c: CpaRow) =>
    (c.hp && d.hp && docNo(c.hp) === docNo(d.hp)) || (!!c.name && norm(c.name) === norm(d.supplierName))
  const seen = new Set<string>()

  for (const c of cpa) {
    const dupKey = `${docNo(c.hp) || norm(c.name)}|${docNo(c.number)}`
    const cpaSup = { name: c.name || c.hp, hp: c.hp, id: `cpa:${c.hp || norm(c.name)}` }
    if (c.number && seen.has(dupKey)) {
      const first = ours.find(d => sameSupplier(d, c) && docNo(d.number) === docNo(c.number))
      lines.push({ key: `dup:${c.row}`, number: c.number, date: c.date, ours: null, cpa: c.vat,
        kind: 'dup', link: first?.link ?? '', sup: first ? supOf(first) : cpaSup, note: `שורה ${c.row} בקובץ` })
      continue
    }
    seen.add(dupKey)

    let hit = ours.find(d => !used.has(d.id) && c.number && sameSupplier(d, c) && docNo(d.number) === docNo(c.number))
    if (!hit) hit = ours.find(d => !used.has(d.id) && sameSupplier(d, c) && d.date === c.date && Math.abs(d.vat - c.vat) <= 1)
    if (hit) {
      used.add(hit.id)
      const kind: GapKind | null = Math.abs(hit.vat - c.vat) > 1 ? 'amount' : null
      lines.push({ key: hit.id, number: hit.number, date: hit.date, ours: hit.vat, cpa: c.vat, kind, link: hit.link, sup: supOf(hit) })
      continue
    }
    const elsewhere = ourAll.find(d => !d.date.startsWith(period) && sameSupplier(d, c) && c.number && docNo(d.number) === docNo(c.number))
    if (elsewhere) {
      lines.push({ key: `month:${c.row}`, number: c.number, date: elsewhere.date, ours: null, cpa: c.vat, kind: 'month',
        link: elsewhere.link, sup: supOf(elsewhere), note: `אצלנו בחודש ${elsewhere.date.slice(5, 7)}/${elsewhere.date.slice(0, 4)}` })
      continue
    }
    const known = ourAll.find(d => sameSupplier(d, c))
    lines.push({ key: `extra:${c.row}`, number: c.number, date: c.date, ours: null, cpa: c.vat, kind: 'extra', link: '',
      sup: known ? supOf(known) : cpaSup })
  }
  for (const d of ours) {
    if (used.has(d.id)) continue
    lines.push({ key: d.id, number: d.number, date: d.date, ours: d.vat, cpa: null,
      kind: d.vat < 0 ? 'credit' : 'missing', link: d.link, sup: supOf(d) })
  }

  const by = new Map<string, SupplierResult>()
  for (const l of lines) {
    const k = l.sup.id
    if (!by.has(k)) by.set(k, { key: k, name: l.sup.name, hp: l.sup.hp, docs: [], vatOurs: 0, vatCpa: 0 })
    const s = by.get(k)!
    const { sup: _sup, ...line } = l
    void _sup
    s.docs.push(line)
    if (l.kind !== 'dup') s.vatOurs = r2(s.vatOurs + (l.ours ?? 0))
    s.vatCpa = r2(s.vatCpa + (l.cpa ?? 0))
  }
  for (const s of by.values()) s.docs.sort((a, b) => a.date.localeCompare(b.date))
  const suppliers = [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'))
  return { period, fileName, cpaRows: cpa.length, ourDocs: ours.length, suppliers }
}

// ── The demo's sample accountant file ────────────────────────────────────────
//
// A demo visitor has no accountant. This builds the sheet one would have sent for
// the month — every document, in the accountant's own column names — and plants
// one gap of each kind the month can show, so the result screen has something
// to say. The visitor can download it, look at it, and upload it back.

export function sampleCpaSheet(period: string, ourAll: OurDoc[]): Sheet {
  const ours = ourAll.filter(d => d.date.startsWith(period))
  const prev = ourAll.filter(d => d.date < `${period}-01`).sort((a, b) => b.date.localeCompare(a.date))[0]
  const H = VAT_COLUMNS
  const line = (d: { hp: string; supplierName: string; number: string; date: string; net: number; vat: number }) => ({
    [H.hp[0]]: d.hp, [H.name[0]]: d.supplierName, [H.number[0]]: d.number,
    [H.date[0]]: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}/${d.date.slice(0, 4)}`,
    [H.net[0]]: r2(Math.abs(d.net)), [H.vat[0]]: r2(Math.abs(d.vat)), [H.type[0]]: d.vat < 0 ? 'זיכוי' : 'חשבונית',
  })
  const rows: Record<string, unknown>[] = []
  ours.forEach((d, i) => {
    if (i === 1) return                                   // not reported
    if (d.vat < 0) return                                 // credit not offset
    if (i === 2) { rows.push(line({ ...d, vat: r2(d.vat * 1.5), net: d.net })); return }   // amount
    rows.push(line(d))
    if (i === 3) rows.push(line(d))                       // duplicate
  })
  if (prev) rows.push(line({ ...prev, date: `${period}-02` }))                             // wrong month
  const any = ours[0]
  if (any) rows.push(line({ ...any, number: String(90000 + ours.length), net: 1000, vat: 180 })) // reported, missing
  return { headers: Object.values(H).map(c => c[0]), rows }
}

export function sheetToXlsx(sheet: Sheet, name = 'תשומות'): Blob {
  const ws = XLSX.utils.json_to_sheet(sheet.rows, { header: sheet.headers })
  ws['!cols'] = sheet.headers.map(() => ({ wch: 16 }))
  const wb = XLSX.utils.book_new()
  wb.Workbook = { Views: [{ RTL: true }] }
  XLSX.utils.book_append_sheet(wb, ws, name)
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ── The report ───────────────────────────────────────────────────────────────

export const monthLabel = (period: string) => {
  const M = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
  return `${M[Number(period.slice(5, 7)) - 1] ?? ''} ${period.slice(0, 4)}`
}
export const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—')

/**
 * The file that goes to the accountant. Three sheets — summary, open gaps (each
 * with what to do and a link to the document), and every supplier. `open` decides
 * which gaps are still open: a gap she marked handled leaves the file, so the
 * accountant gets only what is still hers to fix.
 */
export async function buildReport(
  res: VatResult,
  isOpen: (supplierKey: string, line: DocLine) => boolean,
  opts: { business: string; onlySupplier?: string; notes?: Record<string, string> },
): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  const sups = res.suppliers.filter(s => !opts.onlySupplier || s.key === opts.onlySupplier)
  const head = (ws: ExcelJS.Worksheet) => {
    const r = ws.getRow(1)
    r.font = { bold: true }
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
  }
  const gaps = sups.flatMap(s => s.docs.filter(d => d.kind && isOpen(s.key, d)).map(d => ({ s, d })))
  const vatO = r2(sups.reduce((a, s) => a + s.vatOurs, 0))
  const vatC = r2(sups.reduce((a, s) => a + s.vatCpa, 0))

  const sum = wb.addWorksheet('סיכום', { views: [{ rightToLeft: true }] })
  sum.columns = [{ width: 26 }, { width: 44 }]
  sum.addRows([
    [`בקרת תשומות — ${monthLabel(res.period)}${opts.onlySupplier && sups[0] ? ` — ${sups[0].name}` : ''}`],
    ['עסק', opts.business],
    ['קובץ הרו״ח', `${res.fileName} · ${res.cpaRows} שורות`],
    ['מסמכים אצלנו בחודש', res.ourDocs],
    ['מע״מ תשומות אצלנו', vatO],
    ['מע״מ תשומות אצל הרו״ח', vatC],
    ['הפרש', r2(vatO - vatC)],
    ['פערים פתוחים', gaps.length],
    ['הופק', new Date().toLocaleString('he-IL')],
  ])
  sum.getRow(1).font = { bold: true, size: 14 }

  const g = wb.addWorksheet('פערים', { views: [{ rightToLeft: true }] })
  g.columns = [
    { header: 'ספק', width: 26 }, { header: 'ח.פ', width: 12 }, { header: 'מס׳ מסמך', width: 12 },
    { header: 'תאריך', width: 12 }, { header: 'סוג פער', width: 14 }, { header: 'מע״מ אצלנו', width: 13 },
    { header: 'מע״מ אצל הרו״ח', width: 15 }, { header: 'הפרש', width: 11 }, { header: 'מה לעשות', width: 38 },
    { header: 'הערה', width: 30 }, { header: 'קישור למסמך', width: 18 },
  ]
  head(g)
  for (const { s, d } of gaps) {
    const row = g.addRow([
      s.name, s.hp, d.number, dmy(d.date), GAP_LABEL[d.kind!], d.ours ?? '—', d.cpa ?? '—',
      r2((d.ours ?? 0) - (d.cpa ?? 0)), GAP_TODO[d.kind!], [d.note, opts.notes?.[s.key]].filter(Boolean).join(' · '),
      d.link ? { text: 'פתיחה', hyperlink: d.link } : '—',
    ])
    if (d.link) row.getCell(11).font = { color: { argb: 'FF1D4ED8' }, underline: true }
  }

  const a = wb.addWorksheet('כל הספקים', { views: [{ rightToLeft: true }] })
  a.columns = [
    { header: 'ספק', width: 26 }, { header: 'ח.פ', width: 12 }, { header: 'מסמכים אצלנו', width: 13 },
    { header: 'אצל הרו״ח', width: 11 }, { header: 'מע״מ אצלנו', width: 13 }, { header: 'מע״מ אצל הרו״ח', width: 15 },
    { header: 'הפרש', width: 11 }, { header: 'מצב', width: 12 },
  ]
  head(a)
  for (const s of sups) {
    const open = s.docs.filter(d => d.kind && isOpen(s.key, d)).length
    a.addRow([s.name, s.hp, s.docs.filter(d => d.ours != null).length, s.docs.filter(d => d.cpa != null).length,
      s.vatOurs, s.vatCpa, r2(s.vatOurs - s.vatCpa), open ? `לא תואם · ${open}` : 'תואם'])
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
