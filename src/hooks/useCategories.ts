import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'

export interface Category {
  id: string
  name: string
  usage_count: number
}

// Managed category pool (Settings → category management). Reads via hadas-api
// (GET /categories); add / rename / delete / merge go through hadas-api writes.
// The same `categories` table feeds the AI extraction list (invoices-ingest).
export function useCategories() {
  const [data, setData] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = (await api.get('/categories')) as Category[]
      setData(Array.isArray(rows) ? rows : [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (name: string) => { await api.post('/categories', { name }); await load() }
  const rename = async (id: string, name: string) => { await api.put(`/categories/${id}`, { name }); await load() }
  // reassignTo (category name) is required by the backend when the category is in use;
  // omitting it on an in-use category returns 409 IN_USE so the UI can prompt.
  const remove = async (id: string, reassignTo?: string) => {
    const q = reassignTo ? `?reassignTo=${encodeURIComponent(reassignTo)}` : ''
    await api.delete(`/categories/${id}${q}`)
    await load()
  }
  const merge = async (fromId: string, intoId: string) => { await api.post('/categories/merge', { fromId, intoId }); await load() }

  return { data, loading, error, reload: load, create, rename, remove, merge }
}
