import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { mockInvoices, type Invoice } from '../data/mockData'

export function useInvoices() {
  const [data, setData] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase.from('invoices').select('*')
      if (!err && rows && rows.length > 0) {
        setData(rows as Invoice[])
      } else {
        setData(mockInvoices)
        if (err) setError(err.message)
      }
    } catch {
      setData(mockInvoices)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (body: Partial<Invoice>) => {
    await api.post('/invoices', body)
    await load()
  }

  const update = async (id: string, body: Partial<Invoice>) => {
    await api.put(`/invoices/${id}`, body)
    await load()
  }

  const updateStatus = async (id: string, status: string) => {
    await api.put(`/invoices/${id}/status`, { status })
    await load()
  }

  const remove = async (id: string) => {
    await api.delete(`/invoices/${id}`)
    await load()
  }

  return { data, loading, error, create, update, updateStatus, remove }
}
