import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { mockDeliveryNotes, type DeliveryNote, type InvoiceCandidate, type PipelineStage } from '../data/mockData'
import { isoToDisplay } from '../lib/dates'
import { subscribe } from '../lib/dataBus'
import type { ArrivalCandidate } from './useOrders'


export function useDeliveryNotes() {
  const [data, setData]       = useState<DeliveryNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase.from('delivery_notes_v').select('*')
      if (!err && rows && rows.length > 0) {
        setData(rows.map(r => ({
          ...r,
          supplierId:      r.supplier_id ?? '',
          supplierName:    r.supplier_name ?? '',
          // DB `date` column (ISO format) → isoDate frontend field
          isoDate:         r.date         ?? '',
          // derive display date from the ISO date
          date:            isoToDisplay(r.date ?? ''),
          // DB `invoice_id` column → linkedInvoiceId frontend field
          linkedInvoiceId: r.invoice_id   ?? undefined,
          storageUrl:      r.storage_url  ?? undefined,
          pairedNoteId:    r.paired_note_id ?? null,
          receiptSettledAt: r.receipt_settled_at ?? null,
          isDuplicate:     r.is_duplicate ?? false,
          duplicateOf:     r.duplicate_of ?? null,
          amount:          Number(r.amount ?? 0),
          status:          r.status       ?? 'pending',
          driveFileLink:   r.drive_file_link ?? '',
          // Two-view split: rows with a gmail_message_id arrived by email; the rest
          // are manual goods-receipt entries (mirrors the Returns derivation).
          source:          r.gmail_message_id ? 'email' : 'manual',
          lineItems:       r.line_items ?? '',
          noteNumber:      r.note_number ?? '',
          employeeId:      r.employee_id ?? '',
          // The pipeline state. Falls back to `awaiting_invoice` — the same default the
          // DB column carries — so a row written before the migration still reads as a
          // delivery waiting for its invoice rather than as an undefined state.
          stage:           (r.stage as PipelineStage) ?? 'awaiting_invoice',
          intakeSource:    r.intake_source ?? (r.gmail_message_id ? 'email' : 'manual'),
          // notes field doesn't exist in DB; omit it
        })) as DeliveryNote[])
        setError(null)
      } else {
        console.warn(
          '[useDeliveryNotes] falling back to mockDeliveryNotes — supabase returned no rows or an error:',
          err ?? '(no rows)',
        )
        setData(mockDeliveryNotes)
        if (err) setError(err.message)
      }
    } catch (e) {
      console.warn('[useDeliveryNotes] falling back to mockDeliveryNotes — exception thrown:', e)
      setData(mockDeliveryNotes)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])


  useEffect(() => subscribe(['delivery_notes'], load), [load])

  // Manual goods receipt — PERSISTS to the DB (fixes the old local-state-only bug).
  // No delivery-note number / amount required; source is derived as 'manual' because
  // no gmail_message_id is set.
  /**
   * Record goods that arrived at the door.
   *
   * Returns `needsChoice` when this supplier already has a delivery waiting —
   * because his note or his invoice usually reaches the mailbox before the goods
   * reach the counter. The caller must ASK; answering with `adopt` joins that
   * chain, `forceNew` starts a separate one.
   */
  const create = async (body: {
    supplierId: string; supplierName: string; isoDate: string; lineItems: string
    noteNumber?: string; employeeId?: string
    /** Σ cost read off a handwritten sheet. `null`/absent = not known. */
    amount?: number | null
    /** The filed photo of that sheet — the document the reading came from. */
    storageUrl?: string | null
    adopt?: string; forceNew?: boolean
  }): Promise<{ needsChoice?: boolean; candidates?: ArrivalCandidate[]; id?: string }> => {
    try {
      const res = await api.post('/delivery-notes', {
        supplier_id:   body.supplierId,
        supplier_name: body.supplierName,
        date:          body.isoDate,
        line_items:    body.lineItems,
        note_number:   body.noteNumber || null,
        employee_id:   body.employeeId || null,
        // null, not 0. "Not known" and "cost nothing" are different claims, and
        // the ledger never reads this figure either way.
        amount:        body.amount ?? null,
        storage_url:   body.storageUrl ?? null,
        delivery_note_id: body.adopt,
        force_new:        body.forceNew,
      }) as { needsChoice?: boolean; candidates?: ArrivalCandidate[]; id?: string }
      // Nothing was written when the server asks — return the question unanswered
      // rather than reloading and reporting success.
      if (res?.needsChoice) return res
      await load()
      return { id: res?.id }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] create error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  // PIECE 2 — manual↔arrived match correction: copy the arrived note's document +
  // number onto the manual row (driveFileLink/noteNumber set = matched), or clear
  // them (unmatch). This is the read/write side of the §5 matching rule.
  const setMatch = async (manualId: string, driveFileLink: string | null, noteNumber: string) => {
    try {
      await api.put(`/delivery-notes/${manualId}`, { driveFileLink, noteNumber })
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] setMatch error:', msg)
      setError(`שגיאה בעדכון ההתאמה: ${msg}`)
      throw err
    }
  }

  /**
   * Take the chain apart WITHOUT deleting anything in it (owner's decision).
   * The documents stay; only the links between them go.
   */
  /**
   * Move a delivery to a different supplier. A route of its own, open to employees:
   * she is the one holding the goods and reading the header, and the action carries
   * no figure. The name follows the id server-side so the two cannot drift.
   */
  const reassignSupplier = async (id: string, supplierId: string) => {
    try {
      await api.put(`/delivery-notes/${id}/supplier`, { supplier_id: supplierId })
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`שגיאה בשינוי הספק: ${msg}`)
      throw err
    }
  }

  /**
   * Answer "is the note that just arrived the same delivery you recorded?".
   * `absorb` keeps the supplier's document and removes the hand-typed row;
   * `keep` records that a person looked and said they are different shipments.
   */
  const resolvePair = async (manualId: string, arrivedId: string, action: 'absorb' | 'keep') => {
    try {
      await api.put(`/delivery-notes/${manualId}/pair`, { arrived_id: arrivedId, action })
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`שגיאה בטיפול בכפילות: ${msg}`)
      throw err
    }
  }

  const dismantle = async (id: string) => {
    try {
      await api.delete(`/delivery-notes/${id}/dismantle`)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`שגיאה בפירוק הפייפליין: ${msg}`)
      throw err
    }
  }

  // A receipt instead of an invoice. Named payments only — see ReceiptSettle for
  // why guessing which payment a receipt covers is not on offer.
  const settleByReceipt = async (id: string, paymentIds: string[]) => {
    try {
      await api.post(`/delivery-notes/${id}/receipt`, { paymentIds })
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`שגיאה בסגירת התעודה בקבלה: ${msg}`)
      throw err
    }
  }

  const undoReceipt = async (id: string) => {
    try {
      await api.delete(`/delivery-notes/${id}/receipt`)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`שגיאה בביטול הסגירה בקבלה: ${msg}`)
      throw err
    }
  }

  const update = async (id: string, body: Partial<DeliveryNote> & { invoiceId?: string }) => {
    console.log('[useDeliveryNotes] update payload:', { id, ...body })
    try {
      const res = await api.put(`/delivery-notes/${id}`, body)
      console.log('[useDeliveryNotes] update response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] update error:', msg)
      setError(`שגיאה בשמירה - הנתונים לא נשמרו: ${msg}`)
      throw err
    }
  }

  const link = async (id: string, invoiceId: string) => {
    console.log('[useDeliveryNotes] link:', { id, invoiceId })
    try {
      const res = await api.put(`/delivery-notes/${id}/link`, { invoice_id: invoiceId })
      console.log('[useDeliveryNotes] link response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] link error:', msg)
      setError(`שגיאה בשיוך חשבונית: ${msg}`)
      throw err
    }
  }

  // Suggested invoices for a note — supplier + date proximity + amount, ranked by the
  // API. ADVISORY: this returns a list to show, and attaching is still a separate,
  // explicit `link` call made by a person (§6.f). Nothing here writes.
  const candidates = async (id: string): Promise<InvoiceCandidate[]> => {
    try {
      const res = await api.get(`/delivery-notes/${id}/candidates`)
      return (res as { candidates?: InvoiceCandidate[] }).candidates ?? []
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] candidates error:', msg)
      setError(`שגיאה בטעינת התאמות אפשריות: ${msg}`)
      return []
    }
  }

  /**
   * Detach ONE invoice from a delivery, or all of them when none is named.
   * A row may carry several — a supplier who bills one delivery in parts — so
   * removing "the" invoice was never a complete instruction.
   */
  const unlink = async (id: string, invoiceId?: string) => {
    try {
      await api.put(`/delivery-notes/${id}/unlink`, invoiceId ? { invoice_id: invoiceId } : {})
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] unlink error:', msg)
      setError(`שגיאה בביטול שיוך: ${msg}`)
      throw err
    }
  }

  const remove = async (id: string) => {
    console.log('[useDeliveryNotes] delete id:', id)
    try {
      const res = await api.delete(`/delivery-notes/${id}`)
      console.log('[useDeliveryNotes] delete response:', res)
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useDeliveryNotes] delete error:', msg)
      setError(`שגיאה במחיקה: ${msg}`)
      throw err
    }
  }

  return { data, loading, error, create, setMatch, update, link, unlink, remove, candidates, dismantle, reassignSupplier, resolvePair, settleByReceipt, undoReceipt, reload: load }
}
