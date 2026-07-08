import { useState, useEffect } from 'react'
import { Plus, Package, X, ChevronLeft, AlertCircle, FileText, Link2 } from 'lucide-react'
import { type DeliveryNote } from '../data/mockData'
import { useDeliveryNotes } from '../hooks/useDeliveryNotes'
import { useInvoices } from '../hooks/useInvoices'
import { useSuppliers } from '../hooks/useSuppliers'
import { useEmployees } from '../hooks/useEmployees'
import { PdfPreviewButton, PdfPreviewModal } from './PdfPreviewModal'
import { SearchableSelect } from './SearchableSelect'
import { StatusBadge } from './StatusBadge'

// ── helpers ───────────────────────────────────────────────────────────────────

function formatILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

const statusLabel = { pending: 'ממתינה', archived: 'בארכיון' } as const

function normalizeStatus(status: string): 'pending' | 'archived' {
  if (status === 'pending' || status === 'unlinked' || status === 'ממתינה לשיוך') return 'pending'
  if (status === 'archived' || status === 'משויכת') return 'archived'
  return 'pending'
}

// Map the delivery-note status onto the unified taxonomy (spec/06-RULES.md §1):
// pending → new, archived → done.
function deliveryStatusInternal(status: string): string {
  return normalizeStatus(status) === 'archived' ? 'done' : 'new'
}

const fieldStyle: React.CSSProperties = {
  height: '44px', width: '100%', padding: '0 14px', fontSize: '16px',
  border: '1px solid #DEDFE5', borderRadius: '12px', outline: 'none',
  background: 'white', color: '#1F2937',
}

function focusBdr(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  (e.target as HTMLElement).style.borderColor = 'var(--brand-primary)'
}
function blurBdr(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  (e.target as HTMLElement).style.borderColor = '#DEDFE5'
}

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <p className="text-right mb-1.5" style={{ fontSize: '13px', color: '#6B7280', fontWeight: 500 }}>
      {text}{required && <span style={{ color: 'var(--brand-primary)' }}> *</span>}
    </p>
  )
}

