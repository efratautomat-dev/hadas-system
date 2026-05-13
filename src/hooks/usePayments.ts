import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export type PaymentStatus = 'paid' | 'pending' | 'cancelled'

export interface Payment {
  id: number
  supplier: string
  amount: number
  type: string
  date: string        // YYYY-MM-DD
  ref: string
  valueDate: string | null
  notes: string
  status: PaymentStatus
}

const FALLBACK_PAYMENTS: Payment[] = [
  { id: 1, supplier: 'תנובה', amount: 45200, type: 'העברה בנקאית', date: '2026-04-24', ref: 'TRF-2026-001', valueDate: null, notes: 'תשלום חודשי מוצרי חלב', status: 'paid' },
  { id: 2, supplier: 'תבורי בע"מ', amount: 12500, type: "צ'ק", date: '2026-04-29', ref: 'CHK-1042', valueDate: '2026-05-08', notes: 'משקאות קמעוני', status: 'pending' },
  { id: 3, supplier: 'מקורות מים', amount: 8300, type: 'מזומן', date: '2026-05-01', ref: 'קבלה 0088', valueDate: null, notes: '', status: 'paid' },
  { id: 4, supplier: 'נסטלה ישראל', amount: 23100, type: 'כרטיס אשראי', date: '2026-05-02', ref: 'CC-5544', valueDate: '2026-05-26', notes: 'שתייה חמה ומשלימים', status: 'pending' },
  { id: 5, supplier: 'אסם השקעות', amount: 6800, type: 'העברה בנקאית', date: '2026-04-20', ref: 'TRF-2026-005', valueDate: null, notes: '', status: 'paid' },
]

export function usePayments() {
  const [data, setData] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase.from('payments').select('*')
      if (!err && rows && rows.length > 0) {
        setData(rows as Payment[])
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
    await api.post('/payments', body)
    await load()
  }

  const update = async (id: number, body: Partial<Payment>) => {
    await api.put(`/payments/${id}`, body)
    await load()
  }

  const cancel = async (id: number) => {
    await api.put(`/payments/${id}/cancel`, {})
    await load()
  }

  return { data, loading, error, create, update, cancel }
}
