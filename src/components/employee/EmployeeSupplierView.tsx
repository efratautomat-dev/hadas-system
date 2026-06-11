import { useState } from 'react'
import { User, Phone, Mail, Hash, Tag, MessageSquare, FileText, Truck, RotateCcw, Plus, Search } from 'lucide-react'
import { useInvoices } from '../../hooks/useInvoices'
import { useDeliveryNotes } from '../../hooks/useDeliveryNotes'
import { useReturns } from '../../hooks/useReturns'
import { useEmployees } from '../../hooks/useEmployees'
import { useSuppliers } from '../../hooks/useSuppliers'
import SectionHeader from '../SectionHeader'
import { InvoiceDetail } from '../Invoices'
import type { Invoice } from '../../data/mockData'
import {
  FormModal as ReturnFormModal,
  emptyForm,
  isoToDisplay,
  type FormState,
} from '../Returns'

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

function fmtILS(n: number | null | undefined) {
  return '₪' + (n ?? 0).toLocaleString('he-IL')
}

const invoiceStatusStyle: Record<string, { bg: string; color: string }> = {
  'ממתין':  { bg: '#FEF9C3', color: '#A16207' },
  'שולם':   { bg: '#DCFCE7', color: '#166534' },
  'בטיפול': { bg: '#DBEAFE', color: '#1E40AF' },
}

const returnStatusStyle: Record<string, { bg: string; color: string }> = {
  'אושר':   { bg: '#DCFCE7', color: '#166534' },
  'בטיפול': { bg: '#FEF3C7', color: '#D97706' },
  'נדחה':   { bg: '#FEE2E2', color: '#DC2626' },
}

function SectionShell({ title, Icon, count, children, action }: {
  title: string
  Icon: typeof FileText
  count: number
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
      <SectionHeader
        className="px-5 py-4 border-b"
        style={{ borderColor: '#E2E4E9' }}
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

export default function EmployeeSupplierView({ supplier, activeSection }: Props) {
  const { data: allInvoices, update: updateInvoice } = useInvoices()
  const { data: allDeliveries }    = useDeliveryNotes()
  const { data: allReturns, create: createReturn } = useReturns()
  const { data: employees }        = useEmployees()
  const { data: suppliers }        = useSuppliers()

  const [invoiceQuery, setInvoiceQuery] = useState('')
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnForm, setReturnForm] = useState<FormState>(emptyForm())

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

  async function handleSaveReturn() {
    const amount = Number(returnForm.amountStr)
    if (!returnForm.supplierId || !amount || !returnForm.reason.trim() || !returnForm.dateIso) return
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
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E2E4E9' }}>
        <div className="flex items-center gap-2 border-b" style={{ padding: '14px 24px', borderColor: '#E2E4E9', background: '#FDFAFA' }}>
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
              borderTop: i > 0 ? '1px solid #E2E4E9' : undefined,
            }}
          >
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', direction: 'rtl', fontSize: '14px', color: '#1F2937', fontWeight: 500 }}>
              {value || '—'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              <span style={{ width: '110px', textAlign: 'right', direction: 'rtl', fontSize: '13px', color: '#9CA3AF' }}>{label}</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#F8F9FA' }}>
                <Icon className="w-3.5 h-3.5" style={{ color: '#8B1A3A' }} />
              </div>
            </div>
          </div>
        ))}
        {supplier.notes && (
          <div
            style={{
              direction: 'ltr',
              display: 'flex', alignItems: 'flex-start', gap: '12px',
              padding: '14px 24px', borderTop: '1px solid #E2E4E9',
            }}
          >
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', direction: 'rtl', fontSize: '14px', color: '#1F2937', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {supplier.notes}
            </span>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexShrink: 0 }}>
              <span style={{ width: '110px', textAlign: 'right', direction: 'rtl', fontSize: '13px', color: '#9CA3AF', paddingTop: '5px' }}>הערות</span>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#F8F9FA' }}>
                <MessageSquare className="w-3.5 h-3.5" style={{ color: '#8B1A3A' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Invoices ── */}
      {activeSection === 'invoices' && (
        <SectionShell title="חשבוניות" Icon={FileText} count={shownInvoices.length}>
          <div className="px-5 py-3 border-b" style={{ borderColor: '#E2E4E9' }}>
            <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: '#E2E4E9', height: '40px' }}>
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
                  className="grid items-center border-b"
                  style={{ gridTemplateColumns: '1fr 80px 120px', borderColor: '#E2E4E9', minHeight: '56px', padding: '12px 16px' }}
                >
                  <p className="text-right text-gray-500" style={{ fontSize: '13px' }}>{num} · {inv.date}</p>
                  <div className="flex justify-center">
                    <span className="rounded-lg font-bold" style={{ ...st, fontSize: '12px', padding: '4px 10px' }}>{inv.status || '—'}</span>
                  </div>
                  <span className="text-left font-black text-gray-800" style={{ fontSize: '14px' }}>{fmtILS(inv.amount)}</span>
                </div>
              )
            })
          )}
        </SectionShell>
      )}

      {/* ── Delivery notes ── */}
      {activeSection === 'deliveries' && (
        <SectionShell title="תעודות משלוח" Icon={Truck} count={deliveries.length}>
          {deliveries.length === 0 ? (
            <EmptyRow text="אין תעודות משלוח עבור ספק זה" />
          ) : (
            deliveries.map((dn) => (
              <div
                key={dn.id}
                className="grid items-center border-b"
                style={{ gridTemplateColumns: '1fr 100px 120px', borderColor: '#E2E4E9', minHeight: '56px', padding: '12px 16px' }}
              >
                <p className="text-right text-gray-500" style={{ fontSize: '13px' }}>{dn.id} · {dn.date}</p>
                <span className="text-center text-gray-400" style={{ fontSize: '12px' }}>
                  {dn.status === 'archived' ? 'בארכיון' : 'ממתין'}
                </span>
                <span className="text-left font-black text-gray-800" style={{ fontSize: '14px' }}>{fmtILS(dn.amount)}</span>
              </div>
            ))
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
              style={{ minHeight: '38px', padding: '0 16px', background: '#7C3AED', fontSize: '14px' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#6D28D9')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#7C3AED')}
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
              return (
                <div
                  key={r.id}
                  className="grid items-center border-b"
                  style={{ gridTemplateColumns: '90px 1fr 90px 90px', borderColor: '#E2E4E9', minHeight: '56px', padding: '12px 16px', textAlign: 'right' }}
                >
                  <span className="text-gray-500" style={{ fontSize: '13px' }}>{r.date}</span>
                  <span className="text-gray-600 truncate" style={{ fontSize: '13px', paddingLeft: '8px' }} title={r.reason}>{r.reason}</span>
                  <span className="font-bold" style={{ color: '#7C3AED', fontSize: '14px' }}>{fmtILS(r.amount)}</span>
                  <span className="rounded-lg font-bold text-center" style={{ ...st, fontSize: '12px', padding: '4px 8px' }}>{r.status}</span>
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

    </div>
  )
}
