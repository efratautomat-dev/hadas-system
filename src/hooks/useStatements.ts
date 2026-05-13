import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export type VendorStatementStatus = 'matched' | 'mismatch' | 'pending' | 'investigating'

export interface VendorStatement {
  id: string
  supplier_id: string
  supplier_name: string
  month: string
  our_balance: number
  vendor_balance: number | null
  diff: number
  status: VendorStatementStatus
  uploaded_at: string
}

const FALLBACK_STATEMENTS: VendorStatement[] = [
  { id: 'VS-001', supplier_id: 'SUP-001', supplier_name: 'תנובה', month: '04/2026', our_balance: 45200, vendor_balance: 45200, diff: 0, status: 'matched', uploaded_at: '02/05/2026' },
  { id: 'VS-002', supplier_id: 'SUP-002', supplier_name: 'תבורי בע"מ', month: '04/2026', our_balance: 12500, vendor_balance: 14000, diff: 1500, status: 'mismatch', uploaded_at: '01/05/2026' },
  { id: 'VS-003', supplier_id: 'SUP-003', supplier_name: 'אסם השקעות', month: '04/2026', our_balance: 6800, vendor_balance: null, diff: 0, status: 'pending', uploaded_at: '—' },
]

export function useStatements() {
  const [data, setData] = useState<VendorStatement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase.from('vendor_statements').select('*')
      if (!err && rows && rows.length > 0) {
        setData(rows as VendorStatement[])
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
    await api.post('/statements', body)
    await load()
  }

  const resolve = async (id: string, body: { status?: VendorStatementStatus; ourBalance?: number; vendorBalance?: number | null; diff?: number }) => {
    await api.put(`/statements/${id}/resolve`, body)
    await load()
  }

  return { data, loading, error, create, resolve }
}
