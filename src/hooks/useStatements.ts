import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export type VendorStatementStatus = 'matched' | 'mismatch' | 'pending' | 'investigating'

export interface VendorStatement {
  id: string
  supplier_id: string
  supplier_name: string   // derived — not a DB column
  month: string
  our_balance: number
  vendor_balance: number | null
  diff: number
  status: VendorStatementStatus
  uploaded_at: string
}

const FALLBACK_STATEMENTS: VendorStatement[] = [
  { id: 'VS-001', supplier_id: 'SUP-001', supplier_name: 'תנובה',       month: '04/2026', our_balance: 45200, vendor_balance: 45200, diff: 0,    status: 'matched',  uploaded_at: '02/05/2026' },
  { id: 'VS-002', supplier_id: 'SUP-002', supplier_name: 'תבורי בע"מ',  month: '04/2026', our_balance: 12500, vendor_balance: 14000, diff: 1500, status: 'mismatch', uploaded_at: '01/05/2026' },
  { id: 'VS-003', supplier_id: 'SUP-003', supplier_name: 'אסם השקעות',  month: '04/2026', our_balance: 6800,  vendor_balance: null,  diff: 0,    status: 'pending',  uploaded_at: '—' },
]

export function useStatements() {
  const [data, setData]       = useState<VendorStatement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [
        { data: rows,     error: err },
        { data: suppRows },
      ] = await Promise.all([
        supabase.from('vendor_statements').select('*'),
        supabase.from('suppliers').select('id, name'),
      ])

      if (!err && rows && rows.length > 0) {
        const suppMap: Record<string, string> = {}
        for (const s of suppRows ?? []) suppMap[s.id] = s.name

        setData(rows.map(r => ({
          ...r,
          id:             String(r.id),
          supplier_id:    r.supplier_id    ?? '',
          supplier_name:  suppMap[r.supplier_id] ?? '',
          month:          r.month          ?? '',
          our_balance:    Number(r.our_balance    ?? 0),
          vendor_balance: r.vendor_balance != null ? Number(r.vendor_balance) : null,
          diff:           Number(r.diff           ?? 0),
          status:         r.status         as VendorStatementStatus ?? 'pending',
          uploaded_at:    r.uploaded_at    ?? '',
        })) as VendorStatement[])
        setError(null)
      } else {
        setData(FALLBACK_STATEMENTS)
        if (err) setError(err.message)
      }
    } catch {
      setData(FALLBACK_STATEMENTS)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (body: Omit<VendorStatement, 'id'>) => {
    const { supplier_name: _supplier_name, ...rest } = body
    const payload = rest
    console.log('[useStatements] create payload:', payload)
    try {
      const res = await api.post('/statements', payload)
      console.log('[useStatements] create response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useStatements] create error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const resolve = async (id: string, body: {
    status?: VendorStatementStatus
    ourBalance?: number
    vendorBalance?: number | null
    diff?: number
  }) => {
    console.log('[useStatements] resolve payload:', { id, ...body })
    try {
      const res = await api.put(`/statements/${id}/resolve`, body)
      console.log('[useStatements] resolve response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useStatements] resolve error:', msg)
      setError(`שגיאה בעדכון: ${msg}`)
      throw err
    }
  }

  return { data, loading, error, create, resolve }
}
