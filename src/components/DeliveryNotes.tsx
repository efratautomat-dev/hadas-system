import { useState, useEffect } from 'react'
import { Plus, Package, X, ChevronLeft, AlertCircle } from 'lucide-react'
import { mockSuppliers, mockInvoices, mockDeliveryNotes, type DeliveryNote } from '../data/mockData'

// ── helpers ───────────────────────────────────────────────────────────────────

function formatILS(n: number) {
  return '₪' + n.toLocaleString('he-IL')
}

const statusLabel = { pending: 'ממתינה', archived: 'בארכיון' } as const

const statusBadge = {
  pending:  { bg: '#FEF9C3', color: '#A16207' },
  archived: { bg: '#F3F4F6', color: '#6B7280' },
}

const fieldStyle: React.CSSProperties = {
  height: '44px', width: '100%', padding: '0 14px', fontSize: '16px',
  border: '1px solid #F0E8E7', borderRadius: '12px', outline: 'none',
  background: 'white', color: '#1F2937',
}

function focusBdr(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  (e.target as HTMLElement).style.borderColor = '#E8645A'
}
function blurBdr(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  (e.target as HTMLElement).style.borderColor = '#F0E8E7'
}

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <p className="text-right mb-1.5" style={{ fontSize: '13px', color: '#6B7280', fontWeight: 500 }}>
      {text}{required && <span style={{ color: '#E8645A' }}> *</span>}
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

const emptyForm = { supplierId: '', noteId: '', isoDate: '', amount: '', notes: '' }

const COL_D = '110px 1fr 88px 100px 78px 110px 48px'
const COL_M = '1fr 85px 68px 32px'
const MIN_W = '680px'

// ── component ─────────────────────────────────────────────────────────────────

