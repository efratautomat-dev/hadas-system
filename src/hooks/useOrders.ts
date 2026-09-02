import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { isoToDisplay } from '../lib/dates'

// ── Orders (spec ch. 7) ──────────────────────────────────────────────────────
// The board that replaces the WhatsApp group: a supplier, free text, a date.
//
// 🔑 D22 — AN ORDER IS NOT A SOURCE OF TRUTH. It is an indication that something
// was asked for. Quantity and money are settled by the delivery note against the
// invoice, never from here, and nothing in this hook may ever reach the ledger.
// It exists to catch goods early and to answer a waiting customer.

export type OrderStatus = 'order_waiting' | 'order_arrived' | 'order_partial'

/** A delivery already waiting for an invoice, offered instead of opening a new row. */
export interface ArrivalCandidate {
  id: string
  note_number: string | null
  date: string | null
  supplier_name: string | null
}

export interface Order {
  id: string
  supplierId: string
  supplierName: string
  description: string
  /** YYYY-MM-DD */
  isoDate: string
  /** DD/MM/YYYY */
  date: string
  status: OrderStatus
  arrivedAt: string | null
  /** §7.j — what arrived differs from what was ordered. DOCUMENTATION ONLY. */
  arrivedDiffers: boolean
  /** Set once "הגיע" opened or linked a delivery row; that row is in the pipeline. */
  deliveryNoteId: string | null
  customerName: string | null
  customerPhone: string | null
  /** DD/MM/YYYY, or '' when unknown — the common case. */
  expectedDate: string
}

export function useOrders() {
  const [data, setData]       = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      // `orders` carries no money columns, so unlike invoices/suppliers/delivery
      // notes there is no masking view to read through — the base table is the
      // whole story and employees are meant to see it.
      const { data: rows, error: err } = await supabase
        .from('orders').select('*').order('date', { ascending: false })
      if (err) {
        setError(err.message)
        setData([])
      } else {
        setData((rows ?? []).map(r => ({
          id:             String(r.id),
          supplierId:     r.supplier_id   ?? '',
          supplierName:   r.supplier_name ?? '',
          description:    r.description   ?? '',
          isoDate:        r.date          ?? '',
          date:           isoToDisplay(r.date ?? ''),
          status:         (r.status as OrderStatus) ?? 'order_waiting',
          arrivedAt:      r.arrived_at      ?? null,
          arrivedDiffers: r.arrived_differs ?? false,
          deliveryNoteId: r.delivery_note_id ?? null,
          customerName:   r.customer_name  ?? null,
          customerPhone:  r.customer_phone ?? null,
          expectedDate:   isoToDisplay(r.expected_date ?? ''),
        })))
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Same load-on-mount idiom as the twelve sibling hooks. The rule fires on all of
  // them and those instances are part of the repo's documented eslint baseline;
  // silenced HERE rather than written differently, because one hook that fetches
  // its data in a shape nothing else uses is the worse outcome. Whoever changes
  // the pattern should change it for all of them at once.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const create = async (body: {
    supplierId: string; supplierName: string; description: string
    /** YYYY-MM-DD. Optional — the owner usually does not know (§7.7). */
    expectedDate?: string
    customerName?: string
    customerPhone?: string
  }) => {
    try {
      const res = await api.post('/orders', {
        supplier_id: body.supplierId, supplier_name: body.supplierName,
        description: body.description,
        // Empty strings are sent as null, not as ''. A blank customer name stored
        // as '' is a customer the screens then try to display.
        expected_date:  body.expectedDate  || null,
        customer_name:  body.customerName  || null,
        customer_phone: body.customerPhone || null,
      })
      await load()
      return (res as { id?: string }).id
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`שגיאה בפתיחת ההזמנה: ${msg}`)
      throw err
    }
  }

  /** A delivery already waiting for an invoice, offered instead of opening a new one. */
  /**
   * One click: mark arrived and feed the pipeline (§7.e).
   *
   * Returns `needsChoice` when the supplier already has deliveries waiting for an
   * invoice — the usual case, because the note arrives by email before the goods.
   * The caller must then ASK; answering with `adopt` attaches that row, `forceNew`
   * opens a fresh one. Deciding here would silently merge two deliveries that
   * happen to share a supplier and a week.
   */
  const markArrived = async (
    id: string,
    partial = false,
    choice?: { adopt?: string; forceNew?: boolean },
  ): Promise<{ needsChoice?: boolean; candidates?: ArrivalCandidate[] }> => {
    try {
      const res = await api.put(`/orders/${id}/arrived`, {
        partial,
        delivery_note_id: choice?.adopt,
        force_new:        choice?.forceNew,
      }) as { needsChoice?: boolean; candidates?: ArrivalCandidate[] }
      if (res?.needsChoice) return res
      await load()
      return {}
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`שגיאה בסימון ההגעה: ${msg}`)
      throw err
    }
  }

  /**
   * Open orders for one supplier, NEAREST DATE FIRST (§7.7) — the shape the
   * employee's "is there an order waiting for this?" question needs. Sorted here
   * rather than at each call site so the two screens that ask it cannot disagree.
   */
  const openForSupplier = useCallback((supplierId: string): Order[] =>
    data
      .filter(o => o.supplierId === supplierId && o.status !== 'order_arrived')
      .sort((a, b) => (b.isoDate || '').localeCompare(a.isoDate || '')),
    [data])

  return { data, loading, error, create, markArrived, openForSupplier, reload: load }
}
