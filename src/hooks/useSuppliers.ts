import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { mockSuppliers } from '../data/mockData'
import { buildLedger } from '../lib/supplierLedger'
import type { ResetLike } from '../lib/ledgerEngine'
import { subscribe } from '../lib/dataBus'

export type SupplierRow = typeof mockSuppliers[number]

// The shapes this hook hands the ledger engine. Deliberately the raw VIEW column
// names — the engine accepts both spellings precisely because this hook reads
// `invoices_v` / `payments` directly, with no camelCase mapping in between.
type LedgerInvoiceRow = {
  id: string
  supplier_id?: string | null
  total_amount?: number | string | null
  invoice_date?: string | null
  is_duplicate?: boolean | null
  has_error?: boolean | null
  awaiting_approval?: boolean | null
  ledger_approved_at?: string | null
}
type LedgerPaymentRow = {
  id: string | number
  supplier_id?: string | null
  amount?: number | string | null
  date?: string | null
  payment_date?: string | null
  status?: string | null
  receipt_settled_at?: string | null
}

// Result of a create call. `duplicate` + `existing` are set when the backend dedup
// matched an existing supplier and did NOT create (the UI then prompts the user).
export interface CreateSupplierResult {
  id?: string | null
  duplicate?: boolean
  existing?: { id: string; name: string; hp: string | null }
}

// Merge (dry-run) preview: how many rows would move from the removed card, plus the
// ח.פ carry-over / conflict flags the confirm dialog uses.
export interface MergePreview {
  preview: true
  from: { id: string; name: string; hp: string | null }
  into: { id: string; name: string; hp: string | null }
  counts: Record<string, number>
  hpCarryOver: boolean
  hpConflict: boolean
}

// Result of the real (committed) merge — the authoritative moved-row counts.
export interface MergeResult {
  success: true
  into: { id: string; name: string }
  moved: Record<string, number>
}