export default function DeliveryNotes() {
  const [notes, setNotes]             = useState<DeliveryNote[]>([...mockDeliveryNotes])
  const [showAll, setShowAll]          = useState(false)
  const [filterSupp, setFilterSupp]    = useState('')
  const [filterDate, setFilterDate]    = useState('')
  const [filterStat, setFilterStat]    = useState<StatusFilter>('all')

  const [modalType, setModalType]       = useState<ModalType>(null)
  const [selected, setSelected]         = useState<DeliveryNote | null>(null)
  const [selectedInvId, setSelectedInvId] = useState('')
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [form, setForm]                   = useState({ ...emptyForm })

  const isMobile = useIsMobile()
  const COL = isMobile ? COL_M : COL_D

  // ── derived ──────────────────────────────────────────────────────────────
  const displayed = notes
    .filter(n => {
      if (!showAll && n.status === 'archived') return false
      if (filterSupp && n.supplierId !== filterSupp) return false
      if (filterDate && n.isoDate < filterDate) return false
      if (showAll && filterStat !== 'all' && n.status !== filterStat) return false
      return true
    })
    .sort((a, b) => b.isoDate.localeCompare(a.isoDate))

  const pendingCount  = notes.filter(n => n.status === 'pending').length
  const archivedCount = notes.filter(n => n.status === 'archived').length

  const supplierInvoices = selected
    ? mockInvoices.filter(i => i.supplierId === selected.supplierId || i.supplier === selected.supplierName)
    : []

  const linkedInvoice = selected?.linkedInvoiceId
    ? mockInvoices.find(i => i.id === selected.linkedInvoiceId) ?? null
    : null

  const canAdd = form.supplierId && form.noteId && form.isoDate && form.amount

  // ── actions ───────────────────────────────────────────────────────────────
  const openNote = (note: DeliveryNote) => {
    setSelected(note)
    setSelectedInvId(note.linkedInvoiceId ?? '')
    setConfirmUnlink(false)
    setModalType('detail')
  }

  const closeModal = () => {
    setModalType(null)
    setSelected(null)
    setSelectedInvId('')
    setConfirmUnlink(false)
  }

  const linkInvoice = () => {
    if (!selected || !selectedInvId) return
    setNotes(prev => prev.map(n =>
      n.id === selected.id ? { ...n, status: 'archived' as const, linkedInvoiceId: selectedInvId } : n
    ))
    closeModal()
  }

  const doUnlink = () => {
    if (!selected) return
    setNotes(prev => prev.map(n =>
      n.id === selected.id ? { ...n, status: 'pending' as const, linkedInvoiceId: undefined } : n
    ))
    closeModal()
  }

  const addNote = () => {
    const sup = mockSuppliers.find(s => s.id === form.supplierId)
    if (!sup || !form.noteId || !form.isoDate || !form.amount) return
    const [y, m, d] = form.isoDate.split('-')
    const newNote: DeliveryNote = {
      id: form.noteId,
      supplierName: sup.name,
      supplierId: sup.id,
      date: `${d}/${m}/${y}`,
      isoDate: form.isoDate,
      amount: Number(form.amount),
      status: 'pending',
      notes: form.notes || undefined,
    }
    setNotes(prev => [newNote, ...prev])
    setForm({ ...emptyForm })
    closeModal()
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="text-right">
          <h1 className="text-2xl font-black text-gray-800">תעודות משלוח</h1>
          <p className="text-gray-500 mt-0.5" style={{ fontSize: '15px' }}>
            {pendingCount} ממתינות לשיוך · {archivedCount} בארכיון
          </p>
        </div>
        <button
          onClick={() => { setForm({ ...emptyForm }); setModalType('add') }}
          className="flex items-center gap-2 rounded-xl text-white font-semibold transition-all"
          style={{ background: 'linear-gradient(135deg,#8B1A3A,#E8645A)', minHeight: '44px', padding: '0 20px', fontSize: '16px' }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        >
          <Plus className="w-4 h-4" />
          הוסף תעודה
        </button>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'ממתינות לשיוך', value: pendingCount,  color: '#A16207', bg: '#FFFBEB', border: '#FDE68A' },
          { label: 'בארכיון',       value: archivedCount, color: '#6B7280', bg: 'white',   border: '#F0E8E7' },
          { label: 'סה"כ תעודות',   value: notes.length,  color: '#1F2937', bg: 'white',   border: '#F0E8E7' },
        ].map(({ label, value, color, bg, border }) => (
          <div key={label} className="rounded-2xl p-4 shadow-sm border text-center" style={{ background: bg, borderColor: border }}>
            <p className="font-black text-2xl" style={{ color }}>{value}</p>
            <p className="text-gray-500 mt-1" style={{ fontSize: '14px' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* ── Toggle + Filters ── */}
      <div className="bg-white rounded-2xl shadow-sm border p-4" style={{ borderColor: '#F0E8E7' }}>
        <div className="flex items-center gap-3 flex-wrap">

          {/* View toggle */}
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
                  background: showAll === v ? '#8B1A3A' : 'transparent',
                  color: showAll === v ? 'white' : '#6B7280',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Supplier filter */}
          <select
            value={filterSupp}
            onChange={e => setFilterSupp(e.target.value)}
            style={{ ...fieldStyle, width: '160px', direction: 'rtl', cursor: 'pointer' }}
            onFocus={focusBdr} onBlur={blurBdr}
          >
            <option value="">כל הספקים</option>
            {mockSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

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
                    background: filterStat === s ? '#E8645A' : 'transparent',
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
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#F0E8E7' }}>
        <div style={{ overflowX: 'auto' }}>

          {/* Column headers */}
          <div
            className="grid border-b font-semibold text-gray-400 uppercase tracking-wider"
            style={{ gridTemplateColumns: COL, borderColor: '#E2E4E9', fontSize: '11px', minWidth: isMobile ? '300px' : MIN_W, padding: '10px 16px' }}
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
              <p style={{ fontSize: '15px' }}>לא נמצאו תעודות</p>
            </div>
          ) : (
            displayed.map((note) => {
              const isArchived = note.status === 'archived'
              const badge = statusBadge[note.status]
              return (
                <div
                  key={note.id}
                  className="grid items-center cursor-pointer transition-colors"
                  style={{
                    gridTemplateColumns: COL,
                    borderBottom: '1px solid #E2E4E9',
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
                      {note.id}
                    </span>
                  )}
                  <span className="text-right font-medium" style={{ fontSize: '14px', color: isArchived ? '#9CA3AF' : '#374151' }}>
                    {note.supplierName}
                  </span>
                  {!isMobile && (
                    <span className="text-right" style={{ fontSize: '13px', color: '#9CA3AF' }}>
                      {note.date}
                    </span>
                  )}
                  <span className="text-left font-bold" style={{ fontSize: '14px', color: isArchived ? '#9CA3AF' : '#1F2937' }}>
                    {formatILS(note.amount)}
                  </span>
                  <span className="flex justify-center">
                    <span
                      className="rounded-lg font-medium"
                      style={{ fontSize: '11px', padding: '3px 10px', background: badge.bg, color: badge.color }}
                    >
                      {statusLabel[note.status]}
                    </span>
                  </span>
                  {!isMobile && (
                    <span className="text-right" style={{ fontSize: '13px', color: '#6B7280' }}>
                      {note.linkedInvoiceId ?? '—'}
                    </span>
                  )}
                  <span className="flex justify-center">
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
            {modalType === 'detail' && selected && selected.status === 'pending' && (
              <div>
                {/* Modal header */}
                <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: '#F0E8E7' }}>
                  <button onClick={closeModal} className="p-1.5 rounded-lg text-gray-400 transition-colors"
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#6B7280')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '')}
                  ><X className="w-4 h-4" /></button>
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg font-medium" style={{ fontSize: '12px', padding: '3px 10px', background: statusBadge.pending.bg, color: statusBadge.pending.color }}>
                      {statusLabel.pending}
                    </span>
                    <h2 className="font-black text-gray-800" style={{ fontSize: '17px' }}>תעודת משלוח {selected.id}</h2>
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
                      <div key={label} className="rounded-xl px-4 py-3 text-right" style={{ background: '#FFF8F7', border: '1px solid #F0E8E7' }}>
                        <p style={{ fontSize: '11px', color: '#9CA3AF' }}>{label}</p>
                        <p className="font-bold text-gray-800 mt-0.5" style={{ fontSize: '15px' }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {selected.notes && (
                    <div className="rounded-xl px-4 py-3 text-right" style={{ background: '#FFF8F7', border: '1px solid #F0E8E7' }}>
                      <p style={{ fontSize: '11px', color: '#9CA3AF' }}>הערות</p>
                      <p className="text-gray-700 mt-0.5" style={{ fontSize: '14px' }}>{selected.notes}</p>
                    </div>
                  )}

                  {/* Link to invoice */}
                  <div>
                    <div className="flex items-center gap-2 justify-end mb-3">
                      <p className="font-semibold text-gray-700" style={{ fontSize: '14px' }}>שיוך לחשבונית</p>
                      <div className="flex-1 h-px" style={{ background: '#F0E8E7' }} />
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
                      background: selectedInvId ? 'linear-gradient(135deg,#8B1A3A,#E8645A)' : '#E5E7EB',
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
            {modalType === 'detail' && selected && selected.status === 'archived' && (
              <div>
                {/* Modal header */}
                <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: '#F0E8E7' }}>
                  <button onClick={closeModal} className="p-1.5 rounded-lg text-gray-400 transition-colors"
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#6B7280')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '')}
                  ><X className="w-4 h-4" /></button>
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg font-medium" style={{ fontSize: '12px', padding: '3px 10px', background: statusBadge.archived.bg, color: statusBadge.archived.color }}>
                      {statusLabel.archived}
                    </span>
                    <h2 className="font-black text-gray-800" style={{ fontSize: '17px' }}>תעודת משלוח {selected.id}</h2>
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
                      <div key={label} className="rounded-xl px-4 py-3 text-right" style={{ background: '#FAFAFA', border: '1px solid #F0E8E7' }}>
                        <p style={{ fontSize: '11px', color: '#9CA3AF' }}>{label}</p>
                        <p className="font-bold text-gray-600 mt-0.5" style={{ fontSize: '15px' }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {selected.notes && (
                    <div className="rounded-xl px-4 py-3 text-right" style={{ background: '#FAFAFA', border: '1px solid #F0E8E7' }}>
                      <p style={{ fontSize: '11px', color: '#9CA3AF' }}>הערות</p>
                      <p className="text-gray-500 mt-0.5" style={{ fontSize: '14px' }}>{selected.notes}</p>
                    </div>
                  )}

                  {/* Linked invoice */}
                  <div>
                    <div className="flex items-center gap-2 justify-end mb-3">
                      <p className="font-semibold text-gray-700" style={{ fontSize: '14px' }}>חשבונית משויכת</p>
                      <div className="flex-1 h-px" style={{ background: '#F0E8E7' }} />
                    </div>

                    {linkedInvoice ? (
                      <div className="rounded-xl p-4 text-right" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                        <div className="flex items-center justify-between">
                          <span className="font-black" style={{ color: '#166534', fontSize: '16px' }}>
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
                      style={{ minHeight: '44px', fontSize: '15px', background: '#FFF0EF', color: '#E8645A' }}
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#FFE4E2')}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '#FFF0EF')}
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
                <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: '#F0E8E7' }}>
                  <button onClick={closeModal} className="p-1.5 rounded-lg text-gray-400 transition-colors"
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#6B7280')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '')}
                  ><X className="w-4 h-4" /></button>
                  <h2 className="font-black text-gray-800" style={{ fontSize: '17px' }}>הוסף תעודת משלוח</h2>
                </div>

                {/* Form */}
                <div className="p-5 space-y-4">
                  <div>
                    <FieldLabel text="ספק" required />
                    <select
                      value={form.supplierId}
                      onChange={e => setForm({ ...form, supplierId: e.target.value })}
                      style={{ ...fieldStyle, direction: 'rtl', cursor: 'pointer' }}
                      onFocus={focusBdr} onBlur={blurBdr}
                    >
                      <option value="">בחר ספק...</option>
                      {mockSuppliers.filter(s => s.status === 'פעיל').map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel text="מספר תעודה" required />
                      <input
                        value={form.noteId}
                        onChange={e => setForm({ ...form, noteId: e.target.value })}
                        placeholder="DN-XXX"
                        dir="ltr"
                        className="text-left placeholder-gray-300"
                        style={fieldStyle}
                        onFocus={focusBdr} onBlur={blurBdr}
                      />
                    </div>
                    <div>
                      <FieldLabel text="תאריך" required />
                      <input
                        type="date"
                        value={form.isoDate}
                        onChange={e => setForm({ ...form, isoDate: e.target.value })}
                        style={{ ...fieldStyle, direction: 'ltr' }}
                        onFocus={focusBdr} onBlur={blurBdr}
                      />
                    </div>
                  </div>

                  <div>
                    <FieldLabel text="סכום" required />
                    <input
                      type="number"
                      value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })}
                      placeholder="0"
                      dir="ltr"
                      className="text-left placeholder-gray-300"
                      style={fieldStyle}
                      onFocus={focusBdr} onBlur={blurBdr}
                    />
                  </div>

                  <div>
                    <FieldLabel text="הערות" />
                    <textarea
                      value={form.notes}
                      onChange={e => setForm({ ...form, notes: e.target.value })}
                      placeholder="הערות נוספות..."
                      className="text-right placeholder-gray-300 w-full"
                      style={{ ...fieldStyle, height: 'auto', minHeight: '80px', padding: '12px 14px', resize: 'vertical' }}
                      onFocus={focusBdr} onBlur={blurBdr}
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 px-5 pb-5">
                  <button
                    onClick={addNote}
                    disabled={!canAdd}
                    className="flex-1 rounded-xl font-semibold transition-all"
                    style={{
                      minHeight: '44px', fontSize: '15px',
                      background: canAdd ? 'linear-gradient(135deg,#8B1A3A,#E8645A)' : '#E5E7EB',
                      color: canAdd ? 'white' : '#9CA3AF',
                    }}
                  >
                    שמור
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

    </div>
  )
}
