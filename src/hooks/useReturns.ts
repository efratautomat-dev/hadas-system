import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export type ReturnStatus = 'אושר' | 'בטיפול' | 'נדחה'

export interface ReturnEntry {
  id: string
  date: string
  dateIso: string
  supplierId: string
  supplier: string
  amount: number
  reason: string
  originalInvoiceId: string | null
  status: ReturnStatus
  createdBy: string
}

const FALLBACK_RETURNS: ReturnEntry[] = [
  { id: 'RET-001', date: '05/05/2026', dateIso: '2026-05-05', supplierId: 'SUP-001', supplier: 'תנובה', amount: 3500, reason: 'סחורה פגומה - כיסויי ראש קיץ', originalInvoiceId: 'INV-2026-003', status: 'אושר', createdBy: 'שרה כהן' },
  { id: 'RET-002', date: '01/05/2026', dateIso: '2026-05-01', supplierId: 'SUP-002', supplier: 'תבורי בע"מ', amount: 1200, reason: 'הזמנה שגויה - גודל שגוי', originalInvoiceId: 'INV-2026-001', status: 'בטיפול', createdBy: 'רחל לוי' },
  { id: 'RET-003', date: '25/04/2026', dateIso: '2026-04-25', supplierId: 'SUP-003', supplier: 'אסם השקעות', amount: 800, reason: 'מוצר לא תואם לפרטי ההזמנה', originalInvoiceId: 'INV-2026-004', status: 'אושר', createdBy: 'שרה כהן' },
  { id: 'RET-004', date: '20/04/2026', dateIso: '2026-04-20', supplierId: 'SUP-005', supplier: 'נסטלה ישראל', amount: 2200, reason: 'פריטים חסרים במשלוח - 8 יחידות', originalInvoiceId: 'INV-2026-006', status: 'נדחה', createdBy: 'רחל לוי' },
  { id: 'RET-005', date: '15/04/2026', dateIso: '2026-04-15', supplierId: 'SUP-001', supplier: 'תנובה', amount: 950, reason: 'שגיאת תמחור בחשבונית', originalInvoiceId: null, status: 'בטיפול', createdBy: 'מיכל דוד' },
]

export function useReturns() {
  const [data, setData] = useState<ReturnEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase.from('returns').select('*')
      if (!err && rows && rows.length > 0) {
        setData(rows as ReturnEntry[])
      } else {
        setData(FALLBACK_RETURNS)
        if (err) setError(err.message)
      }
    } catch {
      setData(FALLBACK_RETURNS)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (body: Omit<ReturnEntry, 'id'>) => {
    await api.post('/returns', body)
    await load()
  }

  const update = async (id: string, body: Partial<ReturnEntry>) => {
    await api.put(`/returns/${id}`, body)
    await load()
  }

  const updateStatus = async (id: string, status: ReturnStatus) => {
    await api.put(`/returns/${id}/status`, { status })
    await load()
  }

  return { data, loading, error, create, update, updateStatus }
}