export function useSuppliers() {
  const [data, setData]       = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  // invoice count per supplier_id — drives the merge modal's default "keep the card
  // with more invoices". Derived from the same invoice read as the balances below.
  const [invoiceCounts, setInvoiceCounts] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    try {
      const [
        { data: rows,        error: err },
        { data: invoiceRows },
        { data: paymentRows },
        { data: resetRows },
      ] = await Promise.all([
        supabase.from('suppliers_v').select('*'),
        // `invoice_date` and the payment `date` are new to this read: a ledger
        // reset zeroes the balance AS OF A DAY, so the list can no longer answer
        // "what is owed" from undated sums. `id` comes along because the engine
        // keys rows by it.
        supabase.from('invoices_v').select('id, supplier_id, total_amount, invoice_date, is_duplicate, has_error, awaiting_approval, ledger_approved_at'),
        supabase.from('payments').select('id, supplier_id, amount, payment_date, status, receipt_settled_at'),
        supabase.from('ledger_resets').select('id, supplier_id, reset_on, reason'),
      ])

      if (!err && rows && rows.length > 0) {
        // Group invoices/payments per supplier by SUPPLIER_ID (the business-number
        // -derived FK), never by name (spec/06-RULES.md §2b). Count ALL invoices per
        // supplier — the card's invoice count is unchanged — while the BALANCE is
        // the engine's, which is what keeps this card and the supplier page from
        // answering differently.
        //
        // ⚠️ The balance here is built by the ENGINE, not by summing.
        // `computeSupplierBalance` adds figures with no dates, and a reset zeroes a
        // ledger AS OF A DAY — a sum cannot express that, so the list would have
        // gone on showing the pre-reset figure while every other screen showed the
        // new one. That is precisely the three-different-balances failure of
        // spec/06-RULES.md §9, and it would have arrived the same week the guard
        // against it was written.
        //
        // Excluded rows are no longer filtered out here either: the engine zeroes
        // them itself. Two places applying one rule is how they drift.
        const invById: Record<string, LedgerInvoiceRow[]> = {}
        const invCountById: Record<string, number> = {}
        for (const inv of invoiceRows ?? []) {
          const sid = inv.supplier_id as string | null
          if (!sid) continue
          invCountById[sid] = (invCountById[sid] ?? 0) + 1
          ;(invById[sid] ??= []).push(inv as LedgerInvoiceRow)
        }
        setInvoiceCounts(invCountById)
        const payById: Record<string, LedgerPaymentRow[]> = {}
        for (const pay of paymentRows ?? []) {
          const sid = pay.supplier_id as string | null
          // `payment_date` → `date`: the engine reads `date`, and an unmapped
          // payment would arrive UNDATED — which after a reset means zeroed,
          // silently, for every payment in the system.
          if (sid) (payById[sid] ??= []).push({ ...pay, date: pay.payment_date } as LedgerPaymentRow)
        }
        const resets = (resetRows ?? []) as ResetLike[]

        setData(rows.map(r => {
          const openingBalance = Number(r.opening_balance ?? 0)
          // "בהסדר תשלום": display-only exclusion — balance forced to 0 via the shared
          // helper, real invoices/payments untouched (spec: reversible by unchecking).
          const paymentArrangement = r.payment_arrangement ?? false
          const currentBalance = buildLedger(
            r.id, invById[r.id] ?? [], payById[r.id] ?? [], openingBalance,
            { paymentArrangement, resets },
          ).closingBalance
          return {
            ...r,
            hp:             r.hp      ?? '',
            contact:        r.contact ?? '',
            paymentArrangement,
            // Active/inactive: derived from the `active` column. Until that column
            // exists (r.active === undefined) everyone defaults to active ('פעיל');
            // only an explicit active=false marks a supplier inactive ('לא פעיל').
            status:         r.active === false ? 'לא פעיל' : 'פעיל',
            paymentTerms:   '',
            lastOrderDate:  '',
            openingBalance,
            openingBalanceDate: '',
            balance:        currentBalance,
          }
        }) as SupplierRow[])
        setError(null)
      } else {
        console.warn(
          '[useSuppliers] falling back to mockSuppliers — supabase returned no rows or an error:',
          err ?? '(no rows)',
        )
        setData(mockSuppliers)
        if (err) setError(err.message)
      }
    } catch (e) {
      console.warn('[useSuppliers] falling back to mockSuppliers — exception thrown:', e)
      setData(mockSuppliers)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])


  useEffect(() => subscribe(['suppliers', 'invoices', 'payments', 'ledger_resets'], load), [load])

  // Returns the raw create result. On a dedup hit the backend does NOT create and
  // returns { duplicate:true, existing:{...} } so the UI can ask the user; pass
  // { force:true } ("create anyway") to bypass dedup and force a new supplier.
  const create = async (
    body: Record<string, unknown>,
    opts?: { force?: boolean },
  ): Promise<CreateSupplierResult> => {
    const payload = opts?.force ? { ...body, force: true } : body
    console.log('[useSuppliers] create payload:', payload)
    try {
      const res = await api.post('/suppliers', payload) as CreateSupplierResult
      console.log('[useSuppliers] create response:', res)
      if (!res?.duplicate) await load()   // only a real create changes the list
      return res ?? { id: null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useSuppliers] create error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const update = async (id: string, body: Record<string, unknown>) => {
    console.log('[useSuppliers] update payload:', { id, ...body })
    try {
      const res = await api.put(`/suppliers/${id}`, body)
      console.log('[useSuppliers] update response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useSuppliers] update error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const remove = async (id: string) => {
    console.log('[useSuppliers] delete id:', id)
    try {
      const res = await api.delete(`/suppliers/${id}`)
      console.log('[useSuppliers] delete response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useSuppliers] delete error:', msg)
      setError(`שגיאה במחיקה: ${msg}`)
      throw err
    }
  }

  // Merge suppliers. fromId is REMOVED, intoId is KEPT. dryRun returns a preview of
  // the moved-row counts WITHOUT mutating; a real merge re-loads the list afterwards.
  // Overloaded return type keeps callers honest about which shape they get back.
  async function merge(fromId: string, intoId: string, opts: { dryRun: true }): Promise<MergePreview>
  async function merge(fromId: string, intoId: string, opts?: { dryRun?: false }): Promise<MergeResult>
  async function merge(fromId: string, intoId: string, opts?: { dryRun?: boolean }): Promise<MergePreview | MergeResult> {
    const dryRun = opts?.dryRun === true
    try {
      const res = await api.post('/suppliers/merge', { fromId, intoId, dryRun })
      if (!dryRun) await load()   // survivor's rows changed — refresh
      return res as MergePreview | MergeResult
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useSuppliers] merge error:', msg)
      if (!dryRun) setError(`שגיאה במיזוג: ${msg}`)
      throw err
    }
  }

  return { data, loading, error, invoiceCounts, create, update, remove, merge }
}
