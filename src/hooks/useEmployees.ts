import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export interface Employee {
  id: string
  name: string
  role: string
  phone: string
  active: boolean
  createdAt: string
}

export function useEmployees() {
  const [data, setData] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase
        .from('employees')
        .select('*')
        .order('name')

      if (err) {
        setError(err.message)
      } else {
        setData((rows ?? []).map(r => ({
          id: String(r.id),
          name: r.name ?? '',
          role: r.role ?? '',
          phone: r.phone ?? '',
          active: r.active ?? true,
          createdAt: r.created_at ?? '',
        })))
        setError(null)
      }
    } catch {
      setError('שגיאה בטעינת עובדים')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (body: { name: string; role: string; phone: string; active: boolean }) => {
    try {
      await api.post('/employees', body)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`שגיאה בשמירה: ${msg}`)
      throw err
    }
  }

  const update = async (id: string, body: { name?: string; role?: string; phone?: string; active?: boolean }) => {
    try {
      await api.put(`/employees/${id}`, body)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`שגיאה בעדכון: ${msg}`)
      throw err
    }
  }

  const remove = async (id: string) => {
    try {
      await api.delete(`/employees/${id}`)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`שגיאה במחיקה: ${msg}`)
      throw err
    }
  }

  return { data, loading, error, create, update, remove, reload: load }
}
