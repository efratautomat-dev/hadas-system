// ── Which invoice is this delivery note's? — a suggestion, never a link ─────
//
// DEMO ONLY for now (26.10.2026, the orders/delivery-notes prototype). The
// owner's 18.10 model: a delivery note and an invoice point at each other, and
// the system SUGGESTS the pair with its reasons; the pair becomes real only when
// she presses "נעל התאמה" (which is the existing `/delivery-notes/:id/link`).
// Nothing here writes.
//
// The order of evidence, strongest first: the note's number printed on the
// invoice; the same amount (±₪1); a close amount (±5%); and a short gap in days.
// Only invoices of the SAME supplier are ever considered, and an invoice already
// locked to another note is shown in the picker but never suggested.

import type { DeliveryNote, Invoice } from '../data/mockData'

export interface Suggestion {
  invoice: Invoice
  score: number
  reasons: string[]
  /** Already locked to a different delivery note. */
  takenBy: string | null
}

const dayMs = 86_400_000
const isoOf = (inv: Invoice) => (/^\d{4}-\d{2}-\d{2}/.test(inv.invoiceDate ?? '') ? inv.invoiceDate.slice(0, 10) : '')

export function rankInvoices(
  note: DeliveryNote,
  invoices: Invoice[],
  lockedNoteFor: (invoiceId: string) => string | null,
): Suggestion[] {
  const noteNo = (note.noteNumber ?? '').replace(/\D/g, '')
  return invoices
    .filter(i => i.supplierId === note.supplierId && !i.isDuplicate && !i.hasError)
    .map(inv => {
      const reasons: string[] = ['אותו ספק']
      let score = 1
      const text = `${inv.lineDetails ?? ''} ${inv.notes ?? ''}`
      if (noteNo.length >= 3 && text.replace(/\D/g, ' ').split(/\s+/).includes(noteNo)) {
        score += 50; reasons.push('מס׳ התעודה מופיע בחשבונית')
      }
      const a = Math.abs(Number(inv.amount) || 0), b = Math.abs(Number(note.amount) || 0)
      if (a && b) {
        if (Math.abs(a - b) <= 1) { score += 30; reasons.push('סכום תואם') }
        else if (Math.abs(a - b) / Math.max(a, b) <= 0.05) { score += 12; reasons.push('סכום קרוב') }
      }
      const d1 = isoOf(inv), d2 = note.isoDate
      if (d1 && d2) {
        const gap = Math.round((new Date(d1).getTime() - new Date(d2).getTime()) / dayMs)
        if (gap >= -3 && gap <= 45) {
          score += Math.max(0, 15 - Math.abs(gap) / 3)
          reasons.push(gap === 0 ? 'אותו יום' : `${Math.abs(gap)} ימים`)
        } else {
          score -= 20
        }
      }
      const owner = lockedNoteFor(inv.id)
      return { invoice: inv, score, reasons, takenBy: owner && owner !== note.id ? owner : null }
    })
    .sort((x, y) => y.score - x.score)
}

/** The one invoice to propose, or null when nothing is convincing enough. */
export function bestSuggestion(list: Suggestion[]): Suggestion | null {
  const top = list.find(s => !s.takenBy)
  // Same supplier alone is not evidence: it needs an amount or the number.
  return top && top.reasons.some(r => r.startsWith('סכום') || r.startsWith('מס׳')) ? top : null
}
