import { useState } from 'react'
import { User, Phone, Mail, Hash, Tag, MessageSquare, FileText, Truck, RotateCcw, Plus, Search, Eye, ChevronRight, List, X } from 'lucide-react'
import { useInvoices } from '../../hooks/useInvoices'
import { useDeliveryNotes } from '../../hooks/useDeliveryNotes'
import { useReturns } from '../../hooks/useReturns'
import { useEmployees } from '../../hooks/useEmployees'
import { useSuppliers } from '../../hooks/useSuppliers'
import SectionHeader from '../SectionHeader'
import { SearchableSelect } from '../SearchableSelect'
import { PdfPreviewModal } from '../PdfPreviewModal'
import { supabase } from '../../lib/supabase'
import { STATUS } from '../../theme/status'
import type { Invoice } from '../../data/mockData'
import {
  FormModal as ReturnFormModal,
  emptyForm,
  type FormState,
} from '../Returns'
import { isoToDisplay } from '../../lib/dates'
import { DateField } from '../ui/form'

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
}

// Status colors from the FIXED functional tokens (src/theme/status.ts) — same
// palette as the manager screens: yellow=check, green=done, orange=in_progress, red.
const invoiceStatusStyle: Record<string, { bg: string; color: string }> = {
  'ממתין':  { bg: STATUS.yellow.bg, color: STATUS.yellow.fg },
  'שולם':   { bg: STATUS.green.bg,  color: STATUS.green.fg },
  'בטיפול': { bg: STATUS.orange.bg, color: STATUS.orange.fg },
}

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

// Read-only invoice view for employees: non-financial metadata + the original
// document (image/PDF). NO before-VAT / VAT / total, NO inputs, NO save — the
// employee can view the scanned source but never edit the app's invoice data.
function EmployeeInvoiceView({ invoice, onBack }: { invoice: Invoice; onBack: () => void }) {
  const [showDoc, setShowDoc] = useState(false)
  const docUrl = (invoice.driveFileLink || invoice.storage_url || '').trim()
  const st = invoiceStatusStyle[invoice.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
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

      {/* Non-financial metadata (read-only text, no inputs) */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#EEEEF2' }}>
        <div className="flex items-center gap-2 border-b" style={{ padding: '14px 24px', borderColor: '#EEEEF2', background: '#FAFAFC' }}>
          <h2 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>פרטי חשבונית</h2>
          <FileText className="w-4 h-4 text-gray-400" />
          <span className="rounded-lg font-bold" style={{ ...st, fontSize: '12px', padding: '4px 10px', marginInlineStart: 'auto' }}>{invoice.status || '—'}</span>
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

      {/* Original document (image/PDF) — viewing only, no download of app data */}
      <div className="bg-white rounded-2xl shadow-sm border p-4" style={{ borderColor: '#EEEEF2' }}>
        {docUrl ? (
          <button
            onClick={() => setShowDoc(true)}
            className="flex items-center gap-2 rounded-xl font-bold text-white w-full justify-center transition-all"
            style={{ minHeight: '48px', background: 'var(--brand-primary)', fontSize: '15px' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary-dark)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary)')}
          >
            <Eye className="w-5 h-5" />
            צפייה במסמך המקורי
          </button>
        ) : (
          <p className="text-center text-gray-400 py-2" style={{ fontSize: '14px' }}>אין מסמך מצורף</p>
        )}
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

export default function EmployeeSupplierView({ supplier, activeSection }: Props) {
  const { data: allInvoices } = useInvoices()
  const { data: allDeliveries, create: createDeliveryNote } = useDeliveryNotes()
  const { data: allReturns, create: createReturn } = useReturns()
  const { data: employees }        = useEmployees()
  const { data: suppliers }        = useSuppliers()

  const [invoiceQuery, setInvoiceQuery] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnForm, setReturnForm] = useState<FormState>(emptyForm())
  const [showReceiptForm, setShowReceiptForm] = useState(false)
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
  const invoices = allInvoices.filter(
    (inv) => inv.supplierId === supplier.id || inv.supplier === supplier.name,
  )
  const deliveries = allDeliveries.filter(
    (dn) => dn.supplierId === supplier.id || dn.supplierName === supplier.name,
  )
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

  // ── Manual goods-receipt (delivery note) — persists via useDeliveryNotes.create ──
  function openAddReceipt() {
    setReceiptForm({ isoDate: new Date().toISOString().slice(0, 10), items: '', noteNumber: '', employeeId: '' })
    setShowReceiptForm(true)
  }

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
    return <EmployeeInvoiceView invoice={selectedInvoice} onBack={() => setSelectedInvoice(null)} />
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
              const st = invoiceStatusStyle[inv.status] ?? { bg: '#F3F4F6', color: '#6B7280' }
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
                    <span className="rounded-lg font-bold" style={{ ...st, fontSize: '12px', padding: '4px 10px' }}>{inv.status || '—'}</span>
                  </div>
                  {/* No amount — employees see the document, not the app's money data */}
                  <Eye className="w-4 h-4" style={{ color: '#9CA3AF' }} />
                </div>
              )
            })
          )}
        </SectionShell>
      )}

      {/* ── Delivery notes ── */}
      {activeSection === 'deliveries' && (
        <SectionShell
          title="תעודות משלוח"
          Icon={Truck}
          count={deliveries.length}
          action={
            <button
              onClick={openAddReceipt}
              className="flex items-center gap-1.5 rounded-xl font-bold text-white transition-all"
              style={{ minHeight: '38px', padding: '0 16px', background: 'var(--brand-primary)', fontSize: '14px' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary-dark)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-primary)')}
            >
              <Plus className="w-4 h-4" />
              קליטת סחורה
            </button>
          }
        >
          {deliveries.length === 0 ? (
            <EmptyRow text="אין תעודות משלוח עבור ספק זה" />
          ) : (
            deliveries.map((dn) => {
              const d = dn as unknown as { id: string; date: string; status: string; driveFileLink?: string; storage_url?: string; noteNumber?: string; lineItems?: string }
              const hasDoc = !!(d.driveFileLink || d.storage_url)
              return (
                <div
                  key={d.id}
                  className="grid items-center border-b"
                  style={{ gridTemplateColumns: '1fr 90px 44px', borderColor: '#EEEEF2', minHeight: '56px', padding: '12px 16px' }}
                >
                  <p className="text-right text-gray-500" style={{ fontSize: '13px' }}>{(d.noteNumber || d.id)} · {d.date}</p>
                  <span className="text-center text-gray-400" style={{ fontSize: '12px' }}>
                    {d.status === 'archived' ? 'בארכיון' : 'ממתין'}
                  </span>
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
