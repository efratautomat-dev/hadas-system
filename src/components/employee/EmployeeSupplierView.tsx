import { useState, useMemo, useEffect } from 'react'
import { User, Phone, Mail, Hash, Tag, MessageSquare, FileText, Truck, RotateCcw, Plus, Search, Eye, ChevronRight, List, X } from 'lucide-react'
import { useInvoices } from '../../hooks/useInvoices'
import { useDeliveryNotes } from '../../hooks/useDeliveryNotes'
import { useReturns } from '../../hooks/useReturns'
import { useEmployees } from '../../hooks/useEmployees'
import { useSuppliers } from '../../hooks/useSuppliers'
import { useOrders } from '../../hooks/useOrders'
import { useIsWide } from '../../hooks/useIsWide'
import SectionHeader from '../SectionHeader'
import { SearchableSelect } from '../SearchableSelect'
import { PdfPreviewModal } from '../PdfPreviewModal'
import { supabase } from '../../lib/supabase'
import { STATUS } from '../../theme/status'
import type { Invoice, PipelineStage, DeliveryNote } from '../../data/mockData'
import { intakeShort } from '../../lib/intakeSource'
import {
  FormModal as ReturnFormModal,
  emptyForm,
  type FormState,
} from '../Returns'
import { isoToDisplay } from '../../lib/dates'
import { invoiceStatusKey } from '../../lib/invoiceStatus'
import { StatusBadge } from '../StatusBadge'
import { PipelineStrip } from '../pipeline/PipelineStrip'
import OrderForm from '../pipeline/OrderForm'
import GoodsIntake from '../pipeline/GoodsIntake'
import { DateField } from '../ui/form'
import { newestFirst } from '../../lib/recency'

export type EmployeeSection = 'invoices' | 'deliveries' | 'returns'

// Minimal supplier shape we need here. The full row comes from useSuppliers, but
// employees only ever see contact details — never balances, payments or ledger
// (that is exactly why this is NOT the manager-only SupplierDetail component).
interface SupplierLike {
  id: string
  name: string
  contact?: string
  phone?: string
  email?: string
  hp?: string
  category?: string
  notes?: string
}

interface Props {
  supplier: SupplierLike
  activeSection: EmployeeSection
  /** Open the full pipeline panel for one delivery. Same panel the manager gets. */
  onOpenPipeline?: (deliveryNoteId: string) => void
  /** Who is capturing — stamped on the row for audit, as the camera path does. */
  userEmail?: string
  /**
   * Tells the dashboard a full-page view is open, so the orders rail can step
   * aside. The board is something you GLANCE at while doing something else; when
   * the something else is reading a document, it is taking width from the only
   * thing on screen that needs it.
   */
  onFullPage?: (open: boolean) => void
}

// Status colors from the FIXED functional tokens (src/theme/status.ts) — same
// palette as the manager screens: yellow=check, green=done, orange=in_progress, red.
// Invoice status is DERIVED, never the stored column (CLAUDE.md). Employees are
// blocked from `alerts` at the DB (manager-only RLS), so the alert list is always
// empty here and the "בבדיקה" state is invisible to them — an employee sees
// "ממתין" or "הועבר לרו״ח". That is a deliberate consequence of the permission
// model, and still strictly better than printing the unreliable stored value.
const NO_ALERTS: never[] = []

const returnStatusStyle: Record<string, { bg: string; color: string }> = {
  'אושר':   { bg: STATUS.green.bg,  color: STATUS.green.fg },
  'בטיפול': { bg: STATUS.orange.bg, color: STATUS.orange.fg },
  'נדחה':   { bg: STATUS.red.bg,    color: STATUS.red.fg },
}

function SectionShell({ title, Icon, count, children, action }: {
  title: string
  Icon: typeof FileText
  count: number
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
      <SectionHeader
        className="px-5 py-4 border-b"
        style={{ borderColor: '#EEEEF2' }}
        title={<><h2 className="font-bold text-gray-800">{title}</h2><Icon className="w-4 h-4 text-gray-400" /></>}
        action={action ?? <span className="text-sm text-gray-400">{count} רשומות</span>}
      />
      {children}
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-center text-gray-400 py-10" style={{ fontSize: '15px' }}>{text}</p>
}

// Compact outlined icon button used for the per-row view controls.
function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '34px', borderRadius: '9px', border: '1px solid #DEDFE5', background: 'white', color: 'var(--brand-primary)', cursor: 'pointer', flexShrink: 0 }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-active-bg)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
    >
      {children}
    </button>
  )
}

