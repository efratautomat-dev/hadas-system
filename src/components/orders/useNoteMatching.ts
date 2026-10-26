import { useCallback, useMemo } from 'react'
import { useDeliveryNotes } from '../../hooks/useDeliveryNotes'
import { useInvoices } from '../../hooks/useInvoices'
import { useDeliveryLinks } from '../../hooks/useDeliveryLinks'
import { rankInvoices, bestSuggestion, type Suggestion } from '../../lib/dnSuggest'
import type { DeliveryNote, Invoice } from '../../data/mockData'

/**
 * The note ↔ invoice state the new screens share (DEMO ONLY, 26.10.2026):
 * which invoice a note is LOCKED to (the existing link table), which one the
 * system SUGGESTS when none is, and the two writes that change it.
 */
export function useNoteMatching() {
  const notesApi = useDeliveryNotes()
  const { data: invoices } = useInvoices()
  const { data: links, invoicesFor, deliveriesFor, reload: reloadLinks } = useDeliveryLinks()

  const invById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices])
  const noteById = useMemo(() => new Map(notesApi.data.map(n => [n.id, n])), [notesApi.data])

  const lockedNoteFor = useCallback(
    (invoiceId: string) => links.find(l => l.invoiceId === invoiceId)?.deliveryNoteId ?? null,
    [links])

  const lockedInvoice = useCallback((noteId: string): Invoice | null => {
    const id = invoicesFor(noteId)[0]
    return id ? invById.get(id) ?? null : null
  }, [invoicesFor, invById])

  const ranked = useCallback(
    (note: DeliveryNote): Suggestion[] => rankInvoices(note, invoices, lockedNoteFor),
    [invoices, lockedNoteFor])

  const suggestion = useCallback(
    (note: DeliveryNote): Suggestion | null => (lockedInvoice(note.id) ? null : bestSuggestion(ranked(note))),
    [lockedInvoice, ranked])

  const lock = async (noteId: string, invoiceId: string) => {
    await notesApi.link(noteId, invoiceId)
    await reloadLinks()
  }
  const unlock = async (noteId: string) => {
    await notesApi.unlink(noteId)
    await reloadLinks()
  }

  return {
    notes: notesApi.data, notesApi, invoices, invById, noteById,
    lockedInvoice, suggestion, ranked, lock, unlock, deliveriesFor, lockedNoteFor,
  }
}

export type NoteMatching = ReturnType<typeof useNoteMatching>
