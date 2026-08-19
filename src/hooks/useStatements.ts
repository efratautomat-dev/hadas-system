import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export type VendorStatementStatus = 'matched' | 'mismatch' | 'pending' | 'investigating' | 'needs_review'

/** HOW the statement was matched to its supplier — drives the "identified by …"
 *  line and the manual-override button on the statements screen.
 *  `none` = arrived but unmatched (orphan); null = row predates the column. */
export type StatementMatchMethod = 'hp' | 'name' | 'email' | 'invoice_email' | 'manual' | 'none'

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
  storage_url: string | null     // path in the private "documents" bucket
  drive_file_link: string | null
  email_sender: string | null    // From address of the email it arrived on
  match_method: StatementMatchMethod | null
  /** The manager's reconciliation note, written while comparing the two ledgers. */
  resolution_notes: string | null
}

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
        // Newest arrival first. `uploaded_at` is DEFAULT now() and never written
        // by ingest, so it is the moment the row was created. Without an explicit
        // order Postgres hands back heap order, which looked arbitrary to the owner.
        supabase.from('vendor_statements')
          .select('*')
          .order('uploaded_at', { ascending: false }),
        supabase.from('suppliers_v').select('id, name'),
      ])

      // Successful fetch (even with 0 rows) → show real data. Only a genuine
      // error/exception clears the list and surfaces an error — we never fall
      // back to mock data, which would look real to the user.
      if (!err && rows) {
        const suppMap: Record<string, string> = {}
        for (const s of suppRows ?? []) suppMap[s.id] = s.name

        const mapped = rows.map(r => ({
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
          storage_url:     r.storage_url     ?? null,
          drive_file_link: r.drive_file_link ?? null,
          email_sender:    r.email_sender    ?? null,
          match_method:    (r.match_method as StatementMatchMethod) ?? null,
          resolution_notes: r.resolution_notes ?? null,
        })) as VendorStatement[]

        // The `.order()` above is what the real backend honours; this repeats it on
        // the mapped rows so the screen shows the same order on every transport —
        // the demo client's `.order()` is a no-op stub. A row with no `uploaded_at`
        // (predates the column / never set) sorts LAST rather than to the top.
        mapped.sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''))
        setData(mapped)
        setError(null)
      } else {
        setData([])
        setError(err?.message ?? 'שגיאה בטעינת הכרטסות')
      }
    } catch (e) {
      setData([])
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת הכרטסות')
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
    /** Assign a statement to a supplier — an orphan, or a correction of a wrong
     *  automatic match. hadas-api gained the `supplier_id` handling for this;
     *  before that a "change supplier" call would have been rejected outright. */
    supplierId?: string
    /** Sending address, if the screen ever corrects it. */
    senderEmail?: string | null
    /** Normally omitted: passing `supplierId` alone makes hadas-api record the
     *  match as `manual`, which is what the "change supplier" override means. */
    matchMethod?: StatementMatchMethod
    /** The "הערות התאמה" note — what explains the gap. Persisted, not per-session. */
    resolutionNotes?: string
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

  /**
   * Delete a statement and the stored copy of its document.
   *
   * Safe as a HARD delete, unlike a supplier: a statement is a report that
   * nothing references, and the balance it is compared against is computed from
   * invoices and payments — removing one moves no money. The row is removed from
   * local state immediately so the list does not show a ghost until the next load.
   */
  const remove = async (id: string) => {
    await api.delete(`/statements/${id}`)
    setData(prev => prev.filter(s => s.id !== id))
  }

  return { data, loading, error, create, resolve, remove }
}
