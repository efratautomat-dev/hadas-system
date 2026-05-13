import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { mockSuppliers } from '../data/mockData'

export type SupplierRow = typeof mockSuppliers[number]

export function useSuppliers() {
  const [data, setData] = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase.from('suppliers').select('*')
      if (!err && rows && rows.length > 0) {
        setData(rows as SupplierRow[])
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

  const create = async (body: Record<string, unknown>) => {
    await api.post('/suppliers', body)
    await load()
  }

  const update = async (id: string, body: Record<string, unknown>) => {
    await api.put(`/suppliers/${id}`, body)
    await load()
  }

  const remove = async (id: string) => {
    await api.delete(`/suppliers/${id}`)
    await load()
  }

  return { data, loading, error, create, update, remove }
}