function useIsMobile() {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  useEffect(() => {
    const h = () => setV(window.innerWidth < 640)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

// ── types ─────────────────────────────────────────────────────────────────────

type ModalType   = null | 'detail' | 'add'
type StatusFilter = 'all' | 'pending' | 'archived'

const emptyForm = { supplierId: '', isoDate: '', items: '', noteNumber: '', employeeId: '' }

const COL_D = '110px 1fr 88px 100px 78px 110px 48px'
const COL_M = '1fr 85px 68px 32px'
const MIN_W = '680px'

// ── component ─────────────────────────────────────────────────────────────────

export default function DeliveryNotes() {
  const { data: serverNotes, loading, error, create: createNote, setMatch, link: linkNote, unlink: unlinkNote } = useDeliveryNotes()
  const { data: invoicesData } = useInvoices()
  const { data: suppliersData } = useSuppliers()
  const { data: employeesData } = useEmployees()
  const empById = new Map(employeesData.map(e => [e.id, e.name]))
  const [notes, setNotes]             = useState<DeliveryNote[]>([])
  // Primary split (mirrors Returns): arrived-by-email vs manual goods receipt.
  // NOTE: value is 'email' to match the derived `source` ('email' | 'manual').
  const [view, setView]                = useState<'email' | 'manual'>('email')
  const [showAll, setShowAll]          = useState(false)
  const [filterSupp, setFilterSupp]    = useState('')
  const [filterDate, setFilterDate]    = useState('')
  const [filterStat, setFilterStat]    = useState<StatusFilter>('all')

  const [modalType, setModalType]       = useState<ModalType>(null)
  const [selected, setSelected]         = useState<DeliveryNote | null>(null)
  const [selectedInvId, setSelectedInvId] = useState('')
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [form, setForm]                   = useState({ ...emptyForm })
  // PIECE 2 — matched arrived-note document opened in the in-page popup viewer.
  const [supplierDoc, setSupplierDoc]     = useState<string | null>(null)
  // PIECE 2 — arrived note chosen in the manual-row match picker (manual correction).
  const [matchPick, setMatchPick]         = useState('')

  const isMobile = useIsMobile()
  const COL = isMobile ? COL_M : COL_D

  useEffect(() => {
    setNotes([...serverNotes])
  }, [serverNotes])

  // ── derived ──────────────────────────────────────────────────────────────
  const displayed = notes
    .filter(n => {
      if ((n.source ?? 'manual') !== view) return false
      if (!showAll && normalizeStatus(n.status) === 'archived') return false
      if (filterSupp && n.supplierId !== filterSupp) return false
      if (filterDate && n.isoDate < filterDate) return false
      if (showAll && filterStat !== 'all' && normalizeStatus(n.status) !== filterStat) return false
      return true
    })
    .sort((a, b) => (b.isoDate || '').localeCompare(a.isoDate || ''))

  const pendingCount  = notes.filter(n => normalizeStatus(n.status) === 'pending').length
  const archivedCount = notes.filter(n => normalizeStatus(n.status) === 'archived').length

  const supplierInvoices = selected
    ? invoicesData.filter(i => i.supplierId === selected.supplierId || i.supplier === selected.supplierName)
    : []

  // PIECE 2 — arrived (email) notes for the selected manual row's supplier (match picker).
  const arrivedForSelected = selected && selected.source === 'manual'
    ? notes.filter(n => n.source === 'email' && n.supplierId === selected.supplierId)
    : []

  const linkedInvoice = selected?.linkedInvoiceId
    ? invoicesData.find(i => i.id === selected.linkedInvoiceId) ?? null
    : null

  const canAdd = form.supplierId && form.items.trim()

  // ── actions ───────────────────────────────────────────────────────────────
  const openNote = (note: DeliveryNote) => {
    setSelected(note)
    setSelectedInvId(note.linkedInvoiceId ?? '')
    setConfirmUnlink(false)
    setMatchPick('')
    setModalType('detail')
  }

  const closeModal = () => {
    setModalType(null)
    setSelected(null)
    setSelectedInvId('')
    setConfirmUnlink(false)
    setMatchPick('')
  }

  const linkInvoice = async () => {
    if (!selected || !selectedInvId) return
    const savedId = selected.id
    const savedInvId = selectedInvId
    closeModal()
    try {
      await linkNote(savedId, savedInvId)
    } catch {
      // hook sets error state
    }
  }

  const doUnlink = async () => {
    if (!selected) return
    const savedId = selected.id
    closeModal()
    try {
      await unlinkNote(savedId)
    } catch {
      // hook sets error state
    }
  }

  // PIECE 2 — manual correction: link the manual row to a chosen arrived note (copy
  // its document + number), or clear the match. AI suggests; the user confirms/overrides.
  const doMatch = async () => {
    if (!selected || !matchPick) return
    const arr = notes.find(n => n.id === matchPick)
    if (!arr) return
    const savedId = selected.id
    closeModal()
    try { await setMatch(savedId, arr.driveFileLink ?? null, arr.noteNumber ?? '') } catch { /* hook sets error */ }
  }

  const doUnmatch = async () => {
    if (!selected) return
    const savedId = selected.id
    closeModal()
    try { await setMatch(savedId, null, '') } catch { /* hook sets error */ }
  }

  // Manual goods receipt — PERSISTS via hadas-api (previously local-state only).
  const addManual = async () => {
    const sup = suppliersData.find(s => s.id === form.supplierId)
    if (!sup || !form.items.trim()) return
    const payload = {
      supplierId:   sup.id,
      supplierName: sup.name,
      isoDate:      form.isoDate || new Date().toISOString().slice(0, 10),
      lineItems:    form.items.trim(),
      noteNumber:   form.noteNumber.trim() || undefined,
      employeeId:   form.employeeId || undefined,
    }
    setForm({ ...emptyForm })
    closeModal()
    try {
      await createNote(payload)
    } catch {
      // hook sets error state
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (loading && notes.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-primary)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl p-3 text-sm text-right" style={{ background: '#FEF9C3', color: '#92400E' }}>
          לא ניתן לטעון נתונים מהשרת — מוצגים נתוני ברירת מחדל
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="text-right">
          <h1 className="text-2xl font-semibold" style={{ color: '#1A1A2E' }}>תעודות משלוח</h1>
          <p className="text-gray-500 mt-0.5" style={{ fontSize: '15px' }}>
            {pendingCount} ממתינות לשיוך · {archivedCount} בארכיון
          </p>
        </div>
        {view === 'manual' && (
          <button
            onClick={() => { setForm({ ...emptyForm, isoDate: new Date().toISOString().slice(0, 10) }); setModalType('add') }}
            className="flex items-center gap-2 rounded-xl text-white font-semibold transition-all"
            style={{ background: 'var(--brand-primary)', minHeight: '44px', padding: '0 20px', fontSize: '16px' }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
          >
            <Plus className="w-4 h-4" />
            קליטת סחורה ידנית
          </button>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'ממתינות לשיוך', value: pendingCount,  color: '#A16207', bg: '#FFFBEB', border: '#FDE68A' },
          { label: 'בארכיון',       value: archivedCount, color: '#6B7280', bg: 'white',   border: '#DEDFE5' },
          { label: 'סה"כ תעודות',   value: notes.length,  color: '#1F2937', bg: 'white',   border: '#DEDFE5' },
        ].map(({ label, value, color, bg, border }) => (
          <div key={label} className="rounded-2xl p-4 shadow-sm border text-center" style={{ background: bg, borderColor: border }}>
            <p className="text-2xl" style={{ color, fontWeight: 500 }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: '14px' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* ── Toggle + Filters ── */}
      <div className="bg-white rounded-2xl shadow-sm border p-4" style={{ borderColor: '#DEDFE5' }}>
        <div className="flex items-center gap-3 flex-wrap">

          {/* Primary two-view split: arrived-by-email vs manual goods receipt */}
          <div className="flex items-center gap-1 rounded-xl p-1 flex-shrink-0" style={{ background: '#F3F4F6' }}>
            {([
              { v: 'email',  label: 'מסמכים שהגיעו' },
              { v: 'manual', label: 'קליטה ידנית' },
            ] as { v: 'email' | 'manual'; label: string }[]).map(({ v, label }) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="rounded-lg px-4 font-medium transition-all"
                style={{
                  minHeight: '36px', fontSize: '14px',
                  background: view === v ? 'var(--brand-primary)' : 'transparent',
                  color: view === v ? 'white' : '#6B7280',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Archive toggle */}
          <div className="flex items-center gap-1 rounded-xl p-1 flex-shrink-0" style={{ background: '#F3F4F6' }}>
            {([
              { v: false, label: 'ממתינות בלבד' },
              { v: true,  label: 'הכל כולל ארכיון' },
            ] as { v: boolean; label: string }[]).map(({ v, label }) => (
              <button
                key={String(v)}
                onClick={() => { setShowAll(v); setFilterStat('all') }}
                className="rounded-lg px-4 font-medium transition-all"
                style={{
                  minHeight: '36px', fontSize: '14px',
                  background: showAll === v ? 'var(--brand-primary)' : 'transparent',
                  color: showAll === v ? 'white' : '#6B7280',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Supplier filter */}
          <SearchableSelect
            value={filterSupp}
            onChange={setFilterSupp}
            placeholder="כל הספקים"
            allowClear
            options={suppliersData.map(s => ({
              value: s.id,
              label: s.name,
              keywords: (s as { hp?: string }).hp,
            }))}
            style={{ width: '160px' }}
          />

          {/* Date filter */}
          <input
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            placeholder="מתאריך"
            style={{ ...fieldStyle, width: '150px', direction: 'ltr' }}
            onFocus={focusBdr} onBlur={blurBdr}
          />

          {/* Status filter — only when showAll */}
          {showAll && (
            <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: '#F3F4F6' }}>
              {(['all', 'pending', 'archived'] as StatusFilter[]).map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStat(s)}
                  className="rounded-lg px-3 font-medium transition-all"
                  style={{
                    minHeight: '36px', fontSize: '13px',
                    background: filterStat === s ? 'var(--brand-primary)' : 'transparent',
                    color: filterStat === s ? 'white' : '#6B7280',
                  }}
                >
                  {s === 'all' ? 'הכל' : statusLabel[s]}
                </button>
              ))}
            </div>
          )}

          {/* Clear */}
          {(filterSupp || filterDate) && (
            <button
              onClick={() => { setFilterSupp(''); setFilterDate('') }}
              className="text-sm transition-colors"
              style={{ color: '#9CA3AF' }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#6B7280')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#9CA3AF')}
            >
              נקה
            </button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#DEDFE5' }}>
        <div style={{ overflowX: 'auto' }}>

          {/* Column headers */}
          <div
            className="grid border-b font-semibold text-gray-400 uppercase tracking-wider"
            style={{ gridTemplateColumns: COL, borderColor: '#EEEEF2', fontSize: '11px', minWidth: isMobile ? '300px' : MIN_W, padding: '10px 16px' }}
          >
            {!isMobile && <span className="text-right">מספר תעודה</span>}
            <span className="text-right">ספק</span>
            {!isMobile && <span className="text-right">תאריך</span>}
            <span className="text-left">סכום</span>
            <span className="text-center">סטטוס</span>
            {!isMobile && <span className="text-right">חשבונית</span>}
            <span />
          </div>

          {/* Rows */}
          {displayed.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p style={{ fontSize: '15px' }}>{view === 'manual' ? 'אין קליטות ידניות — לחצי "קליטת סחורה ידנית"' : 'לא נמצאו מסמכים שהגיעו'}</p>
            </div>
          ) : (
            displayed.map((note) => {
              const isArchived = normalizeStatus(note.status) === 'archived'
              return (
                <div
                  key={note.id}
                  className="grid items-center cursor-pointer transition-colors"
                  style={{
                    gridTemplateColumns: COL,
                    borderBottom: '1px solid #EEEEF2',
                    background: isArchived ? '#FAFAFA' : 'white',
                    minWidth: isMobile ? '300px' : MIN_W,
                    minHeight: '56px',
                    padding: '12px 16px',
                  }}
                  onClick={() => openNote(note)}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = isArchived ? '#F4F4F5' : '#FFF8F7')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = isArchived ? '#FAFAFA' : 'white')}
                >
                  {!isMobile && (
                    <span className="text-right font-bold" style={{ fontSize: '14px', color: isArchived ? '#9CA3AF' : '#1F2937' }}>
                      {note.noteNumber || (note.source === 'manual' ? 'ידני' : '—')}
                    </span>
                  )}
                  <div className="text-right min-w-0">
                    <div className="font-medium truncate" style={{ fontSize: '14px', color: isArchived ? '#9CA3AF' : '#374151' }}>
                      {note.supplierName}
                    </div>
                    {note.lineItems && (
                      <div className="truncate" style={{ fontSize: '12px', color: '#9CA3AF' }}>
                        {note.lineItems.split('\n').filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {note.source === 'manual' && note.employeeId && empById.get(note.employeeId) && (
                      <div className="truncate" style={{ fontSize: '11px', color: '#A16207' }}>
                        קלט/ה: {empById.get(note.employeeId)}
                      </div>
                    )}
                    {note.source === 'manual' && note.driveFileLink && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSupplierDoc(note.driveFileLink!) }}
                        className="inline-flex items-center gap-1 text-xs font-semibold rounded-lg mt-1"
                        style={{ color: '#166534', background: '#F0FDF4', border: '1px solid #BBF7D0', padding: '3px 8px' }}
                        title={note.noteNumber ? `מסמך ספק ${note.noteNumber}` : 'מסמך ספק מקושר'}
                      >
                        <FileText className="w-3 h-3" /> הצג מסמך מספק
                      </button>
                    )}
                  </div>
                  {!isMobile && (
                    <span className="text-right" style={{ fontSize: '13px', color: '#9CA3AF' }}>
                      {note.date}
                    </span>
                  )}
                  <span className="text-left font-bold" style={{ fontSize: '14px', color: isArchived ? '#9CA3AF' : '#1F2937' }}>
                    {formatILS(note.amount)}
                  </span>
                  <span className="flex justify-center">
                    <StatusBadge status={deliveryStatusInternal(note.status)} style={{ fontSize: '11px', padding: '3px 10px' }} />
                  </span>
                  {!isMobile && (
                    <span className="text-right" style={{ fontSize: '13px', color: '#6B7280' }}>
                      {note.linkedInvoiceId ?? '—'}
                    </span>
                  )}
                  <span className="flex justify-center items-center gap-2" onClick={e => e.stopPropagation()}>
                    {note.driveFileLink && <PdfPreviewButton url={note.driveFileLink} title="תצוגה מקדימה של התעודה" />}
                    <ChevronLeft className="w-4 h-4 text-gray-300" />
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Modal overlay ────────────────────────────────────────────────────── */}
      {(modalType === 'detail' || modalType === 'add') && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={closeModal}
        >
          <div
            style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '460px', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >

            {/* ── Pending detail modal ── */}
            {modalType === 'detail' && selected && normalizeStatus(selected.status) === 'pending' && (
              <div>
                {/* Modal header */}
                <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: '#DEDFE5' }}>
                  <button onClick={closeModal} className="p-1.5 rounded-lg text-gray-400 transition-colors"
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#6B7280')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '')}
                  ><X className="w-4 h-4" /></button>
                  <div className="flex items-center gap-3">
                    <StatusBadge status="new" style={{ fontSize: '12px', padding: '3px 10px' }} />
                    <h2 className="font-semibold" style={{ fontSize: '17px', color: '#1A1A2E' }}>{selected.noteNumber ? `תעודת משלוח ${selected.noteNumber}` : 'קליטת סחורה ידנית'}</h2>
                  </div>
                </div>

                {/* Details */}
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'ספק',    value: selected.supplierName },
                      { label: 'תאריך',  value: selected.date },
                      { label: 'סכום',   value: formatILS(selected.amount) },
                      { label: 'מספר',   value: selected.id },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl px-4 py-3 text-right" style={{ background: '#FFF8F7', border: '1px solid #DEDFE5' }}>
                        <p style={{ fontSize: '11px', color: '#9CA3AF' }}>{label}</p>
                        <p className="font-bold text-gray-800 mt-0.5" style={{ fontSize: '15px' }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {(selected.lineItems || selected.notes) && (
                    <div className="rounded-xl px-4 py-3 text-right" style={{ background: '#FFF8F7', border: '1px solid #DEDFE5' }}>
                      <p style={{ fontSize: '11px', color: '#9CA3AF' }}>פריטים</p>
                      <p className="text-gray-700 mt-0.5" style={{ fontSize: '14px', whiteSpace: 'pre-wrap' }}>{selected.lineItems || selected.notes}</p>
                    </div>
                  )}

                  {/* PIECE 2 — manual↔arrived match (AI-suggested; manual correction here) */}
                  {selected.source === 'manual' && (
                    <div>
                      <div className="flex items-center gap-2 justify-end mb-3">
                        <p className="font-semibold text-gray-700" style={{ fontSize: '14px' }}>התאמה למסמך שהגיע</p>
                        <div className="flex-1 h-px" style={{ background: '#DEDFE5' }} />
                      </div>
                      {selected.driveFileLink ? (
                        <div className="rounded-xl p-3 text-right" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                          <div className="flex items-center justify-between gap-2">
                            <button
                              onClick={() => setSupplierDoc(selected.driveFileLink!)}
                              className="inline-flex items-center gap-1 text-xs font-semibold rounded-lg"
                              style={{ color: '#166534', background: 'white', border: '1px solid #BBF7D0', padding: '5px 10px' }}
                            >
                              <FileText className="w-3.5 h-3.5" /> הצג מסמך מספק
                            </button>
                            <span style={{ fontSize: '13px', color: '#166534' }}>מקושר: {selected.noteNumber || 'מסמך שהגיע'}</span>
                          </div>
                          <button onClick={doUnmatch} className="text-xs mt-2 font-semibold" style={{ color: '#DC2626' }}>בטל התאמה</button>
                        </div>
                      ) : arrivedForSelected.length === 0 ? (
                        <p className="text-center text-gray-400 py-2" style={{ fontSize: '13px' }}>אין מסמכים שהגיעו לספק זה</p>
                      ) : (
                        <div className="flex gap-2">
                          <select
                            value={matchPick}
                            onChange={e => setMatchPick(e.target.value)}
                            style={{ ...fieldStyle, direction: 'rtl', cursor: 'pointer' }}
                            onFocus={focusBdr} onBlur={blurBdr}
                          >
                            <option value="">בחר/י מסמך שהגיע...</option>
                            {arrivedForSelected.map(a => (
                              <option key={a.id} value={a.id}>{a.noteNumber} · {a.date}</option>
                            ))}
                          </select>
                          <button
                            onClick={doMatch}
                            disabled={!matchPick}
                            className="rounded-xl font-semibold text-white transition-all flex items-center gap-1 flex-shrink-0"
                            style={{ background: matchPick ? 'var(--brand-primary)' : '#E5E7EB', minHeight: '44px', padding: '0 16px', fontSize: '14px' }}
                          >
                            <Link2 className="w-4 h-4" /> התאם
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Link to invoice */}
                  <div>
                    <div className="flex items-center gap-2 justify-end mb-3">
                      <p className="font-semibold text-gray-700" style={{ fontSize: '14px' }}>שיוך לחשבונית</p>
                      <div className="flex-1 h-px" style={{ background: '#DEDFE5' }} />
                    </div>

                    {supplierInvoices.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-xl p-3 text-right" style={{ background: '#FFF8F0', border: '1px solid #FDE68A' }}>
                        <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#A16207' }} />
                        <span style={{ fontSize: '13px', color: '#A16207' }}>אין חשבוניות לספק זה</span>
                      </div>
                    ) : (
                      <select
                        value={selectedInvId}
                        onChange={e => setSelectedInvId(e.target.value)}
                        style={{ ...fieldStyle, direction: 'rtl', cursor: 'pointer' }}
                        onFocus={focusBdr} onBlur={blurBdr}
                      >
                        <option value="">בחר חשבונית לשיוך...</option>
                        {supplierInvoices.map(inv => (
                          <option key={inv.id} value={inv.id}>
                            {inv.id} · {formatILS(inv.amount)} · {inv.date}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="flex gap-3 px-5 pb-5">
                  <button
                    onClick={linkInvoice}
                    disabled={!selectedInvId}
                    className="flex-1 rounded-xl font-semibold transition-all"
                    style={{
                      minHeight: '44px', fontSize: '15px',
                      background: selectedInvId ? 'var(--brand-primary)' : '#E5E7EB',
                      color: selectedInvId ? 'white' : '#9CA3AF',
                    }}
                  >
                    שייך ועבור לארכיון
                  </button>
                  <button
                    onClick={closeModal}
                    className="flex-1 rounded-xl font-semibold transition-all"
                    style={{ minHeight: '44px', fontSize: '15px', background: '#F3F4F6', color: '#6B7280' }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#E5E7EB')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '#F3F4F6')}
                  >
                    סגור
                  </button>
                </div>
              </div>
            )}

            {/* ── Archived detail modal ── */}
            {modalType === 'detail' && selected && normalizeStatus(selected.status) === 'archived' && (
              <div>
                {/* Modal header */}
                <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: '#DEDFE5' }}>
                  <button onClick={closeModal} className="p-1.5 rounded-lg text-gray-400 transition-colors"
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#6B7280')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '')}
                  ><X className="w-4 h-4" /></button>
                  <div className="flex items-center gap-3">
                    <StatusBadge status="done" style={{ fontSize: '12px', padding: '3px 10px' }} />
                    <h2 className="font-semibold" style={{ fontSize: '17px', color: '#1A1A2E' }}>{selected.noteNumber ? `תעודת משלוח ${selected.noteNumber}` : 'קליטת סחורה ידנית'}</h2>
                  </div>
                </div>

                {/* Details */}
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'ספק',   value: selected.supplierName },
                      { label: 'תאריך', value: selected.date },
                      { label: 'סכום',  value: formatILS(selected.amount) },
                      { label: 'מספר',  value: selected.id },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl px-4 py-3 text-right" style={{ background: '#FAFAFA', border: '1px solid #DEDFE5' }}>
                        <p style={{ fontSize: '11px', color: '#9CA3AF' }}>{label}</p>
                        <p className="font-bold text-gray-600 mt-0.5" style={{ fontSize: '15px' }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {(selected.lineItems || selected.notes) && (
                    <div className="rounded-xl px-4 py-3 text-right" style={{ background: '#FAFAFA', border: '1px solid #DEDFE5' }}>
                      <p style={{ fontSize: '11px', color: '#9CA3AF' }}>פריטים</p>
                      <p className="text-gray-500 mt-0.5" style={{ fontSize: '14px', whiteSpace: 'pre-wrap' }}>{selected.lineItems || selected.notes}</p>
                    </div>
                  )}

                  {/* Linked invoice */}
                  <div>
                    <div className="flex items-center gap-2 justify-end mb-3">
                      <p className="font-semibold text-gray-700" style={{ fontSize: '14px' }}>חשבונית משויכת</p>
                      <div className="flex-1 h-px" style={{ background: '#DEDFE5' }} />
                    </div>

                    {linkedInvoice ? (
                      <div className="rounded-xl p-4 text-right" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold" style={{ color: '#166534', fontSize: '16px' }}>
                            {formatILS(linkedInvoice.amount)}
                          </span>
                          <span className="font-bold" style={{ color: '#166534', fontSize: '15px' }}>
                            {linkedInvoice.id}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span style={{ fontSize: '12px', color: '#4ADE80' }}>{linkedInvoice.status}</span>
                          <span style={{ fontSize: '12px', color: '#86EFAC' }}>
                            {linkedInvoice.supplier} · {linkedInvoice.date}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-center text-gray-400 py-3" style={{ fontSize: '14px' }}>חשבונית לא נמצאה</p>
                    )}
                  </div>

                  {/* Unlink confirmation */}
                  {confirmUnlink && (
                    <div className="rounded-xl p-4 text-right" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                      <p className="font-semibold mb-3" style={{ fontSize: '14px', color: '#991B1B' }}>
                        האם לבטל את השיוך? התעודה תחזור לרשימת הממתינות.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={doUnlink}
                          className="flex-1 rounded-xl font-semibold transition-all"
                          style={{ minHeight: '40px', fontSize: '14px', background: '#DC2626', color: 'white' }}
                          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#B91C1C')}
                          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '#DC2626')}
                        >
                          כן, בטל שיוך
                        </button>
                        <button
                          onClick={() => setConfirmUnlink(false)}
                          className="flex-1 rounded-xl font-semibold transition-all"
                          style={{ minHeight: '40px', fontSize: '14px', background: '#F3F4F6', color: '#6B7280' }}
                          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#E5E7EB')}
                          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '#F3F4F6')}
                        >
                          ביטול
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex gap-3 px-5 pb-5">
                  {!confirmUnlink && (
                    <button
                      onClick={() => setConfirmUnlink(true)}
                      className="flex-1 rounded-xl font-semibold transition-all"
                      style={{ minHeight: '44px', fontSize: '15px', background: 'var(--brand-active-bg)', color: 'var(--brand-primary)' }}
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#FFE4E2')}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-active-bg)')}
                    >
                      בטל שיוך
                    </button>
                  )}
                  <button
                    onClick={closeModal}
                    className={confirmUnlink ? 'w-full rounded-xl font-semibold' : 'flex-1 rounded-xl font-semibold'}
                    style={{ minHeight: '44px', fontSize: '15px', background: '#F3F4F6', color: '#6B7280', transition: 'all .15s' }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#E5E7EB')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '#F3F4F6')}
                  >
                    סגור
                  </button>
                </div>
              </div>
            )}

            {/* ── Add form modal ── */}
            {modalType === 'add' && (
              <div>
                {/* Modal header */}
                <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: '#DEDFE5' }}>
                  <button onClick={closeModal} className="p-1.5 rounded-lg text-gray-400 transition-colors"
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#6B7280')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '')}
                  ><X className="w-4 h-4" /></button>
                  <h2 className="font-semibold" style={{ fontSize: '17px', color: '#1A1A2E' }}>קליטת סחורה ידנית</h2>
                </div>

                {/* Form — goods received WITHOUT a delivery note: supplier + item list */}
                <div className="p-5 space-y-4">
                  <div>
                    <FieldLabel text="ספק" required />
                    <SearchableSelect
                      value={form.supplierId}
                      onChange={v => setForm({ ...form, supplierId: v })}
                      placeholder="בחר ספק..."
                      options={suppliersData.filter(s => s.status === 'פעיל').map(s => ({
                        value: s.id,
                        label: s.name,
                        keywords: (s as { hp?: string }).hp,
                      }))}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel text="תאריך קבלה" />
                      <input
                        type="date"
                        value={form.isoDate}
                        onChange={e => setForm({ ...form, isoDate: e.target.value })}
                        style={{ ...fieldStyle, direction: 'ltr' }}
                        onFocus={focusBdr} onBlur={blurBdr}
                      />
                    </div>
                    <div>
                      <FieldLabel text="מספר תעודה (אופציונלי)" />
                      <input
                        value={form.noteNumber}
                        onChange={e => setForm({ ...form, noteNumber: e.target.value })}
                        placeholder="—"
                        dir="ltr"
                        className="text-left placeholder-gray-300"
                        style={fieldStyle}
                        onFocus={focusBdr} onBlur={blurBdr}
                      />
                    </div>
                  </div>

                  <div>
                    <FieldLabel text="עובד/ת שקלט/ה את הסחורה" />
                    <SearchableSelect
                      value={form.employeeId}
                      onChange={v => setForm({ ...form, employeeId: v })}
                      placeholder="בחר/י עובד/ת..."
                      allowClear
                      options={employeesData.filter(e => e.active).map(e => ({ value: e.id, label: e.name }))}
                    />
                  </div>

                  <div>
                    <FieldLabel text="פירוט פריטים שהתקבלו" required />
                    <textarea
                      value={form.items}
                      onChange={e => setForm({ ...form, items: e.target.value })}
                      placeholder={'פריט + כמות בכל שורה, לדוגמה:\nחטיפים — 24 יח׳\nשתייה — 12 קרטונים'}
                      className="text-right placeholder-gray-300 w-full"
                      style={{ ...fieldStyle, height: 'auto', minHeight: '120px', padding: '12px 14px', resize: 'vertical' }}
                      onFocus={focusBdr} onBlur={blurBdr}
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 px-5 pb-5">
                  <button
                    onClick={addManual}
                    disabled={!canAdd}
                    className="flex-1 rounded-xl font-semibold transition-all"
                    style={{
                      minHeight: '44px', fontSize: '15px',
                      background: canAdd ? 'var(--brand-primary)' : '#E5E7EB',
                      color: canAdd ? 'white' : '#9CA3AF',
                    }}
                  >
                    שמור קליטה
                  </button>
                  <button
                    onClick={closeModal}
                    className="flex-1 rounded-xl font-semibold transition-all"
                    style={{ minHeight: '44px', fontSize: '15px', background: '#F3F4F6', color: '#6B7280' }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#E5E7EB')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '#F3F4F6')}
                  >
                    ביטול
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* PIECE 2 — supplier document (matched arrived note) in the in-page popup viewer */}
      {supplierDoc && <PdfPreviewModal url={supplierDoc} onClose={() => setSupplierDoc(null)} />}

    </div>
  )
}
