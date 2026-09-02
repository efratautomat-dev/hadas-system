import { useState } from 'react'
import { X, Check, Package } from 'lucide-react'
import { SearchableSelect } from '../SearchableSelect'
import { FieldLabel, TextInput, Textarea } from '../ui/form'

// ── Opening an order (spec ch. 7) ────────────────────────────────────────────
//
// The order is the pipeline's ENTRY POINT, not a parallel entity (D23): the
// moment an employee marks it arrived it becomes a delivery waiting for an
// invoice. So this form asks for the least that identifies what was ordered, and
// nothing that the rest of the chain will settle on its own.
//
// Two things are deliberately absent:
//
//   · no amount. D22 — an order is never a source of truth. Money is settled by
//     the delivery note against the invoice, and a figure typed here would be a
//     second number for someone to reconcile against the real one.
//   · no status picker. A new order is always `ממתינה`. A status chosen by hand
//     is a status somebody forgets to change.
//
// The customer block (§7.8) is collapsed behind a checkbox because most orders
// are not for a customer, and a form that shows every field to everybody is read
// by nobody.

export interface OrderDraft {
  supplierId: string
  supplierName: string
  description: string
  expectedDate: string
  customerName: string
  customerPhone: string
}

export default function OrderForm({
  suppliers, onClose, onCreate, lockedSupplier, customerOnly = false,
}: {
  suppliers: { id: string; name: string; hp?: string }[]
  onClose: () => void
  onCreate: (draft: OrderDraft) => Promise<void>
  /**
   * Opened from inside a supplier's card: the supplier is known and is shown
   * rather than chosen. Removes the one field that could put the order on the
   * wrong supplier.
   */
  lockedSupplier?: { id: string; name: string }
  /**
   * The employee's version. She opens orders for CUSTOMERS only (owner's rule),
   * so the customer block is always open and required rather than optional —
   * an order with no customer is a restock, and restocks are the manager's.
   */
  customerOnly?: boolean
}) {
  const [supplierId, setSupplierId] = useState(lockedSupplier?.id ?? '')
  const [description, setDescription] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [forCustomer, setForCustomer] = useState(customerOnly)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const supplier = lockedSupplier ?? suppliers.find(s => s.id === supplierId)
  // Both are required: a supplier with no description is a row nobody can act on,
  // and a description with no supplier cannot reach the supplier's own page.
  const ready = !!supplierId && description.trim().length > 0 &&
    // A customer order with no customer cannot be handed back to anyone.
    (!customerOnly || customerName.trim().length > 0)

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setErr(null)
    try {
      await onCreate({
        supplierId,
        supplierName: supplier?.name ?? '',
        description:  description.trim(),
        expectedDate,
        // Cleared rather than carried: unchecking the box must actually drop the
        // customer, or a name typed and thought better of is saved anyway.
        customerName:  forCustomer ? customerName.trim()  : '',
        customerPhone: forCustomer ? customerPhone.trim() : '',
      })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', overflowY: 'auto', padding: '24px 12px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white shadow-2xl w-full" style={{ maxWidth: '620px', direction: 'rtl' }}>

        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#EEEEF2' }}>
          <span className="font-bold text-gray-800 inline-flex items-center gap-2" style={{ fontSize: '15px' }}>
            <Package className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
            {customerOnly ? 'הזמנה ללקוחה' : 'הזמנה חדשה'}
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}
            title="סגירה"
          ><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 grid gap-4">
          <p style={{ fontSize: '12.5px', color: '#9CA3AF', margin: 0 }}>
            {customerOnly
              ? 'ההזמנה תיפתח אצל הספק הזה. אם כבר יש לו משלוח בדרך — המנהלת תקבל התראה כדי לצרף.'
              : 'מה הוזמן, ממי. הסכום יגיע מהחשבונית.'}
          </p>

          {lockedSupplier ? (
            <div>
              <FieldLabel>ספק</FieldLabel>
              <div
                className="flex items-center justify-between"
                style={{ background: '#F3F4F6', border: '1px solid #E2E4E9', padding: '10px 14px', fontSize: '13.5px', color: '#4B5563' }}
              >
                <span style={{ fontWeight: 700 }}>{lockedSupplier.name}</span>
                <small style={{ fontSize: '10.5px', color: '#9CA3AF', fontWeight: 700 }}>מכרטיס הספק</small>
              </div>
            </div>
          ) : (
            <div>
              <FieldLabel required>ספק</FieldLabel>
              <SearchableSelect
                value={supplierId}
                onChange={setSupplierId}
                placeholder="-- בחר --"
                options={suppliers.map(s => ({ value: s.id, label: s.name, keywords: s.hp }))}
              />
              <p style={{ margin: '3px 2px 0', fontSize: '11.5px', color: '#9CA3AF' }}>
                חיפוש לפי שם או ח.פ.
              </p>
            </div>
          )}

          <div>
            <FieldLabel required>מה הוזמן</FieldLabel>
            <Textarea
              rows={3}
              value={description}
              onChange={setDescription}
              placeholder="2 ארגזי חלב 3%, 1 ארגז קוטג׳"
            />
            <p style={{ margin: '3px 2px 0', fontSize: '11.5px', color: '#9CA3AF' }}>
              טקסט חופשי — בדיוק כפי שנרשם היום בקבוצה.
            </p>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <FieldLabel>תאריך הזמנה</FieldLabel>
              {/* Not an input. §7.b — the date is today, by definition, and a field
                  that can be edited invites back-dating nobody asked for. */}
              <div
                className="flex items-center justify-between"
                style={{ background: '#F3F4F6', border: '1px solid #E2E4E9', padding: '10px 14px', fontSize: '13.5px', color: '#4B5563' }}
              >
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {new Date().toLocaleDateString('he-IL')}
                </span>
                <small style={{ fontSize: '10.5px', color: '#9CA3AF', fontWeight: 700 }}>היום</small>
              </div>
            </div>
            <div>
              <FieldLabel>צפי הגעה</FieldLabel>
              {/* TextInput owns the empty-date placeholder problem: an empty
                  native date input paints a browser-localised hint (a Hebrew
                  Chrome renders the month as מ"מ) that no CSS overrides. */}
              <TextInput type="date" value={expectedDate} onChange={setExpectedDate} />
              <p style={{ margin: '3px 2px 0', fontSize: '11.5px', color: '#9CA3AF' }}>
                לא חובה.
              </p>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #ECECEF', paddingTop: '14px' }}>
            {!customerOnly && (
            <label className="flex items-start gap-2.5" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={forCustomer}
                onChange={e => setForCustomer(e.target.checked)}
                style={{ marginTop: '5px', accentColor: 'var(--brand-primary)' }}
              />
              <span>
                <b style={{ fontSize: '13.5px' }}>הזמנה עבור לקוחה</b>
                <span style={{ display: 'block', fontSize: '11.5px', color: '#9CA3AF' }}>
                  נפתח רק בסימון — רוב ההזמנות אינן כאלה.
                </span>
              </span>
            </label>
            )}

            {forCustomer && (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: '1fr 1fr', marginTop: '12px', padding: '14px', background: 'var(--brand-active-bg)', border: '1px solid #F3D6DD' }}
              >
                <div>
                  <FieldLabel required={customerOnly}>שם הלקוחה</FieldLabel>
                  <TextInput value={customerName} onChange={setCustomerName} />
                </div>
                <div>
                  <FieldLabel>טלפון</FieldLabel>
                  <TextInput value={customerPhone} onChange={setCustomerPhone} dir="ltr" />
                </div>
                <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '11.5px', color: '#9CA3AF' }}>
                  כשההזמנה תסומן "הגיעה", הלקוחה תופיע בכרטיס כדי שאפשר יהיה להודיע לה.
                </p>
              </div>
            )}
          </div>

          {err && (
            <p style={{ margin: 0, fontSize: '13px', color: '#DC2626' }}>{err}</p>
          )}
        </div>

        <div className="px-5 pb-5 flex items-center gap-2">
          <button
            disabled={!ready || busy}
            onClick={submit}
            className="font-semibold inline-flex items-center gap-1.5 text-white"
            style={{
              background: ready ? 'var(--brand-primary)' : '#D6D7DD', border: 'none',
              padding: '9px 18px', fontSize: '13px',
              cursor: !ready ? 'not-allowed' : busy ? 'wait' : 'pointer',
            }}
          ><Check className="w-4 h-4" />{busy ? 'שומר…' : 'יצירת הזמנה'}</button>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid #E2E4E9', color: '#6B6E73', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
          >ביטול</button>
        </div>
      </div>
    </div>
  )
}
