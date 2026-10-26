import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, Mail, FileSpreadsheet, CheckCircle2, AlertTriangle, X, Download, Eye } from 'lucide-react'
import { SectionCard } from './ui/form'
import { Button } from './ui/Button'
import { useInvoices } from '../hooks/useInvoices'
import { useSuppliers } from '../hooks/useSuppliers'
import { saveOrShareFile, openExternal } from '../lib/native'
import { STATUS } from '../theme/status'
import { brand } from '../brand.config'
import {
  GAP_LABEL, GAP_TODO, FIELD_LABEL, autoMap, readSheet, toCpaRows, reconcile, sampleCpaSheet,
  sheetToXlsx, buildReport, monthLabel, dmy,
  type Field, type Mapping, type Sheet, type OurDoc, type VatResult, type DocLine, type GapKind,
} from '../lib/vatControl'

// ── Settings → בקרת תשומות (DEMO ONLY) ───────────────────────────────────────
//
// Built to the approved mockup (https://claude.ai/artifact/7XfferxpHGsSMRwVMVNdUF,
// 26.10.2026). The comparison runs in the browser against the month's invoices;
// marks ("טופל", "לחודש הבא") and the run history live in sessionStorage — the
// demo has no table for them, and the live version will need one.

const HAIRLINE = '#E2E4E9'
const fmt = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const KIND_COLOR: Record<GapKind, { bg: string; fg: string }> = {
  missing: STATUS.red, extra: STATUS.blue, amount: STATUS.orange,
  dup: { bg: '#EDE9FE', fg: '#5B21B6' }, month: STATUS.gray, credit: { bg: '#CFFAFE', fg: '#155E75' },
}

type Mark = 'ok' | 'next'
interface HistoryRow { period: string; source: string; at: string; open: number }

function load<T>(key: string, fallback: T): T {
  try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback }
}
function save(key: string, v: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(v)) } catch { /* private mode: marks just won't survive a reload */ }
}

