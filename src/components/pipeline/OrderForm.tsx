import { useState } from 'react'
import { X, Check, Package } from 'lucide-react'
import { SearchableSelect } from '../SearchableSelect'
import { FieldLabel, TextInput, Textarea } from '../ui/form'
import { FormShell } from './FormShell'

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
  /**
   * Customer orders this order is carrying — ticked in the block that appears
   * the moment a supplier with waiting customers is chosen. The server marks
   * each one `הוזמנה מהספק`, because that is now true of them.
   */
  joinedOrderIds: string[]
}

export default function OrderForm({
  suppliers, onClose, onCreate, lockedSupplier, customerOnly = false, openOrders = [], inline = false,
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
  /**
   * Orders already open at the chosen supplier. Shown the moment a supplier is
   * picked, because the moment to know is BEFORE the order is written: a shipment
   * already moving can carry this item, and an alert that fires afterwards only
   * helps someone still able to act on it.
   */
  openOrders?: {
    id: string; supplierId: string; description: string; date: string
    expectedDate: string; customerName: string | null
    /** A customer already handed her goods is not waiting for anything. */
    customerStatus?: string | null
  }[]
  /**
   * Render in the page flow instead of over it. The employee screens open these
   * inline — a dialog inside a supplier card on a phone is a letterbox — while a
   * list opens the same component as a dialog, which is right when you are
   * picking one thing off a page you mean to keep.
   */
  inline?: boolean
}) {
  const [supplierId, setSupplierId] = useState(lockedSupplier?.id ?? '')
  const [description, setDescription] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [forCustomer, setForCustomer] = useState(customerOnly)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Which waiting customer orders this one is carrying. Keyed by order id so a
  // supplier changed mid-form cannot leave a tick behind on somebody else's row.
  const [joined, setJoined] = useState<Record<string, boolean>>({})

  const supplier = lockedSupplier ?? suppliers.find(s => s.id === supplierId)
  // Filtered HERE rather than by each caller: the manager picks the supplier
  // inside this form, so only this component knows which orders are relevant.
  const siblings = openOrders.filter(o => o.supplierId === supplierId)
  // ── The question that replaced an alert ───────────────────────────────────
  //
  // Customer orders waiting on this supplier's name are the ones that can ride
  // along, and this — a new order being written — is the only moment anyone can
  // still act on that. It used to be an alert fired at the employee's end of the
  // decision, which reached the manager after the window had usually closed
  // ("לבטל התראה על הזמנה מלקוחה, זה מציק", 13.10.2026).
  //
  // Not shown on the employee's own customer-order form: she is taking one order
  // for one person and has nothing to add to it.
  //
  // WAITING only. A customer order she already carried on an earlier order is
  // `customer_ordered` or further along (arrived, notified) — offering it again
  // asks her to order the same item twice. It used to exclude only `delivered`,
  // so a customer who had already been told her item was in kept coming back
  // here (25.10.2026). A row from before the column existed has no status and
  // is treated as waiting, as the notebook does.
  const waitingCustomers = customerOnly ? [] : siblings.filter(
    o => (o.customerName ?? '').trim() !== '' &&
      (o.customerStatus ?? 'customer_waiting') === 'customer_waiting',
  )
  // The plain notice keeps only the restocks, so the two blocks never say the
  // same thing twice.
  const restockSiblings = siblings.filter(o => (o.customerName ?? '').trim() === '')
  const joinedIds = waitingCustomers.filter(o => joined[o.id]).map(o => o.id)
  // The SUPPLIER is required and nothing else: an order that cannot reach a
  // supplier's page is a row nobody can act on. What was ordered is often a phone
  // call away from being known — "תזמיני מה שחסר" is a real order — and the
  // owner's decision is that a required field you cannot fill is a field people
  // put a dash in, which teaches nothing and blocks the row from existing.
  const ready = !!supplierId &&
    // A customer order with no customer cannot be handed back to anyone.
    (!customerOnly || customerName.trim().length > 0)

  // What the supplier is actually being asked for: what she typed, plus a line
  // per customer order she ticked. Composed at submit rather than written into
  // the textarea, so unticking a customer takes her line back out — a textarea
  // edited behind the user's back is a field she stops trusting.
  const joinedLines = waitingCustomers
    .filter(o => joined[o.id])
    .map(o => `עבור ${o.customerName}: ${o.description || '—'}`)
  const descriptionWithJoined = [description.trim(), ...joinedLines]
    .filter(Boolean)
    .join('\n')

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setErr(null)
    try {
      await onCreate({
        supplierId,
        supplierName: supplier?.name ?? '',
        description:  descriptionWithJoined,
        expectedDate,
        // Cleared rather than carried: unchecking the box must actually drop the
        // customer, or a name typed and thought better of is saved anyway.
        customerName:  forCustomer ? customerName.trim()  : '',
        customerPhone: forCustomer ? customerPhone.trim() : '',
        joinedOrderIds: joinedIds,
      })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <FormShell onClose={onClose} inline={inline} maxWidth={'620px'}>

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
              ? 'ההזמנה תיפתח אצל הספק הזה, ותופיע למנהלת כשתיפתח הזמנה אצלו כדי לצרף.'
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

          {/* ── לקוחות שממתינות אצל הספק הזה ─────────────────────────────────
              First, and in the brand colour rather than a warning yellow: this
              is not a caution, it is a list of things to add before sending the
              order. A person is waiting at the other end of every line. */}
          {supplierId && waitingCustomers.length > 0 && (
            <div style={{ background: 'var(--brand-active-bg)', border: '1px solid #F3D6DD', padding: '12px 14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--brand-primary)' }}>
                {waitingCustomers.length === 1
                  ? 'לקוחה אחת ממתינה אצל הספק הזה — להוסיף להזמנה?'
                  : `${waitingCustomers.length} לקוחות ממתינות אצל הספק הזה — להוסיף להזמנה?`}
              </div>
              <div className="grid gap-1.5" style={{ marginTop: '8px' }}>
                {waitingCustomers.map(o => (
                  <label
                    key={o.id}
                    className="flex items-start gap-2.5"
                    style={{ cursor: 'pointer', fontSize: '12.5px', color: '#4B5563' }}
                  >
                    <input
                      type="checkbox"
                      checked={!!joined[o.id]}
                      onChange={e => setJoined(j => ({ ...j, [o.id]: e.target.checked }))}
                      style={{ marginTop: '3px', accentColor: 'var(--brand-primary)' }}
                    />
                    <span>
                      <b style={{ color: '#2F3136' }}>{o.customerName}</b>
                      {' — '}
                      {o.description || 'ללא פירוט'}
                      {o.date ? (
                        <small style={{ color: '#9CA3AF', fontWeight: 700 }}>{` · הוזמנה ${o.date}`}</small>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#9CA3AF' }}>
                מה שתסמני ייכנס לשורת "מה הוזמן", וההזמנה של הלקוחה תסומן
                "הוזמנה מהספק". בלי סימון — שום דבר לא משתנה אצלה.
              </p>
            </div>
          )}

          {/* The restock notice, unchanged in intent and now only about restocks:
              a second order at a supplier who already has one open. */}
          {supplierId && restockSiblings.length > 0 && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', padding: '12px 14px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#92400E' }}>
                {`יש כבר ${restockSiblings.length === 1 ? 'הזמנה פתוחה' : `${restockSiblings.length} הזמנות פתוחות`} אצל הספק הזה`}
              </div>
              <ul style={{ margin: '6px 0 0', paddingInlineStart: '16px', fontSize: '12.5px', color: '#6B6E73' }}>
                {restockSiblings.slice(0, 3).map(o => (
                  <li key={o.id}>
                    {o.description || '—'}
                    {o.expectedDate ? ` · צפי ${o.expectedDate}` : ''}
                  </li>
                ))}
              </ul>
              <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: '#9CA3AF' }}>
                אפשר לצרף את מה שדרוש להזמנה קיימת במקום לפתוח חדשה.
              </p>
            </div>
          )}

          <div>
            <FieldLabel>מה הוזמן</FieldLabel>
            <Textarea
              rows={3}
              value={description}
              onChange={setDescription}
              placeholder="2 ארגזי חלב 3%, 1 ארגז קוטג׳"
            />
            <p style={{ margin: '3px 2px 0', fontSize: '11.5px', color: '#9CA3AF' }}>
              טקסט חופשי — בדיוק כפי שנרשם היום בקבוצה. אפשר גם להשאיר ריק ולהשלים
              כשהסחורה מגיעה.
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
    </FormShell>
  )
}
