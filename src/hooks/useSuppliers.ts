import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { mockSuppliers } from '../data/mockData'

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
        supabase.from('invoices').select('supplier_name, total_amount'),
        supabase.from('payments').select('supplier_id, amount, status'),
      ])

      if (!err && rows && rows.length > 0) {
        const invByName: Record<string, number> = {}
        for (const inv of invoiceRows ?? []) {
          const name = (inv.supplier_name as string) ?? ''
          invByName[name] = (invByName[name] ?? 0) + Number(inv.total_amount ?? 0)
        }
        const payById: Record<string, number> = {}
        for (const pay of paymentRows ?? []) {
          if (pay.status !== 'cancelled' && pay.supplier_id) {
            payById[pay.supplier_id] = (payById[pay.supplier_id] ?? 0) + Number(pay.amount ?? 0)
          }
        }

        setData(rows.map(r => {
          const openingBalance = Number(r.opening_balance ?? 0)
          const currentBalance = openingBalance
            + (invByName[r.name] ?? 0)
            - (payById[r.id]    ?? 0)
          return {
            ...r,
            hp:             r.hp      ?? '',
            contact:        r.contact ?? '',
            // Fields not in DB — provide safe defaults so UI doesn't break
            status:         'פעיל',
            paymentTerms:   '',
            lastOrderDate:  '',
            openingBalance,
            openingBalanceDate: '',
            balance:        currentBalance,
          }
        }) as SupplierRow[])
        setError(null)
      } else {
        setData(mockSuppliers)
        if (err) setError(err.message)
      }
    } catch {
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