function Pill({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return <span className="text-xs font-bold rounded-lg px-2 py-1 whitespace-nowrap" style={{ background: bg, color: fg }}>{children}</span>
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="bg-white rounded-2xl border p-3.5" style={{ borderColor: HAIRLINE }}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-extrabold mt-0.5" style={{ color: tone ?? '#1F2937', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

export default function VatControlPanel() {
  const { data: invoices } = useInvoices()
  const { data: suppliers } = useSuppliers()

  // Our side: every filed invoice, with the supplier's ח.פ attached.
  const ourAll: OurDoc[] = useMemo(() => {
    const hpOf = new Map(suppliers.map(s => [s.id, String((s as { hp?: string }).hp ?? '')]))
    return invoices
      .filter(i => !i.isDuplicate && !i.hasError && /^\d{4}-\d{2}-\d{2}/.test(i.invoiceDate ?? ''))
      .map(i => ({
        id: i.id, supplierId: i.supplierId, supplierName: i.supplier, hp: hpOf.get(i.supplierId) ?? '',
        number: String(i.invoiceNumber ?? ''), date: i.invoiceDate.slice(0, 10),
        net: Number(i.amountBeforeVat) || 0, vat: Number(i.vat) || 0, link: i.driveFileLink || '',
      }))
  }, [invoices, suppliers])

  const months = useMemo(() => [...new Set(ourAll.map(d => d.date.slice(0, 7)))].sort().reverse(), [ourAll])
  const [period, setPeriod] = useState('')
  const per = period || months[0] || ''

  const [auto, setAuto] = useState(() => load('vat.auto', true))
  const [sender, setSender] = useState(() => load('vat.sender', 'office@cpa-example.co.il'))
  useEffect(() => { save('vat.auto', auto); save('vat.sender', sender) }, [auto, sender])

  const [file, setFile] = useState<{ name: string; sheet: Sheet } | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [result, setResult] = useState<VatResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [marks, setMarks] = useState<Record<string, Mark>>(() => load('vat.marks', {}))
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<HistoryRow[]>(() => load('vat.history', []))
  const [filter, setFilter] = useState<'bad' | 'ok' | 'all'>('bad')
  const [openSup, setOpenSup] = useState<string | null>(null)
  const [report, setReport] = useState<null | 'summary' | 'gaps' | 'all'>(null)
  const [toast, setToast] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  useEffect(() => save('vat.marks', marks), [marks])
  useEffect(() => save('vat.history', history), [history])

  function flash(t: string) {
    setToast(t)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2800)
  }

  const markKey = (supKey: string, d: DocLine) => `${result?.period}|${supKey}|${d.key}`
  const isOpen = (supKey: string, d: DocLine) => !!d.kind && !marks[markKey(supKey, d)]

  function takeSheet(name: string, sheet: Sheet) {
    setFile({ name, sheet })
    setMapping(autoMap(sheet.headers))
    setResult(null)
    setErr(sheet.rows.length ? null : 'הקובץ ריק — אין בו שורות')
  }

  async function onPick(f: File | undefined) {
    if (!f) return
    try { takeSheet(f.name, await readSheet(f)); setSample(null) } catch { setErr('לא הצלחתי לקרוא את הקובץ. צריך קובץ Excel או CSV.') }
  }

  // Which built-in sample is loaded, if any — the demo's "עם פערים / הכל תואם"
  // switch swaps between the two and re-runs, so both outcomes can be shown.
  const [sample, setSample] = useState<null | 'gaps' | 'ok'>(null)
  const sampleName = () => `תשומות_${per.slice(5, 7)}-${per.slice(0, 4)}.xlsx`

  function loadSample(kind: 'gaps' | 'ok', andRun = false) {
    const sheet = sampleCpaSheet(per, ourAll, kind === 'ok')
    takeSheet(sampleName(), sheet)
    setSample(kind)
    if (andRun) run('קובץ לדוגמה', { name: sampleName(), sheet }, autoMap(sheet.headers))
  }

  async function downloadSample() {
    await saveOrShareFile(`תשומות_לדוגמה_${per}.xlsx`, sheetToXlsx(sampleCpaSheet(per, ourAll, sample === 'ok')))
  }

  function run(source = 'העלאה ידנית', f = file, map = mapping) {
    if (!f) return
    const missing = (['number', 'vat'] as Field[]).filter(k => !map[k])
    if (missing.length) { setErr(`חסר מיפוי ל: ${missing.map(k => FIELD_LABEL[k]).join(', ')}`); return }
    const res = reconcile(per, f.name, ourAll, toCpaRows(f.sheet, map))
    setResult(res)
    setOpenSup(null)
    setFilter(res.suppliers.some(x => x.docs.some(d => d.kind)) ? 'bad' : 'all')
    const open = res.suppliers.reduce((a, s) => a + s.docs.filter(d => d.kind).length, 0)
    setHistory(h => [{ period: per, source, at: new Date().toISOString(), open }, ...h.filter(x => x.period !== per)].slice(0, 12))
    flash(open ? `הבדיקה הסתיימה — נמצאו ${open} פערים` : 'הבדיקה הסתיימה — הכל תואם')
  }

  async function download(onlySupplier?: string) {
    if (!result) return
    const blob = await buildReport(result, isOpen, { business: brand.appName, onlySupplier, notes })
    const sup = onlySupplier ? result.suppliers.find(s => s.key === onlySupplier) : null
    const name = `בקרת_תשומות_${result.period}${sup ? `_${sup.name.replace(/[\\/:*?"<>|]/g, '')}` : ''}.xlsx`
    await saveOrShareFile(name, blob)
  }

  const rows = useMemo(() => (result?.suppliers ?? []).map(s => {
    const open = s.docs.filter(d => isOpen(s.key, d)).length
    return { ...s, open, had: s.docs.some(d => d.kind), diff: Math.round((s.vatOurs - s.vatCpa) * 100) / 100 }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [result, marks])
  const bad = rows.filter(r => r.open > 0)
  const openCount = bad.reduce((a, r) => a + r.open, 0)
  const vatOurs = rows.reduce((a, r) => a + r.vatOurs, 0)
  const vatCpa = rows.reduce((a, r) => a + r.vatCpa, 0)
  const shown = rows.filter(r => filter === 'all' || (filter === 'bad') === (r.open > 0))
  const cur = rows.find(r => r.key === openSup) ?? null

  const mappedCount = (Object.keys(FIELD_LABEL) as Field[]).filter(f => mapping[f]).length

  return (
    <div className="space-y-4" style={{ direction: 'rtl' }}>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-extrabold text-gray-800">בקרת תשומות</h2>
          <p className="text-sm text-gray-500 mt-0.5">השוואת קובץ התשומות של הרו״ח מול המסמכים בתיקיית הדרייב של החודש</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">תקופת דיווח
          <select
            value={per}
            onChange={e => { setPeriod(e.target.value); setResult(null) }}
            className="rounded-xl border px-3 py-2 text-sm bg-white" style={{ borderColor: '#D1D5DB', minWidth: 170 }}
          >
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>

      {/* ── המקור ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <SectionCard>
          <div className="flex items-center gap-2 mb-3">
            <Upload className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
            <h3 className="font-extrabold text-gray-800">העלאת קובץ מהרו״ח</h3>
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { void onPick(e.target.files?.[0]); e.target.value = '' }} />
          {!file ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); void onPick(e.dataTransfer.files?.[0]) }}
              className="w-full rounded-2xl flex flex-col items-center gap-1.5 py-7 text-sm text-gray-600"
              style={{ border: '2px dashed #D1D5DB', background: '#FAFAFB' }}
            >
              <span className="font-bold" style={{ color: 'var(--brand-primary)' }}>בחרי קובץ אקסל או גררי לכאן</span>
              <span className="text-xs" dir="ltr">.xlsx / .xls / .csv</span>
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
              <FileSpreadsheet className="w-6 h-6" style={{ color: STATUS.green.fg }} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{file.name}</div>
                <div className="text-xs text-gray-600">{file.sheet.rows.length} שורות</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setFile(null); setResult(null) }}>החלפה</Button>
            </div>
          )}
          <div className="text-xs text-gray-500 mt-3 leading-relaxed">
            אין קובץ בהישג יד? קובץ לדוגמה:{' '}
            <button type="button" className="font-bold underline" style={{ color: 'var(--brand-primary)' }} onClick={() => loadSample('gaps')}>עם פערים</button>
            {' · '}
            <button type="button" className="font-bold underline" style={{ color: 'var(--brand-primary)' }} onClick={() => loadSample('ok')}>הכל תואם</button>
            {' · '}
            <button type="button" className="font-bold underline" style={{ color: 'var(--brand-primary)' }} onClick={() => void downloadSample()}>להוריד אותו</button>
          </div>
        </SectionCard>

        <SectionCard>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
              <h3 className="font-extrabold text-gray-800">קליטה אוטומטית מהמייל</h3>
            </div>
            <button
              type="button" role="switch" aria-checked={auto} aria-label="הפעלת קליטה אוטומטית"
              onClick={() => setAuto(a => !a)}
              className="relative rounded-full" style={{ width: 48, height: 28, background: auto ? 'var(--brand-primary)' : '#D1D5DB' }}
            >
              <span className="absolute rounded-full bg-white shadow" style={{ top: 3, width: 22, height: 22, [auto ? 'left' : 'right']: 3 }} />
            </button>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">כתובת השולח (הרו״ח)
            <input type="email" dir="ltr" value={sender} onChange={e => setSender(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: '#D1D5DB' }} />
          </label>
          <p className="text-xs text-gray-600 mt-3 leading-relaxed">
            {auto
              ? 'פעיל. קובץ אקסל שמגיע מהכתובת הזו נקלט ונבדק לבד, ואם יש פערים נשלחת התראה במייל. (בדמו אין מייל אמיתי.)'
              : 'כבוי. הקבצים יועלו ידנית.'}
          </p>
        </SectionCard>
      </div>

      {err && (
        <div className="rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: STATUS.red.bg, color: STATUS.red.fg }}>{err}</div>
      )}

      {/* ── מיפוי עמודות ── */}
      {file && (
        <SectionCard>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div>
              <h3 className="font-extrabold text-gray-800">מיפוי עמודות</h3>
              <p className="text-xs text-gray-500">נשמר פעם אחת. בקובץ הבא מאותו רו״ח זה ייעשה לבד.</p>
            </div>
            <Pill bg={mappedCount >= 6 ? STATUS.green.bg : STATUS.orange.bg} fg={mappedCount >= 6 ? STATUS.green.fg : STATUS.orange.fg}>
              זוהה אוטומטית · {mappedCount} מתוך 7
            </Pill>
          </div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {(Object.keys(FIELD_LABEL) as Field[]).map(f => (
              <label key={f} className="rounded-xl border p-2.5 flex flex-col gap-1.5 text-xs text-gray-500" style={{ borderColor: '#EEF0F3' }}>
                {FIELD_LABEL[f]}
                <select
                  value={mapping[f] ?? ''}
                  onChange={e => setMapping(m => ({ ...m, [f]: e.target.value || undefined }))}
                  className="rounded-lg border px-2 py-1.5 text-sm text-gray-800 bg-white" style={{ borderColor: '#D1D5DB' }}
                >
                  <option value="">— לא בשימוש —</option>
                  {file.sheet.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-4">
            <Button onClick={() => run()}>הרצת בדיקה מול הדרייב</Button>
            <span className="text-xs text-gray-500">
              תיקיית הדרייב של {monthLabel(per)} — {ourAll.filter(d => d.date.startsWith(per)).length} מסמכים
            </span>
          </div>
        </SectionCard>
      )}

      {/* ── התוצאה ── */}
      {result && sample && (
        <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-500">
          <span>להדגמה:</span>
          {([['gaps', 'עם פערים'], ['ok', 'הכל תואם']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => loadSample(k, true)}
              className="rounded-lg px-2.5 py-1.5 font-bold bg-white"
              style={{ border: `1px solid ${sample === k ? 'var(--brand-primary)' : '#D1D5DB'}`, color: sample === k ? 'var(--brand-primary)' : '#374151' }}>
              {l}
            </button>
          ))}
        </div>
      )}

      {result && (openCount === 0 ? (
        <div className="rounded-2xl p-5 flex items-center gap-4 flex-wrap" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
          <CheckCircle2 className="w-9 h-9" style={{ color: STATUS.green.fg }} />
          <div className="flex-1" style={{ minWidth: 220 }}>
            <div className="text-lg font-extrabold" style={{ color: '#14532D' }}>הכל תואם — {monthLabel(result.period)}</div>
            <div className="text-sm" style={{ color: STATUS.green.fg }}>
              {result.ourDocs} מסמכים בדרייב, {result.cpaRows} בקובץ הרו״ח. מע״מ תשומות: {fmt(vatOurs)} ₪ אצלנו, {fmt(vatCpa)} ₪ אצל הרו״ח.
            </div>
          </div>
          <Button variant="outline" onClick={() => setReport('summary')}><Eye className="w-4 h-4 inline ml-1" />צפייה בדוח</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl p-5 flex items-center gap-4 flex-wrap" style={{ background: '#FFF7ED', border: '1px solid #FED7AA' }}>
            <AlertTriangle className="w-9 h-9" style={{ color: STATUS.orange.fg }} />
            <div className="flex-1" style={{ minWidth: 220 }}>
              <div className="text-lg font-extrabold" style={{ color: '#7C2D12' }}>
                לא תואם — {bad.length} ספקים עם פערים, {openCount} פערים פתוחים
              </div>
              <div className="text-sm" style={{ color: '#9A3412' }}>
                הפרש במע״מ תשומות: {fmt(Math.round((vatOurs - vatCpa) * 100) / 100)} ₪{auto ? ' · נשלחה התראה במייל' : ''}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setReport('gaps')}><Eye className="w-4 h-4 inline ml-1" />צפייה בדוח</Button>
              <Button onClick={() => void download()}><Download className="w-4 h-4 inline ml-1" />הורדת קובץ לרו״ח</Button>
            </div>
          </div>

          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Stat label="בתיקיית הדרייב" value={result.ourDocs} />
            <Stat label="בקובץ הרו״ח" value={result.cpaRows} />
            <Stat label="ספקים תואמים" value={`${rows.length - bad.length} / ${rows.length}`} tone={STATUS.green.fg} />
            <Stat label="מע״מ אצלנו / אצל הרו״ח" value={<span className="text-base">{fmt(vatOurs)} / {fmt(vatCpa)}</span>} />
          </div>

        </div>
      ))}
      {result && (
      <SectionCard>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h3 className="font-extrabold text-gray-800">התאמה לפי ספק</h3>
          <div className="flex gap-1.5 flex-wrap">
            {([['bad', 'לא תואם', bad.length], ['ok', 'תואם', rows.length - bad.length], ['all', 'הכל', rows.length]] as const).map(([k, l, n]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className="text-sm rounded-full px-3 py-1.5"
                style={filter === k
                  ? { background: 'var(--brand-primary)', color: 'white', border: '1px solid var(--brand-primary)' }
                  : { background: 'white', color: '#374151', border: '1px solid #D1D5DB' }}
              >{l} · {n}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="text-xs text-gray-500 text-right">
                {['ספק', 'ח.פ', 'מסמכים אצלנו', 'אצל הרו״ח', 'מע״מ אצלנו', 'מע״מ אצל הרו״ח', 'הפרש', 'מצב', ''].map(h =>
                  <th key={h} className="font-semibold px-3 py-2 whitespace-nowrap" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.key} onClick={() => setOpenSup(r.key)} className="cursor-pointer hover:bg-gray-50"
                  style={{ background: openSup === r.key ? '#FDF2F4' : undefined }}>
                  <td className="px-3 py-2.5 font-bold" style={{ borderBottom: '1px solid #EEF0F3' }}>{r.name}</td>
                  <td className="px-3 py-2.5" dir="ltr" style={{ borderBottom: '1px solid #EEF0F3', textAlign: 'right' }}>{r.hp || '—'}</td>
                  <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #EEF0F3' }}>{r.docs.filter(d => d.ours != null).length}</td>
                  <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #EEF0F3' }}>{r.docs.filter(d => d.cpa != null).length}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid #EEF0F3' }}>{fmt(r.vatOurs)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid #EEF0F3' }}>{fmt(r.vatCpa)}</td>
                  <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ borderBottom: '1px solid #EEF0F3', color: r.diff === 0 ? STATUS.green.fg : STATUS.red.fg }}>{fmt(r.diff)}</td>
                  <td className="px-3 py-2.5" style={{ borderBottom: '1px solid #EEF0F3' }}>
                    {r.open > 0
                      ? <Pill {...STATUS.red}>לא תואם · {r.open}</Pill>
                      : <Pill {...STATUS.green}>{r.had ? 'טופל' : 'תואם'}</Pill>}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-bold whitespace-nowrap" style={{ borderBottom: '1px solid #EEF0F3', color: 'var(--brand-primary)' }}>פירוט ←</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">אין ספקים בסינון הזה</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2">לחיצה על שורה פותחת את פירוט הפערים של הספק.</p>
      </SectionCard>
      )}


      {/* ── בדיקות קודמות ── */}
      <SectionCard title="בדיקות קודמות">
        {history.length === 0 ? (
          <p className="text-sm text-gray-400">עוד לא הורצה בדיקה.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500 text-right">
                {['תקופה', 'מקור', 'נבדק', 'תוצאה'].map(h => <th key={h} className="font-semibold px-3 py-2">{h}</th>)}
              </tr></thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.period + h.at}>
                    <td className="px-3 py-2">{monthLabel(h.period)}</td>
                    <td className="px-3 py-2">{h.source}</td>
                    <td className="px-3 py-2">{new Date(h.at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="px-3 py-2 font-bold" style={{ color: h.open ? STATUS.orange.fg : STATUS.green.fg }}>
                      {h.open ? `${h.open} פערים` : 'הכל תואם'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── פירוט ספק ── */}
      {cur && result && (
        <div className="fixed inset-0 z-50 flex" style={{ background: 'rgba(17,24,39,.45)' }} onClick={() => setOpenSup(null)}>
          <div
            className="h-full overflow-y-auto p-5 space-y-4" dir="rtl"
            style={{ background: '#F4F5F8', width: 'min(760px, 100%)', boxShadow: '-8px 0 24px rgba(0,0,0,.15)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <div className="text-xs text-gray-500">בקרת תשומות · {monthLabel(result.period)}</div>
                <div className="text-xl font-extrabold">{cur.name}</div>
                {cur.hp && <div className="text-sm text-gray-600">ח.פ {cur.hp}</div>}
              </div>
              <button type="button" onClick={() => setOpenSup(null)} aria-label="סגירה"
                className="rounded-xl border bg-white flex items-center justify-center" style={{ width: 44, height: 44, borderColor: '#D1D5DB' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <Stat label="מע״מ אצלנו" value={fmt(cur.vatOurs)} />
              <Stat label="מע״מ אצל הרו״ח" value={fmt(cur.vatCpa)} />
              <Stat label="הפרש" value={fmt(cur.diff)} tone={cur.diff === 0 ? STATUS.green.fg : STATUS.red.fg} />
            </div>
            <SectionCard title="מסמכים בחודש — השוואה שורה מול שורה">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-500 text-right">
                    {['מס׳ מסמך', 'תאריך', 'אצלנו (מע״מ)', 'אצל הרו״ח (מע״מ)', 'תוצאה', ''].map(h => <th key={h} className="font-semibold px-2 py-2 whitespace-nowrap">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {cur.docs.map(d => {
                      const m = marks[markKey(cur.key, d)]
                      return (
                        <tr key={d.key} style={{ opacity: m ? 0.55 : 1 }}>
                          <td className="px-2 py-2 font-semibold" dir="ltr" style={{ textAlign: 'right' }}>{d.number || '—'}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{dmy(d.date)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{fmt(d.ours)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{fmt(d.cpa)}</td>
                          <td className="px-2 py-2">
                            {d.kind
                              ? <Pill {...KIND_COLOR[d.kind]}>{GAP_LABEL[d.kind]}{m ? ` · ${m === 'next' ? 'לחודש הבא' : 'טופל'}` : ''}</Pill>
                              : <Pill {...STATUS.green}>תואם</Pill>}
                            {d.note && <div className="text-xs text-gray-500 mt-1">{d.note}</div>}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex gap-1.5">
                              {d.link && <Button size="sm" variant="outline" onClick={() => void openExternal(d.link)}>מסמך</Button>}
                              {d.kind && (
                                <Button size="sm" variant="outline" onClick={() => setMarks(ms => {
                                  const k = markKey(cur.key, d); const n = { ...ms }
                                  if (n[k]) delete n[k]; else n[k] = d.kind === 'month' ? 'next' : 'ok'
                                  return n
                                })}>{m ? 'ביטול' : d.kind === 'month' ? 'לחודש הבא' : 'סמני טופל'}</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
            {cur.docs.some(d => d.kind) && (
              <SectionCard title="מה לעשות">
                <ul className="text-sm text-gray-700 leading-relaxed list-disc pr-5 space-y-1">
                  {cur.docs.filter(d => d.kind).map(d => (
                    <li key={d.key}><b>{d.number || 'ללא מספר'}</b> — {GAP_LABEL[d.kind!]}: {GAP_TODO[d.kind!]}</li>
                  ))}
                </ul>
              </SectionCard>
            )}
            <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">הערה לרו״ח (תיכנס לקובץ)
              <input type="text" value={notes[cur.key] ?? ''} placeholder="למשל: החשבונית נשלחה אליך ב-12.10"
                onChange={e => setNotes(n => ({ ...n, [cur.key]: e.target.value }))}
                className="rounded-xl border px-3 py-2 text-sm bg-white" style={{ borderColor: '#D1D5DB' }} />
            </label>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={() => void download(cur.key)}><Download className="w-4 h-4 inline ml-1" />הורדת קובץ לרו״ח — הספק הזה</Button>
              <Button variant="outline" onClick={() => setReport('gaps')}>צפייה בדוח המלא</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── הדוח: תצוגה מקדימה של הקובץ ── */}
      {report && result && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(17,24,39,.5)' }} onClick={() => setReport(null)}>
          <div className="bg-white rounded-2xl w-full flex flex-col overflow-hidden" dir="rtl"
            style={{ maxWidth: 1000, maxHeight: '92vh', boxShadow: '0 16px 40px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3.5" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-6 h-6" style={{ color: STATUS.green.fg }} />
                <div>
                  <div className="font-extrabold text-sm">בקרת_תשומות_{result.period}.xlsx</div>
                  <div className="text-xs text-gray-500">תצוגה מקדימה — כך ייראה הקובץ שיורד</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void download()}>הורדה</Button>
                <Button size="sm" variant="outline" onClick={() => setReport(null)}>סגירה</Button>
              </div>
            </div>
            <div className="overflow-auto p-4 flex-1 text-sm">
              {report === 'summary' && (
                <table style={{ borderCollapse: 'collapse', minWidth: 560 }}>
                  <tbody>
                    {([
                      [`בקרת תשומות — ${monthLabel(result.period)}`, ''],
                      ['עסק', brand.appName],
                      ['קובץ הרו״ח', `${result.fileName} · ${result.cpaRows} שורות`],
                      ['מסמכים אצלנו בחודש', String(result.ourDocs)],
                      ['מע״מ תשומות אצלנו', fmt(vatOurs)],
                      ['מע״מ תשומות אצל הרו״ח', fmt(vatCpa)],
                      ['הפרש', fmt(Math.round((vatOurs - vatCpa) * 100) / 100)],
                      ['פערים פתוחים', String(openCount)],
                    ] as const).map(([a, b], i) => (
                      <tr key={a}>
                        <td className="border px-2.5 py-1.5" style={{ fontWeight: i === 0 ? 800 : 400, background: i === 0 ? '#F9FAFB' : undefined }} colSpan={i === 0 ? 2 : 1}>{a}</td>
                        {i > 0 && <td className="border px-2.5 py-1.5">{b}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {report === 'gaps' && (
                <table style={{ borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead><tr>
                    {['ספק', 'ח.פ', 'מס׳ מסמך', 'תאריך', 'סוג פער', 'מע״מ אצלנו', 'מע״מ אצל הרו״ח', 'הפרש', 'מה לעשות', 'קישור למסמך'].map(h =>
                      <th key={h} className="border px-2.5 py-1.5 text-right" style={{ background: '#F3F4F6' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.flatMap(s => s.docs.filter(d => isOpen(s.key, d)).map(d => (
                      <tr key={s.key + d.key}>
                        <td className="border px-2.5 py-1.5">{s.name}</td>
                        <td className="border px-2.5 py-1.5" dir="ltr">{s.hp}</td>
                        <td className="border px-2.5 py-1.5" dir="ltr">{d.number}</td>
                        <td className="border px-2.5 py-1.5 whitespace-nowrap">{dmy(d.date)}</td>
                        <td className="border px-2.5 py-1.5 font-bold">{GAP_LABEL[d.kind!]}</td>
                        <td className="border px-2.5 py-1.5">{fmt(d.ours)}</td>
                        <td className="border px-2.5 py-1.5">{fmt(d.cpa)}</td>
                        <td className="border px-2.5 py-1.5">{fmt(Math.round(((d.ours ?? 0) - (d.cpa ?? 0)) * 100) / 100)}</td>
                        <td className="border px-2.5 py-1.5" style={{ minWidth: 180 }}>{GAP_TODO[d.kind!]}</td>
                        <td className="border px-2.5 py-1.5" style={{ color: '#1D4ED8', textDecoration: d.link ? 'underline' : undefined }}>{d.link ? 'פתיחה' : '—'}</td>
                      </tr>
                    )))}
                    {openCount === 0 && <tr><td colSpan={10} className="border px-2.5 py-4 text-center text-gray-400">אין פערים פתוחים</td></tr>}
                  </tbody>
                </table>
              )}
              {report === 'all' && (
                <table style={{ borderCollapse: 'collapse', minWidth: 620 }}>
                  <thead><tr>
                    {['ספק', 'מסמכים אצלנו', 'אצל הרו״ח', 'מע״מ אצלנו', 'מע״מ אצל הרו״ח', 'מצב'].map(h =>
                      <th key={h} className="border px-2.5 py-1.5 text-right" style={{ background: '#F3F4F6' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.key}>
                        <td className="border px-2.5 py-1.5">{r.name}</td>
                        <td className="border px-2.5 py-1.5">{r.docs.filter(d => d.ours != null).length}</td>
                        <td className="border px-2.5 py-1.5">{r.docs.filter(d => d.cpa != null).length}</td>
                        <td className="border px-2.5 py-1.5">{fmt(r.vatOurs)}</td>
                        <td className="border px-2.5 py-1.5">{fmt(r.vatCpa)}</td>
                        <td className="border px-2.5 py-1.5 font-bold">{r.open ? `לא תואם · ${r.open}` : 'תואם'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex gap-0.5 px-4" style={{ background: '#F3F4F6', borderTop: `1px solid ${HAIRLINE}` }}>
              {([['summary', 'סיכום'], ['gaps', `פערים (${openCount})`], ['all', 'כל הספקים']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setReport(k)} className="text-sm px-3.5 py-2.5"
                  style={report === k
                    ? { background: 'white', color: STATUS.green.fg, fontWeight: 700, borderBottom: `3px solid ${STATUS.green.fg}` }
                    : { color: '#4B5563', borderBottom: '3px solid transparent' }}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] rounded-xl px-4 py-3 text-sm text-white shadow-lg" style={{ background: '#1F2937' }}>{toast}</div>
      )}
    </div>
  )
}
