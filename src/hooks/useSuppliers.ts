import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { mockSuppliers } from '../data/mockData'
import { computeSupplierBalance } from '../lib/supplierBalance'

export type SupplierRow = typeof mockSuppliers[number]

export function useSuppliers() {
  const [data, setData]       = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [
        { data: rows,        error: err },
        { data: invoiceRows },
        { data: paymentRows },
      ] = await Promise.all([
        supabase.from('suppliers').select('*'),
        supabase.from('invoices').select('supplier_id, total_amount'),
        supabase.from('payments').select('supplier_id, amount, status'),
      ])

      if (!err && rows && rows.length > 0) {
        // Group invoices/payments per supplier by SUPPLIER_ID (the business-number
        // -derived FK), never by name (spec/06-RULES.md §2b). The balance itself is
        // computed via the shared computeSupplierBalance helper so the list and the
        // detail page can never diverge.
        const invById: Record<string, { total_amount: number }[]> = {}
        for (const inv of invoiceRows ?? []) {
          const sid = inv.supplier_id as string | null
          if (sid) (invById[sid] ??= []).push({ total_amount: Number(inv.total_amount ?? 0) })
        }
        const payById: Record<string, { amount: number; status: string }[]> = {}
        for (const pay of paymentRows ?? []) {
          const sid = pay.supplier_id as string | null
          if (sid) (payById[sid] ??= []).push({ amount: Number(pay.amount ?? 0), status: String(pay.status ?? '') })
        }

        setData(rows.map(r => {
          const openingBalance = Number(r.opening_balance ?? 0)
          const currentBalance = computeSupplierBalance(openingBalance, invById[r.id] ?? [], payById[r.id] ?? [])
          return {
            ...r,
            hp:             r.hp      ?? '',
            contact:        r.contact ?? '',
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

  const create = async (body: Record<string, unknown>): Promise<string | null> => {
    console.log('[useSuppliers] create payload:', body)
    try {
      const res = await api.post('/suppliers', body) as { id?: string }
      console.log('[useSuppliers] create response:', res)
      await load()
      return res?.id ?? null
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

  return { data, loading, error, create, update, remove }
}