// Read-only details popup for MANUAL records (returns / goods-receipts created
// in-app that have no scanned document). Shows operational info only — supplier,
// number, date, reason + item names — and DELIBERATELY no monetary amounts,
// matching the employee no-financials rule.
export interface MetaModalData {
  title: string
  Icon: typeof FileText
  rows: { label: string; value: string }[]
  note?: string
  items?: string
}
function MetaModal({ title, Icon, rows, note, items, onClose }: MetaModalData & { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', overflowY: 'auto', padding: '32px 12px' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full" style={{ maxWidth: '520px', direction: 'rtl' }}>
        <div className="flex items-center gap-2 border-b" style={{ padding: '14px 20px', borderColor: '#EEEEF2', background: '#FAFAFC' }}>
          <Icon className="w-4 h-4 text-gray-400" />
          <h2 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" style={{ background: 'none', border: 'none', cursor: 'pointer', marginInlineStart: 'auto' }} title="סגירה">
            <X className="w-5 h-5" />
          </button>
        </div>
        {rows.map(({ label, value }, i) => (
          <div key={label} style={{ direction: 'ltr', display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 20px', minHeight: '50px', borderTop: i > 0 ? '1px solid #EEEEF2' : undefined }}>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', direction: 'rtl', fontSize: '14px', color: '#1F2937', fontWeight: 500 }}>{value || '—'}</span>
            <span style={{ width: '110px', textAlign: 'right', direction: 'rtl', fontSize: '13px', color: '#9CA3AF' }}>{label}</span>
          </div>
        ))}
        {note?.trim() && (
          <div style={{ padding: '13px 20px', borderTop: '1px solid #EEEEF2' }}>
            <p className="text-right text-gray-400" style={{ fontSize: '13px', marginBottom: '4px' }}>הערות</p>
            <p className="text-right" style={{ fontSize: '14px', color: '#1F2937', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{note}</p>
          </div>
        )}
        {items?.trim() && (
          <div style={{ padding: '13px 20px', borderTop: '1px solid #EEEEF2' }}>
            <p className="text-right text-gray-400 flex items-center gap-1.5 justify-end" style={{ fontSize: '13px', marginBottom: '6px' }}>
              פירוט פריטים <List className="w-3.5 h-3.5" />
            </p>
            {items.split('\n').filter((l) => l.trim()).map((line, i) => (
              <div key={i} className="text-right" style={{ padding: '6px 0', borderTop: i > 0 ? '1px solid #F1F2F4' : undefined, fontSize: '14px', color: '#1F2937' }}>{line.trim()}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── The invoice, as a full page ──────────────────────────────────────────────
//
// Two panes like the manager's screen: the document on one side and the fields on
// the other, because reading a scan in a strip beside a list is not reading it.
//
// The FIELDS are the curated set, not the manager's form — the owner's rule is
// same screen, fewer things, and the amounts are absent by permission rather than
// by layout (the masking view NULLs them long before this renders).
//
// One thing she CAN write: a note. She took the delivery and saw what was short,
// and a remark she cannot leave is knowledge the system loses at the counter. It
// goes through a narrow route that writes the note and nothing else.
function EmployeeInvoiceView({ invoice, onBack, onSaveNotes, isWide }: {
  invoice: Invoice
  onBack: () => void
  onSaveNotes?: (id: string, notes: string) => Promise<void>
  isWide: boolean
}) {
  const [showDoc, setShowDoc] = useState(false)
  const [note, setNote] = useState(invoice.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const docUrl = (invoice.driveFileLink || invoice.storage_url || '').trim()
  const statusKey = invoiceStatusKey(invoice, NO_ALERTS)
  const rows = [
    { label: 'מספר חשבונית', value: invoice.invoiceNumber || invoice.id },
    { label: 'ספק',          value: invoice.supplier || '' },
    { label: 'תאריך',        value: invoice.date || '' },
    { label: 'קטגוריה',      value: invoice.category || '' },
  ]
  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 font-medium transition-colors"
        style={{ background: 'white', border: '1.5px solid #DEDFE5', borderRadius: '12px', padding: '10px 16px', fontSize: '14px', color: '#6B7280', cursor: 'pointer' }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FAFAFC')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
      >
        <ChevronRight className="w-4 h-4" />
        חזרה
      </button>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexDirection: isWide ? 'row' : 'column' }}>
      {docUrl && (
        <div style={{
          background: '#F3F4F6', border: '1px solid #DEDFE5', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          ...(isWide
            ? { flex: '1 1 50%', position: 'sticky' as const, top: '8px', height: 'calc(100vh - 190px)' }
            : { width: '100%', height: '50vh' }),
        }}>
          <div className="flex items-center justify-between" style={{ padding: '8px 12px', background: '#FAFAFC', borderBottom: '1px solid #E2E4E9' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#6B7280' }}>מסמך מקור</span>
            <button
              onClick={() => setShowDoc(true)}
              className="inline-flex items-center gap-1.5"
              style={{ padding: '5px 10px', border: '1px solid #DEDFE5', background: 'white', color: 'var(--brand-primary)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
            ><Eye size={13} />הגדל</button>
          </div>
          <div className="grid place-items-center" style={{ flex: 1, color: '#B7B9C0', fontSize: '13px', padding: '16px', textAlign: 'center' }}>
            לחצי "הגדל" לצפייה במסמך
          </div>
        </div>
      )}

      <div style={{ flex: isWide && docUrl ? '1 1 50%' : undefined, width: isWide && docUrl ? undefined : '100%', display: 'grid', gap: '16px' }}>
      {/* Non-financial metadata (read-only text, no inputs) */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
        <div className="flex items-center gap-2 border-b" style={{ padding: '14px 24px', borderColor: '#EEEEF2', background: '#FAFAFC' }}>
          <h2 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>פרטי חשבונית</h2>
          <FileText className="w-4 h-4 text-gray-400" />
          <StatusBadge status={statusKey} style={{ fontSize: '12px', padding: '4px 10px', fontWeight: 700, marginInlineStart: 'auto' }} />
        </div>
        {rows.map(({ label, value }, i) => (
          <div key={label} style={{ direction: 'ltr', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', minHeight: '52px', borderTop: i > 0 ? '1px solid #EEEEF2' : undefined }}>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', direction: 'rtl', fontSize: '14px', color: '#1F2937', fontWeight: 500 }}>{value || '—'}</span>
            <span style={{ width: '110px', textAlign: 'right', direction: 'rtl', fontSize: '13px', color: '#9CA3AF' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Line items — names + quantities ONLY (operational goods-receipt info).
          No per-item prices or money; lineDetails is free text "name - qty". */}
      {invoice.lineDetails?.trim() && (
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
          <div className="flex items-center gap-2 border-b" style={{ padding: '14px 24px', borderColor: '#EEEEF2', background: '#FAFAFC' }}>
            <h2 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>פירוט פריטים</h2>
            <List className="w-4 h-4 text-gray-400" />
          </div>
          {invoice.lineDetails.split('\n').filter((l) => l.trim()).map((line, i) => (
            <div key={i} className="text-right" style={{ padding: '12px 24px', borderTop: i > 0 ? '1px solid #F1F2F4' : undefined, fontSize: '14px', color: '#1F2937' }}>
              {line.trim()}
            </div>
          ))}
        </div>
      )}

      {/* The note — the one thing she may write here. Placed last, where the
          buttons that act on it are, exactly as the manager's screen puts it. */}
      {onSaveNotes && (
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
          <div className="flex items-center gap-2 border-b" style={{ padding: '14px 24px', borderColor: '#EEEEF2', background: '#FAFAFC' }}>
            <h2 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>הערות</h2>
            <MessageSquare className="w-4 h-4 text-gray-400" />
          </div>
          <div style={{ padding: '14px 24px', display: 'grid', gap: '10px' }}>
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setSaved(false) }}
              rows={3}
              placeholder="למשל: הגיעו 380 מטר במקום 400 — סוכם זיכוי."
              style={{ width: '100%', border: '1px solid #E2E4E9', padding: '10px 12px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
            />
            <div className="flex items-center gap-2">
              <button
                disabled={saving || note === (invoice.notes ?? '')}
                onClick={async () => {
                  setSaving(true)
                  try { await onSaveNotes(invoice.id, note); setSaved(true) }
                  finally { setSaving(false) }
                }}
                className="font-semibold text-white"
                style={{
                  background: note !== (invoice.notes ?? '') ? 'var(--brand-primary)' : '#D6D7DD',
                  border: 'none', padding: '9px 18px', fontSize: '13px',
                  cursor: saving ? 'wait' : note !== (invoice.notes ?? '') ? 'pointer' : 'not-allowed',
                }}
              >{saving ? 'שומר…' : 'שמירת הערה'}</button>
              {/* Saving must NOT leave the screen: she is reading the document and
                  jotting against it, and navigating away is the opposite of that. */}
              {saved && <span style={{ fontSize: '12.5px', color: '#166534' }}>נשמר</span>}
            </div>
          </div>
        </div>
      )}

      {!docUrl && (
        <p className="text-center text-gray-400" style={{ fontSize: '14px', padding: '8px' }}>אין מסמך מצורף</p>
      )}
      </div>
      </div>

      {showDoc && docUrl && <PdfPreviewModal url={docUrl} onClose={() => setShowDoc(false)} />}
    </div>
  )
}

// Manual goods-receipt form (employee operational write). Supplier is fixed to the
// currently-viewed supplier; the employee records who received it, the date, an
// optional supplier note number, and the item list. NO monetary amount field —
// goods receipts carry none, consistent with the employee no-financials rule.
interface ReceiptFormState { isoDate: string; items: string; noteNumber: string; employeeId: string }

function ReceiptFormModal({ form, setForm, supplierName, employees, onSave, onClose }: {
  form: ReceiptFormState
  setForm: (f: ReceiptFormState) => void
  supplierName: string
  employees: { id: string; name: string }[]
  onSave: () => void
  onClose: () => void
}) {
  const valid = form.items.trim().length > 0
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: '13px', color: '#6B7280', marginBottom: '5px', fontWeight: 500 }
  const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid #DEDFE5', borderRadius: '10px', padding: '10px 12px', fontSize: '14px', direction: 'rtl', outline: 'none', background: 'white' }
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', overflowY: 'auto', padding: '32px 12px' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full" style={{ maxWidth: '520px', direction: 'rtl' }}>
        <div className="flex items-center gap-2 border-b" style={{ padding: '14px 20px', borderColor: '#EEEEF2', background: '#FAFAFC' }}>
          <Truck className="w-4 h-4 text-gray-400" />
          <h2 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>קליטת סחורה ידנית</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" style={{ background: 'none', border: 'none', cursor: 'pointer', marginInlineStart: 'auto' }} title="סגירה">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="text-right" style={{ fontSize: '14px', color: '#1F2937' }}>
            <span style={{ color: '#9CA3AF', fontSize: '13px' }}>ספק: </span>{supplierName}
          </div>
          <div>
            <label style={labelStyle}>מי קלט/ה</label>
            <SearchableSelect
              value={form.employeeId}
              onChange={(v) => setForm({ ...form, employeeId: v })}
              placeholder="— בחירת עובד/ת —"
              allowClear
              options={employees.map((e) => ({ value: e.id, label: e.name }))}
            />
          </div>
          <div>
            <label style={labelStyle}>תאריך</label>
            <DateField value={form.isoDate} onChange={(e) => setForm({ ...form, isoDate: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>מספר תעודה (אופציונלי)</label>
            <input value={form.noteNumber} onChange={(e) => setForm({ ...form, noteNumber: e.target.value })} placeholder="ריק אם אין תעודה" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>פירוט הסחורה שהתקבלה</label>
            <textarea value={form.items} onChange={(e) => setForm({ ...form, items: e.target.value })} placeholder={'שם פריט וכמות בכל שורה'} rows={5} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t" style={{ padding: '14px 20px', borderColor: '#EEEEF2' }}>
          <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: '10px', border: '1.5px solid #DEDFE5', background: 'white', color: '#6B7280', fontSize: '14px', fontWeight: 500, cursor: 'pointer' }}>ביטול</button>
          <button
            onClick={onSave}
            disabled={!valid}
            style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: valid ? 'var(--brand-primary)' : '#CBD5E1', color: 'white', fontSize: '14px', fontWeight: 700, cursor: valid ? 'pointer' : 'not-allowed' }}
          >
            שמירה
          </button>
        </div>
      </div>
    </div>
  )
}

export default function EmployeeSupplierView({ supplier, activeSection, onOpenPipeline, userEmail, onFullPage }: Props) {
  const { data: allInvoices, saveNotes: saveInvoiceNotes } = useInvoices()
  const { data: allDeliveries, create: createDeliveryNote } = useDeliveryNotes()
  const { data: allReturns, create: createReturn } = useReturns()
  const { data: employees }        = useEmployees()
  const { data: suppliers }        = useSuppliers()
  const { openForSupplier, create: createOrder } = useOrders()
  const isWide = useIsWide()


  const [invoiceQuery, setInvoiceQuery] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  // Reported rather than derived by the parent: this component owns the state that
  // decides it, and a second copy upstairs would be one more thing to keep in step.
  useEffect(() => { onFullPage?.(!!selectedInvoice) }, [selectedInvoice, onFullPage])
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnForm, setReturnForm] = useState<FormState>(emptyForm())
  const [showReceiptForm, setShowReceiptForm] = useState(false)
  const [newOrder, setNewOrder] = useState(false)
  const [intake, setIntake] = useState(false)
  const [receiptForm, setReceiptForm] = useState<ReceiptFormState>({ isoDate: '', items: '', noteNumber: '', employeeId: '' })
  // Document image/PDF popup (arrived records) and metadata popup (manual records).
  const [docView, setDocView] = useState<{ url: string; previewSrc?: string } | null>(null)
  const [metaModal, setMetaModal] = useState<MetaModalData | null>(null)

  // Open the source document: Drive links go straight to the preview; a Storage
  // path is signed first (short-lived) and passed as previewSrc.
  async function openDoc(driveLink?: string, storagePath?: string) {
    if (driveLink) { setDocView({ url: driveLink }); return }
    if (storagePath) {
      const { data } = await supabase.storage.from('documents').createSignedUrl(storagePath, 3600)
      if (data?.signedUrl) setDocView({ url: storagePath, previewSrc: data.signedUrl })
    }
  }

  // Scope every dataset to this supplier (match by id, fall back to name —
  // ingested rows sometimes carry only one of the two).
  // Sorted, like every other list — this view had none either. The employee is
  // the one standing in front of the goods, so "what came in last" is the
  // question she asks most often here.
  const invoices = allInvoices.filter(
    (inv) => inv.supplierId === supplier.id || inv.supplier === supplier.name,
  ).sort(newestFirst)
  const deliveries = allDeliveries.filter(
    (dn) => dn.supplierId === supplier.id || dn.supplierName === supplier.name,
  ).sort(newestFirst)
  // Orders match by id ONLY — unlike the datasets above there is no name
  // fallback, because every order is created through the supplier picker and so
  // always carries an id. Matching on name too would attach an order to a
  // second supplier that merely shares a name.
  const supplierOrders = openForSupplier(supplier.id)
  // What the order behind a row says about itself. The separate orders panel is
  // gone — an order IS a row here — so the row carries the description and the
  // customer, which are the two things the panel uniquely showed.
  const orderMeta = useMemo(() => {
    const m = new Map<string, { description: string; customerName: string | null }>()
    for (const o of supplierOrders) {
      if (o.deliveryNoteId) m.set(o.deliveryNoteId, { description: o.description, customerName: o.customerName })
    }
    return m
  }, [supplierOrders])
  const returns = allReturns.filter(
    (r) => (r as { supplierId?: string }).supplierId === supplier.id,
  )

  const q = invoiceQuery.trim().toLowerCase()
  const shownInvoices = q
    ? invoices.filter((inv) =>
        String((inv as { invoiceNumber?: string }).invoiceNumber ?? '').toLowerCase().includes(q) ||
        String(inv.id ?? '').toLowerCase().includes(q))
    : invoices

  // ── Reuse the existing returns popup ──
  function openAddReturn() {
    setReturnForm({ ...emptyForm(), supplierId: supplier.id })
    setShowReturnForm(true)
  }

  // Manual receipt now lives behind the shared GoodsIntake door, together with
  // photo capture — one door, two ways in, per the owner's decision. The modal
  // below is what it replaced and is kept only until the walkthrough is re-cut.

  async function handleSaveReceipt() {
    if (!receiptForm.items.trim()) return
    setShowReceiptForm(false)
    try {
      await createDeliveryNote({
        supplierId:   supplier.id,
        supplierName: supplier.name,
        isoDate:      receiptForm.isoDate || new Date().toISOString().slice(0, 10),
        lineItems:    receiptForm.items.trim(),
        noteNumber:   receiptForm.noteNumber.trim() || undefined,
        employeeId:   receiptForm.employeeId || undefined,
      })
    } catch {
      // hook surfaces the error
    }
  }

  async function handleSaveReturn() {
    // Returns are tracking-only — no amount required at creation.
    const amount = Number(returnForm.amountStr) || 0
    if (!returnForm.supplierId || !returnForm.reason.trim() || !returnForm.dateIso) return
    const sup = suppliers.find((s) => s.id === returnForm.supplierId)
    const emp = employees.find((e) => e.id === returnForm.employeeId)
    setShowReturnForm(false)
    try {
      await createReturn({
        date: isoToDisplay(returnForm.dateIso),
        dateIso: returnForm.dateIso,
        supplierId: returnForm.supplierId,
        supplier: sup?.name ?? supplier.name,
        amount,
        reason: returnForm.reason,
        detail: returnForm.detail,
        originalInvoiceId: returnForm.originalInvoiceId || null,
        status: returnForm.status,
        employeeId: returnForm.employeeId || null,
        createdBy: emp?.name ?? '',
      } as Parameters<typeof createReturn>[0])
    } catch {
      // hook surfaces the error
    }
  }

  const contactFields = [
    { Icon: User,  label: 'שם איש קשר', value: supplier.contact ?? '' },
    { Icon: Phone, label: 'טלפון',       value: supplier.phone   ?? '' },
    { Icon: Mail,  label: 'מייל',         value: supplier.email   ?? '' },
    { Icon: Hash,  label: 'ח.פ / ע.מ',  value: supplier.hp      ?? '' },
    { Icon: Tag,   label: 'קטגוריה',     value: supplier.category ?? '' },
  ]

  // Employees get a READ-ONLY invoice view: NO financial fields (before-VAT / VAT /
  // total), NO edit or save controls — only non-money metadata plus the original
  // document image/PDF (viewing the scanned source is allowed). When a row is
  // selected it replaces the whole supplier view; its "חזרה" button clears it.
  if (selectedInvoice) {
    return <EmployeeInvoiceView
        invoice={selectedInvoice}
        onBack={() => setSelectedInvoice(null)}
        onSaveNotes={saveInvoiceNotes}
        isWide={isWide}
      />
  }

  return (
    <div className="space-y-5">
      {/* Supplier name */}
      <div className="text-right">
        <h1 className="font-black text-gray-800" style={{ fontSize: '22px' }}>{supplier.name}</h1>
        <p className="text-gray-500 mt-0.5" style={{ fontSize: '13px' }}>
          {[supplier.contact, supplier.phone].filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* ── Contact details (always visible) ── */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
        <div className="flex items-center gap-2 border-b" style={{ padding: '14px 24px', borderColor: '#EEEEF2', background: '#FAFAFC' }}>
          <h2 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>פרטי קשר</h2>
          <User className="w-4 h-4 text-gray-400" />
        </div>
        {contactFields.map(({ Icon, label, value }, i) => (
          // Forced LTR container so flex ordering is immune to inherited direction:
          // value sits on the LEFT, label + icon group on the RIGHT. Text spans
          // restore rtl so Hebrew/labels read correctly.
          <div
            key={label}
            style={{
              direction: 'ltr',
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '14px 24px', minHeight: '52px',
              borderTop: i > 0 ? '1px solid #EEEEF2' : undefined,
            }}
          >
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', direction: 'rtl', fontSize: '14px', color: '#1F2937', fontWeight: 500 }}>
              {value || '—'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              <span style={{ width: '110px', textAlign: 'right', direction: 'rtl', fontSize: '13px', color: '#9CA3AF' }}>{label}</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#F8F9FA' }}>
                <Icon className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-dark)' }} />
              </div>
            </div>
          </div>
        ))}
        {supplier.notes && (
          <div
            style={{
              direction: 'ltr',
              display: 'flex', alignItems: 'flex-start', gap: '12px',
              padding: '14px 24px', borderTop: '1px solid #EEEEF2',
            }}
          >
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', direction: 'rtl', fontSize: '14px', color: '#1F2937', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {supplier.notes}
            </span>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexShrink: 0 }}>
              <span style={{ width: '110px', textAlign: 'right', direction: 'rtl', fontSize: '13px', color: '#9CA3AF', paddingTop: '5px' }}>הערות</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#F8F9FA' }}>
                <MessageSquare className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-dark)' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Invoices ── */}
      {activeSection === 'invoices' && (
        <SectionShell title="חשבוניות" Icon={FileText} count={shownInvoices.length}>
          <div className="px-5 py-3 border-b" style={{ borderColor: '#EEEEF2' }}>
            <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: '#EEEEF2', height: '40px' }}>
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                value={invoiceQuery}
                onChange={(e) => setInvoiceQuery(e.target.value)}
                placeholder="חיפוש לפי מספר חשבונית"
                style={{ border: 'none', outline: 'none', width: '100%', fontSize: '14px', background: 'transparent', direction: 'rtl' }}
              />
            </div>
          </div>
          {shownInvoices.length === 0 ? (
            <EmptyRow text="אין חשבוניות עבור ספק זה" />
          ) : (
            shownInvoices.map((inv) => {
              const statusKey = invoiceStatusKey(inv, NO_ALERTS)
              const num = (inv as { invoiceNumber?: string }).invoiceNumber || inv.id
              return (
                <div
                  key={inv.id}
                  className="grid items-center border-b cursor-pointer"
                  style={{ gridTemplateColumns: '1fr 90px 28px', borderColor: '#EEEEF2', minHeight: '56px', padding: '12px 16px' }}
                  onClick={() => setSelectedInvoice(inv as Invoice)}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FAFAFC')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <p className="text-right text-gray-500" style={{ fontSize: '13px' }}>{num} · {inv.date}</p>
                  <div className="flex justify-center">
                    <StatusBadge status={statusKey} style={{ fontSize: '12px', padding: '4px 10px', fontWeight: 700 }} />
                  </div>
                  {/* No amount — employees see the document, not the app's money data */}
                  <Eye className="w-4 h-4" style={{ color: '#9CA3AF' }} />
                </div>
              )
            })
          )}
        </SectionShell>
      )}

      {/* The two forms open INSIDE the page — above the list they add to, so the
          result of saving is already on screen when the form closes. */}
      {intake && activeSection === 'deliveries' && (
        <GoodsIntake
          inline
          suppliers={[]}
          lockedSupplier={{ id: supplier.id, name: supplier.name }}
          capturedBy={userEmail}
          onClose={() => setIntake(false)}
          // The employee HAS the delivery page — it is the same one the row in the
          // list below opens. A photographed note that turns out to be on file
          // therefore lands on the delivery itself, exactly as it does for the
          // manager, instead of closing back to a list she then has to search.
          onOpenDelivery={id => { setIntake(false); onOpenPipeline?.(id) }}
          // Returned, not swallowed — the duplicate question has to reach the
          // door that asked, or nothing is written and nothing says so.
          onCreate={d => createDeliveryNote(d)}
        />
      )}

      {newOrder && activeSection === 'deliveries' && (
        <OrderForm
          inline
          suppliers={[]}
          lockedSupplier={{ id: supplier.id, name: supplier.name }}
          customerOnly
          openOrders={supplierOrders.map(o => ({
            id: o.id, supplierId: o.supplierId, description: o.description,
            date: o.date, expectedDate: o.expectedDate, customerName: o.customerName,
          }))}
          onClose={() => setNewOrder(false)}
          onCreate={async d => { await createOrder(d) }}
        />
      )}

      {/* ── הזמנות וסחורה — one list ─────────────────────────────────────────
          NOT two panels. An order opens its pipeline row the moment it is placed,
          so it is already in this list — a separate "הזמנות פתוחות" panel above
          was showing the same records twice, which is the duplication the
          manager's tabs were removed for. */}
      {activeSection === 'deliveries' && (
        <SectionShell
          title="הזמנות וסחורה"
          Icon={Truck}
          count={deliveries.length}
          action={
            <div className="flex items-center gap-2">
            <button
              onClick={() => setNewOrder(true)}
              className="flex items-center gap-1.5 font-bold"
              style={{ minHeight: '38px', padding: '0 14px', background: 'white', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)', fontSize: '13.5px' }}
            >
              <Plus className="w-4 h-4" />
              הזמנה ללקוחה
            </button>
            <button
              onClick={() => setIntake(true)}
              className="flex items-center gap-1.5 rounded-xl font-bold text-white transition-all"
              style={{ minHeight: '38px', padding: '0 16px', background: 'var(--brand-primary)', fontSize: '14px' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary-dark)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary)')}
            >
              <Plus className="w-4 h-4" />
              קליטת סחורה
            </button>
            </div>
          }
        >
          {deliveries.length === 0 ? (
            <EmptyRow text="אין סחורה עבור ספק זה" />
          ) : (
            deliveries.map((dn) => {
              const d = dn as unknown as { id: string; date: string; status: string; stage?: PipelineStage; driveFileLink?: string; storage_url?: string; noteNumber?: string; lineItems?: string; intakeSource?: DeliveryNote['intakeSource'] }
              const hasDoc = !!(d.driveFileLink || d.storage_url)
              // The pipeline stage, in the SAME words the manager sees. This row used
              // to say ממתין / בארכיון — a fourth status vocabulary, unrelated to the
              // chain the record is actually in, which is why the employee could not
              // see the pipeline at all.
              const stage: PipelineStage = d.stage ?? 'awaiting_invoice'
              return (
                <div
                  key={d.id}
                  className="grid items-center border-b"
                  style={{ gridTemplateColumns: 'auto 1fr auto 44px', gap: '12px', borderColor: '#EEEEF2', minHeight: '58px', padding: '12px 16px' }}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenPipeline?.(d.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onOpenPipeline?.(d.id) }}
                >
                  {/* Compact and label-less: in a row the badge beside it carries the
                      words, and the strip is here to be read as a shape. */}
                  <PipelineStrip stage={stage} compact showLabels={false} hasInvoice={!!(dn as { linkedInvoiceId?: string }).linkedInvoiceId} />
                  <div style={{ minWidth: 0 }}>
                    <p className="text-right text-gray-600" style={{ fontSize: '13px', margin: 0 }}>
                      {orderMeta.get(d.id)?.description || d.noteNumber || d.id} · {d.date}
                    </p>
                    {/* Where the row came from, in the employee's list too — she is
                        the one who photographed or typed it. */}
                    <p className="text-right" style={{ fontSize: '11px', color: '#9CA3AF', margin: '2px 0 0' }}>
                      {intakeShort(d.intakeSource)}
                    </p>
                    {orderMeta.get(d.id)?.customerName && (
                      <p className="text-right" style={{ fontSize: '11.5px', color: 'var(--brand-primary)', margin: '2px 0 0', fontWeight: 600 }}>
                        עבור {orderMeta.get(d.id)!.customerName}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={stage} />
                  <div className="flex justify-center">
                    {hasDoc ? (
                      <IconBtn title="צפייה במסמך המקורי" onClick={() => openDoc(d.driveFileLink, d.storage_url)}>
                        <Eye className="w-4 h-4" />
                      </IconBtn>
                    ) : (
                      <IconBtn
                        title="צפייה בפרטים"
                        onClick={() => setMetaModal({
                          title: 'תעודת משלוח', Icon: Truck,
                          rows: [
                            { label: 'ספק', value: supplier.name },
                            { label: 'מספר תעודה', value: d.noteNumber || '—' },
                            { label: 'תאריך', value: d.date || '—' },
                          ],
                          items: d.lineItems,
                        })}
                      >
                        <List className="w-4 h-4" />
                      </IconBtn>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </SectionShell>
      )}

      {/* ── Returns ── */}
      {activeSection === 'returns' && (
        <SectionShell
          title="חזרות"
          Icon={RotateCcw}
          count={returns.length}
          action={
            <button
              onClick={openAddReturn}
              className="flex items-center gap-1.5 rounded-xl font-bold text-white transition-all"
              style={{ minHeight: '38px', padding: '0 16px', background: 'var(--brand-primary)', fontSize: '14px' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary-dark)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary)')}
            >
              <Plus className="w-4 h-4" />
              הוסף חזרה
            </button>
          }
        >
          {returns.length === 0 ? (
            <EmptyRow text="אין חזרות עבור ספק זה" />
          ) : (
            returns.map((r) => {
              const st = returnStatusStyle[r.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
              const hasDoc = !!r.driveFileLink
              return (
                <div
                  key={r.id}
                  className="grid items-center border-b"
                  style={{ gridTemplateColumns: '80px 1fr 78px 44px', borderColor: '#EEEEF2', minHeight: '56px', padding: '12px 16px', textAlign: 'right' }}
                >
                  <span className="text-gray-500" style={{ fontSize: '13px' }}>{r.date}</span>
                  <span className="text-gray-600 truncate" style={{ fontSize: '13px', paddingLeft: '8px' }} title={r.reason}>{r.reason}</span>
                  <span className="rounded-lg font-bold text-center" style={{ ...st, fontSize: '12px', padding: '4px 8px' }}>{r.status}</span>
                  <div className="flex justify-center">
                    {hasDoc ? (
                      <IconBtn title="צפייה במסמך הזיכוי" onClick={() => openDoc(r.driveFileLink)}>
                        <Eye className="w-4 h-4" />
                      </IconBtn>
                    ) : (
                      <IconBtn
                        title="צפייה בפרטים"
                        onClick={() => setMetaModal({
                          title: 'החזרה', Icon: RotateCcw,
                          rows: [
                            { label: 'ספק', value: supplier.name },
                            { label: 'תאריך', value: r.date || '—' },
                            { label: 'סיבה', value: r.reason || '—' },
                          ],
                          note: r.detail,
                        })}
                      >
                        <List className="w-4 h-4" />
                      </IconBtn>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </SectionShell>
      )}

      {/* Reused returns popup */}
      {showReturnForm && (
        <ReturnFormModal
          form={returnForm}
          setForm={setReturnForm}
          isEdit={false}
          onSave={handleSaveReturn}
          onClose={() => setShowReturnForm(false)}
          suppliers={suppliers}
          invoices={allInvoices}
          employees={employees}
        />
      )}

      {/* Manual goods-receipt creation (employee operational write → POST /delivery-notes) */}
      {showReceiptForm && (
        <ReceiptFormModal
          form={receiptForm}
          setForm={setReceiptForm}
          supplierName={supplier.name}
          employees={employees}
          onSave={handleSaveReceipt}
          onClose={() => setShowReceiptForm(false)}
        />
      )}

      {/* Arrived record → source document image/PDF (a printed amount on the scan
          is acceptable, same rule as invoices). */}
      {docView && (
        <PdfPreviewModal url={docView.url} previewSrc={docView.previewSrc} onClose={() => setDocView(null)} />
      )}

      {/* Manual record → operational details only, no monetary amounts. */}
      {metaModal && <MetaModal {...metaModal} onClose={() => setMetaModal(null)} />}


    </div>
  )
}
