import { useState, useLayoutEffect } from 'react'
import { FileX, Mail, X } from 'lucide-react'
import { openEmail, emailOpenNote, type EmailOpen } from '../lib/native'
import { DocumentBody } from './PdfPreviewModal'
import { supabase } from '../lib/supabase'

// ── Re-classify popup ───────────────────────────────────────────────────────
// Shows the source document alongside a document-type picker so the owner can
// correct the AI's classification (spec 07-ALERTS #8: "open the document to
// re-classify"). Two callers, one popup: the document_misclassified alert, and
// a statement that was really an invoice ("שינוי סוג מסמך" on the statement
// page) — both POST /documents/reclassify, so the two cannot drift apart.
// The image comes from `documentUrl` (direct URL) or a signed URL minted from
// `storagePath` (private "documents" bucket).
const DOC_TYPES = ['חשבונית', 'זיכוי', 'תעודת משלוח', 'כרטסת', 'אחר'] as const

/** Where the document and its email live — whichever the caller has. */
export interface ReclassifyDoc {
  documentUrl?: string
  storagePath?: string
  messageLink?: string
  subject?: string
}

export function ReclassifyModal({
  doc, types = DOC_TYPES, onClose, onConfirm,
}: {
  doc: ReclassifyDoc
  /** The choices offered — a statement is not offered "כרטסת" or "אחר". */
  types?: readonly string[]
  onClose: () => void
  onConfirm: (docType: string) => void
}) {
  const { documentUrl: directUrl, storagePath, messageLink, subject } = doc
  const [docUrl, setDocUrl]   = useState<string | null>(directUrl ?? null)
  const [choice, setChoice]   = useState<string>('')
  const [mailResult, setMailResult] = useState<EmailOpen | null>(null)

  useLayoutEffect(() => {
    if (docUrl || !storagePath) return
    let alive = true
    supabase.storage.from('documents').createSignedUrl(storagePath, 120).then(({ data }) => {
      if (alive && data?.signedUrl) setDocUrl(data.signedUrl)
    })
    return () => { alive = false }
  // storagePath is stable for the lifetime of this modal
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
        style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #EEEEF2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px' }}>
            <X className="w-5 h-5" />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 600, color: '#1F2937', margin: 0 }}>סיווג מחדש של המסמך</h2>
            <FileX className="w-5 h-5" style={{ color: '#B45309' }} />
          </div>
        </div>

        {/* Document image */}
        <div style={{ padding: '16px 22px 8px' }}>
          {docUrl ? (
            <div style={{ height: '340px', border: '1px solid #E2E4E9', borderRadius: '12px', background: '#F9FAFB', overflow: 'hidden' }}>
              <DocumentBody url={docUrl} previewSrc={docUrl} />
            </div>
          ) : (
            <div style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E2E4E9', borderRadius: '12px', background: '#F9FAFB', color: '#6B7280', fontSize: '13px', textAlign: 'center', padding: '0 20px', lineHeight: 1.6 }}>
              {storagePath
                ? 'טוען את המסמך…'
                : messageLink
                  ? 'המסמך לא נשמר במערכת (התראה מלפני התיקון) — הוא נמצא במייל המקורי'
                  : 'המסמך לא נשמר במערכת'}
            </div>
          )}
          {/* The original email, here as well as on the card: this popup is where
              she decides what the document is, and the email is half the evidence. */}
          {messageLink && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
              <button
                onClick={async () => {
                  const how = await openEmail(messageLink, subject)
                  setMailResult(how === 'opened' ? null : how)
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: '#EFF6FF', color: '#1D4ED8', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <Mail className="w-3 h-3" />
                פתח מייל מקורי
              </button>
              {mailResult && (
                <span style={{ fontSize: '11.5px', color: '#6B7280', lineHeight: 1.5 }}>{emailOpenNote(mailResult)}</span>
              )}
            </div>
          )}
        </div>

        {/* Type picker */}
        <div style={{ padding: '8px 22px 22px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#374151', textAlign: 'right', margin: '0 0 10px' }}>בחר את סוג המסמך הנכון:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {types.map(dt => (
              <button
                key={dt}
                onClick={() => setChoice(dt)}
                style={{
                  padding: '8px 14px', borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  background: choice === dt ? 'var(--brand-primary-dark)' : 'white',
                  color:      choice === dt ? 'white'   : '#6B7280',
                  border: `1.5px solid ${choice === dt ? 'var(--brand-primary-dark)' : '#E2E4E9'}`,
                }}
              >
                {dt}
              </button>
            ))}
          </div>
          <button
            onClick={() => choice && onConfirm(choice)}
            disabled={!choice}
            style={{
              width: '100%', height: '46px', borderRadius: '12px', border: 'none', fontWeight: 700, fontSize: '15px', fontFamily: 'inherit',
              cursor: choice ? 'pointer' : 'not-allowed',
              background: choice ? 'var(--brand-primary)' : '#F3F4F6',
              color:      choice ? 'white'   : '#9CA3AF',
            }}
          >
            שמור סיווג
          </button>
        </div>
      </div>
    </div>
  )
}
