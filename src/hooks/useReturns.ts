import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export type ReturnStatus = 'אושר' | 'בטיפול' | 'נדחה'

export interface ReturnEntry {
  id:                string
  date:              string        // display DD/MM/YYYY — derived from DB `date`
  dateIso:           string        // ISO YYYY-MM-DD — maps to DB `date` column on write
  supplierId:        string        // DB: supplier_id
  supplier:          string        // derived display name — no DB column
  amount:            number
  reason:            string
  originalInvoiceId: string | null // DB: invoice_id
  status:            ReturnStatus
  createdBy:         string        // DB: created_by
}

function isoToDisplay(iso: string): string {
  if (!iso) return ''
  const parts = iso.split('T')[0].split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

const FALLBACK_RETURNS: ReturnEntry[] = [
  { id: 'RET-001', date: '05/05/2026', dateIso: '2026-05-05', supplierId: 'SUP-001', supplier: 'תנובה',       amount: 3500, reason: 'סחורה פגומה - כיסויי ראש קיץ',          originalInvoiceId: 'INV-2026-003', status: 'אושר',   createdBy: 'שרה כהן'  },
  { id: 'RET-002', date: '01/05/2026', dateIso: '2026-05-01', supplierId: 'SUP-002', supplier: 'תבורי בע"מ', amount: 1200, reason: 'הזמנה שגויה - גודל שגוי',                originalInvoiceId: 'INV-2026-001', status: 'בטיפול', createdBy: 'רחל לוי'  },
  { id: 'RET-003', date: '25/04/2026', dateIso: '2026-04-25', supplierId: 'SUP-003', supplier: 'אסם השקעות', amount: 800,  reason: 'מוצר לא תואם לפרטי ההזמנה',             originalInvoiceId: 'INV-2026-004', status: 'אושר',   createdBy: 'שרה כהן'  },
  { id: 'RET-004', date: '20/04/2026', dateIso: '2026-04-20', supplierId: 'SUP-005', supplier: 'נסטלה ישראל', amount: 2200, reason: 'פריטים חסרים במשלוח - 8 יחידות',      originalInvoiceId: 'INV-2026-006', status: 'נדחה',   createdBy: 'רחל לוי'  },
  { id: 'RET-005', date: '15/04/2026', dateIso: '2026-04-15', supplierId: 'SUP-001', supplier: 'תנובה',       amount: 950,  reason: 'שגיאת תמחור בחשבונית',                   originalInvoiceId: null,           status: 'בטיפול', createdBy: 'מיכל דוד' },
]

export function useReturns() {
  const [data, setData]       = useState<ReturnEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [
        { data: rows,     error: err },
        { data: suppRows },
      ] = await Promise.all([
        supabase.from('returns').select('*'),
        supabase.from('suppliers').select('id, name'),
      ])

      if (!err && rows && rows.length > 0) {
        const suppMap: Record<string, string> = {}
        for (const s of suppRows ?? []) suppMap[s.id] = s.name

        setData(rows.map(r => ({
          ...r,
          id:                String(r.id),
          supplierId:        r.supplier_id  ?? '',
          supplier:          suppMap[r.supplier_id] ?? '',
          // DB `date` (ISO) → derive both display and isoDate fields
          dateIso:           r.date         ?? '',
          date:              isoToDisplay(r.date ?? ''),
          amount:            Number(r.amount ?? 0),
          reason:            r.reason       ?? '',
          // DB `invoice_id` → originalInvoiceId frontend field
          originalInvoiceId: r.invoice_id   ?? null,
          status:            r.status       as ReturnStatus ?? 'בטיפול',
          createdBy:         r.created_by   ?? '',
        })) as ReturnEntry[])
        setError(null)
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
    // Strip id, date (display), supplier name — send only whitelisted fields
    const { supplier: _supplier, date: _date, ...rest } = body as ReturnEntry
    const payload = rest
    console.log('[useReturns] create payload:', payload)
    try {
      const res = await api.post('/returns', payload)
      console.log('[useReturns] create response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useReturns] create error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const update = async (id: string, body: Partial<ReturnEntry>) => {
    // Strip supplier name and display date — send only whitelisted fields
    const { supplier: _supplier, date: _date, ...rest } = body as ReturnEntry
    const payload = rest
    console.log('[useReturns] update payload:', { id, ...payload })
    try {
      const res = await api.put(`/returns/${id}`, payload)
      console.log('[useReturns] update response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useReturns] update error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const updateStatus = async (id: string, status: ReturnStatus) => {
    console.log('[useReturns] updateStatus:', { id, status })
    try {
      const res = await api.put(`/returns/${id}/status`, { status })
      console.log('[useReturns] updateStatus response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useReturns] updateStatus error:', msg)
      setError(`שגיאה בעדכון סטטוס: ${msg}`)
      throw err
    }
  }

  return { data, loading, error, create, update, updateStatus }
}
