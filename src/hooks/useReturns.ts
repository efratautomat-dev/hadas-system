import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export type ReturnStatus = 'אושר' | 'בטיפול' | 'נדחה'

export interface ReturnEntry {
  id:                string
  date:              string        // display DD/MM/YYYY
  dateIso:           string        // ISO YYYY-MM-DD — maps to DB `date` column on write
  supplierId:        string        // DB: supplier_id
  supplier:          string        // display only — no DB column
  amount:            number
  reason:            string
  detail:            string        // DB: detail
  originalInvoiceId: string | null // DB: invoice_id
  status:            ReturnStatus
  employeeId:        string | null  // DB: employee_id (FK → employees)
  createdBy:         string         // display only — derived from employees join or legacy created_by text
}

function isoToDisplay(iso: string): string {
  if (!iso) return ''
  const parts = iso.split('T')[0].split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

const FALLBACK_RETURNS: ReturnEntry[] = [
  { id: 'RET-001', date: '05/05/2026', dateIso: '2026-05-05', supplierId: 'SUP-001', supplier: 'תנובה',        amount: 3500, reason: 'סחורה פגומה - כיסויי ראש קיץ',          detail: '', originalInvoiceId: 'INV-2026-003', status: 'אושר',   employeeId: null, createdBy: 'שרה כהן'   },
  { id: 'RET-002', date: '01/05/2026', dateIso: '2026-05-01', supplierId: 'SUP-002', supplier: 'תבורי בע"מ',  amount: 1200, reason: 'הזמנה שגויה - גודל שגוי',                detail: '', originalInvoiceId: 'INV-2026-001', status: 'בטיפול', employeeId: null, createdBy: 'רחל לוי'   },
  { id: 'RET-003', date: '25/04/2026', dateIso: '2026-04-25', supplierId: 'SUP-003', supplier: 'אסם השקעות',  amount: 800,  reason: 'מוצר לא תואם לפרטי ההזמנה',             detail: '', originalInvoiceId: 'INV-2026-004', status: 'אושר',   employeeId: null, createdBy: 'שרה כהן'   },
  { id: 'RET-004', date: '20/04/2026', dateIso: '2026-04-20', supplierId: 'SUP-005', supplier: 'נסטלה ישראל', amount: 2200, reason: 'פריטים חסרים במשלוח - 8 יחידות',        detail: '', originalInvoiceId: 'INV-2026-006', status: 'נדחה',   employeeId: null, createdBy: 'רחל לוי'   },
  { id: 'RET-005', date: '15/04/2026', dateIso: '2026-04-15', supplierId: 'SUP-001', supplier: 'תנובה',        amount: 950,  reason: 'שגיאת תמחור בחשבונית',                   detail: '', originalInvoiceId: null,           status: 'בטיפול', employeeId: null, createdBy: 'מיכל דוד'  },
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
        { data: empRows },
      ] = await Promise.all([
        supabase.from('returns').select('*'),
        supabase.from('suppliers').select('id, name'),
        supabase.from('employees').select('id, name'),
      ])

      if (!err && rows && rows.length > 0) {
        const suppMap: Record<string, string> = {}
        for (const s of suppRows ?? []) suppMap[s.id] = s.name

        const empMap: Record<string, string> = {}
        for (const e of empRows ?? []) empMap[e.id] = e.name

        setData(rows.map(r => ({
          id:                String(r.id),
          supplierId:        r.supplier_id  ?? '',
          supplier:          suppMap[r.supplier_id] ?? '',
          dateIso:           r.date         ?? '',
          date:              isoToDisplay(r.date ?? ''),
          amount:            Number(r.amount ?? 0),
          reason:            r.reason       ?? '',
          detail:            r.detail       ?? '',
          originalInvoiceId: r.invoice_id   ?? null,
          status:            r.status       as ReturnStatus ?? 'בטיפול',
          employeeId:        r.employee_id  ?? null,
          createdBy:         empMap[r.employee_id] ?? r.created_by ?? '',
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
    // Strip display-only fields before sending to API
    const { supplier: _s, date: _d, createdBy: _cb, ...rest } = body as ReturnEntry
    console.log('[useReturns] create payload:', rest)
    try {
      const res = await api.post('/returns', rest)
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
    // Strip display-only fields before sending to API
    const { supplier: _s, date: _d, id: _id, createdBy: _cb, ...rest } = body as ReturnEntry
    console.log('[useReturns] update payload:', { id, ...rest })
    try {
      const res = await api.put(`/returns/${id}`, rest)
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
