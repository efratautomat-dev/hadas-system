import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export type PaymentStatus = 'paid' | 'pending' | 'cancelled'

export interface Payment {
  id:         string   // DB generates PAY-XXX
  supplier_id: string
  supplier:   string   // derived display field — not stored in payments table
  amount:     number
  type:       string   // DB: payment_type
  date:       string   // DB: payment_date (YYYY-MM-DD)
  ref:        string   // DB: reference
  valueDate:  string | null  // DB: value_date
  notes:      string
  status:     PaymentStatus
}

const FALLBACK_PAYMENTS: Payment[] = [
  { id: '1', supplier_id: '', supplier: 'תנובה',       amount: 45200, type: 'העברה בנקאית', date: '2026-04-24', ref: 'TRF-2026-001', valueDate: null,         notes: 'תשלום חודשי מוצרי חלב', status: 'paid'    },
  { id: '2', supplier_id: '', supplier: 'תבורי בע"מ',  amount: 12500, type: "צ'ק",          date: '2026-04-29', ref: 'CHK-1042',     valueDate: '2026-05-08', notes: 'משקאות קמעוני',         status: 'pending' },
  { id: '3', supplier_id: '', supplier: 'מקורות מים',  amount: 8300,  type: 'מזומן',         date: '2026-05-01', ref: 'קבלה 0088',   valueDate: null,         notes: '',                       status: 'paid'    },
  { id: '4', supplier_id: '', supplier: 'נסטלה ישראל', amount: 23100, type: 'כרטיס אשראי',   date: '2026-05-02', ref: 'CC-5544',      valueDate: '2026-05-26', notes: 'שתייה חמה ומשלימים',   status: 'pending' },
  { id: '5', supplier_id: '', supplier: 'אסם השקעות',  amount: 6800,  type: 'העברה בנקאית', date: '2026-04-20', ref: 'TRF-2026-005', valueDate: null,         notes: '',                       status: 'paid'    },
]

export function usePayments() {
  const [data, setData]       = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [
        { data: rows,     error: err },
        { data: suppRows },
      ] = await Promise.all([
        supabase.from('payments').select('*'),
        supabase.from('suppliers').select('id, name'),
      ])

      if (!err && rows && rows.length > 0) {
        // Build id→name lookup for supplier display
        const suppMap: Record<string, string> = {}
        for (const s of suppRows ?? []) suppMap[s.id] = s.name

        setData(rows.map(r => ({
          ...r,
          id:          String(r.id),
          supplier_id: r.supplier_id ?? '',
          supplier:    suppMap[r.supplier_id] ?? '',
          amount:      Number(r.amount ?? 0),
          // renamed columns: DB name → frontend name
          type:        r.payment_type ?? '',
          date:        r.payment_date ?? '',
          ref:         r.reference    ?? '',
          valueDate:   r.value_date   ?? null,
          notes:       r.notes        ?? '',
          status:      r.status       as PaymentStatus ?? 'pending',
        })) as Payment[])
        setError(null)
      } else {
        setData(FALLBACK_PAYMENTS)
        if (err) setError(err.message)
      }
    } catch {
      setData(FALLBACK_PAYMENTS)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (body: Omit<Payment, 'id'>) => {
    console.log('[usePayments] create payload:', body)
    try {
      const res = await api.post('/payments', body)
      console.log('[usePayments] create response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[usePayments] create error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const update = async (id: string, body: Partial<Payment>) => {
    console.log('[usePayments] update payload:', { id, ...body })
    try {
      const res = await api.put(`/payments/${id}`, body)
      console.log('[usePayments] update response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[usePayments] update error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const cancel = async (id: string) => {
    console.log('[usePayments] cancel id:', id)
    try {
      const res = await api.put(`/payments/${id}/cancel`, {})
      console.log('[usePayments] cancel response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[usePayments] cancel error:', msg)
      setError(`שגיאה בביטול: ${msg}`)
      throw err
    }
  }

  return { data, loading, error, create, update, cancel }
}
