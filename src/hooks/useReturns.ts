import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'

export type ReturnStatus = 'אושר' | 'בטיפול' | 'נדחה'

export interface ReturnEntry {
  id:                       string
  date:                     string        // display DD/MM/YYYY
  dateIso:                  string        // ISO YYYY-MM-DD — maps to DB `date` column on write
  supplierId:               string        // DB: supplier_id
  supplier:                 string        // display only — no DB column
  amount:                   number
  reason:                   string
  detail:                   string        // DB: detail
  originalInvoiceId:        string | null // DB: invoice_id
  status:                   ReturnStatus
  employeeId:               string | null  // DB: employee_id (FK → employees)
  createdBy:                string         // display only — derived from employees join or legacy created_by text
  driveFileLink?:           string         // DB: drive_file_link
  supplierCreditNoteNumber?: string | null // DB: supplier_credit_note_number
  supplierCreditNoteDate?:   string | null // DB: supplier_credit_note_date (ISO)
  supplierCreditNoteAmount?: number | null // DB: supplier_credit_note_amount
  // View split: explicit `source` column when present, else derived from the email
  // ingest markers below (arrived credit notes carry a gmail id / message link).
  source?:                  string | null  // DB: source (manual | email) — may be absent
  gmailMessageId?:          string | null  // DB: gmail_message_id
  messageLink?:             string | null  // DB: message_link
}

function isoToDisplay(iso: string): string {
  if (!iso) return ''
  const parts = iso.split('T')[0].split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

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
        supabase.from('suppliers_v').select('id, name'),
        supabase.from('employees').select('id, name'),
      ])

      // Successful fetch (even with 0 rows) → show real data. Only a genuine
      // error/exception clears the list and surfaces an error — we never fall
      // back to mock data, which would look real to the user.
      if (!err && rows) {
        const suppMap: Record<string, string> = {}
        for (const s of suppRows ?? []) suppMap[s.id] = s.name

        const empMap: Record<string, string> = {}
        for (const e of empRows ?? []) empMap[e.id] = e.name

        setData(rows.map(r => ({
          id:                        String(r.id),
          supplierId:                r.supplier_id  ?? '',
          supplier:                  suppMap[r.supplier_id] ?? '',
          dateIso:                   r.date         ?? '',
          date:                      isoToDisplay(r.date ?? ''),
          amount:                    Number(r.amount ?? 0),
          reason:                    r.reason       ?? '',
          detail:                    r.detail       ?? '',
          originalInvoiceId:         r.invoice_id   ?? null,
          status:                    r.status       as ReturnStatus ?? 'בטיפול',
          employeeId:                r.employee_id  ?? null,
          createdBy:                 empMap[r.employee_id] ?? r.created_by ?? '',
          driveFileLink:             r.drive_file_link ?? '',
          supplierCreditNoteNumber:  r.supplier_credit_note_number ?? null,
          supplierCreditNoteDate:    r.supplier_credit_note_date   ?? null,
          supplierCreditNoteAmount:  r.supplier_credit_note_amount != null ? Number(r.supplier_credit_note_amount) : null,
          source:                    r.source          ?? null,
          gmailMessageId:            r.gmail_message_id ?? null,
          messageLink:               r.message_link     ?? null,
        })) as ReturnEntry[])
        setError(null)
      } else {
        setData([])
        setError(err?.message ?? 'שגיאה בטעינת ההחזרות')
      }
    } catch (e) {
      setData([])
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת ההחזרות')
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
