import { useState, useEffect } from 'react'
import { ChevronLeft, StickyNote, Pencil, Trash2, Check, X } from 'lucide-react'
import { useSupplierNotes, NOTE_TAG_LABEL, type NoteTag, type SupplierNote } from '../hooks/useSupplierNotes'

// Tag colours. Functional, not brand — a tag says WHERE a note came from, and
// that reading must survive a reskin.
const TAG_STYLE: Record<NoteTag, { bg: string; fg: string }> = {
  suppliers:  { bg: '#F3F4F6', fg: '#4B5563' },
  payments:   { bg: '#DBEAFE', fg: '#1E40AF' },
  statements: { bg: '#FEF3C7', fg: '#92400E' },
}

/** `efrat@hadas.co.il` → `efrat`. There is no display name anywhere in the app —
 *  `allowed_users` holds only (email, role) — so the local part is the most
 *  human thing available. */
function authorLabel(email: string | null): string {
  if (!email) return ''
  return email.split('@')[0]
}

function noteDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
         ' · ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

function NoteRow({ note, onSave, onDelete }: {
  note: SupplierNote
  onSave: (id: string, body: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(note.body)
  const tag = TAG_STYLE[note.tag] ?? TAG_STYLE.suppliers

  return (
    <div style={{ background: 'white', border: '1px solid #E8E6EA', borderRadius: '12px', padding: '10px 12px' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: '6px' }}>
        <span className="rounded-md font-bold" style={{ fontSize: '10.5px', padding: '2px 7px', background: tag.bg, color: tag.fg }}>
          {NOTE_TAG_LABEL[note.tag] ?? note.tag}
        </span>
        <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{noteDate(note.createdAt)}</span>
        {note.authorEmail && (
          <span style={{ fontSize: '11px', color: '#9CA3AF' }}>· {authorLabel(note.authorEmail)}</span>
        )}
        {!editing && (
          <span className="flex items-center gap-1" style={{ marginInlineStart: 'auto' }}>
            <button
              onClick={() => { setDraft(note.body); setEditing(true) }}
              title="עריכה"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '2px' }}
            ><Pencil className="w-3.5 h-3.5" /></button>
            <button
              onClick={() => void onDelete(note.id)}
              title="מחיקה"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '2px' }}
            ><Trash2 className="w-3.5 h-3.5" /></button>
          </span>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            style={{
              width: '100%', minHeight: '64px', resize: 'vertical', fontFamily: 'inherit',
              fontSize: '13px', lineHeight: 1.55, color: '#1F2125',
              background: '#FAFAFC', border: '1px solid #E8E6EA', borderRadius: '9px', padding: '7px 9px',
            }}
          />
          <div className="flex gap-1.5" style={{ marginTop: '6px' }}>
            <button
              onClick={async () => { await onSave(note.id, draft); setEditing(false) }}
              disabled={!draft.trim()}
              className="flex items-center gap-1 rounded-lg font-bold"
              style={{ background: 'var(--brand-primary)', color: 'white', border: 'none', padding: '5px 11px', fontSize: '12px', cursor: 'pointer', opacity: draft.trim() ? 1 : 0.45 }}
            ><Check className="w-3.5 h-3.5" />שמור</button>
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 rounded-lg font-bold"
              style={{ background: 'white', color: '#6B7280', border: '1px solid #E8E6EA', padding: '5px 11px', fontSize: '12px', cursor: 'pointer' }}
            ><X className="w-3.5 h-3.5" />ביטול</button>
          </div>
        </>
      ) : (
        <p className="text-right" style={{ fontSize: '13px', color: '#1F2125', whiteSpace: 'pre-wrap', lineHeight: 1.55, margin: 0 }}>
          {note.body}
        </p>
      )}
    </div>
  )
}

/**
 * The supplier note panel — a small CRM log, mounted ONCE in Layout.
 *
 * Mounted once rather than per screen so there is one instance, the open/closed
 * state survives navigation, and the TAG comes straight from the active page
 * instead of a mapping every screen has to remember to pass correctly.
 *
 * It sits on the LEFT because the nav sidebar owns the right edge under RTL, and
 * it FLOATS over the page rather than pushing it — no screen has to reserve room
 * or reflow when it opens.
 *
 * With no supplier in focus the handle is not offered at all: a note has to
 * belong to someone.
 */
export function SupplierNotesPanel({ supplierId, supplierName, tag }: {
  supplierId: string | null
  supplierName: string
  tag: NoteTag
}) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('hadas.notesOpen') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('hadas.notesOpen', open ? '1' : '0') } catch { /* private mode */ }
  }, [open])

  const { data: notes, loading, create, update, remove } = useSupplierNotes(supplierId)
  const [draft, setDraft] = useState('')

  if (!supplierId) return null

  const WIDTH = 330

  return (
    <>
      {/* Handle — visible whether the panel is open or shut, so the way back in
          is never hidden behind the thing it opens. */}
      <button
        onClick={() => setOpen(o => !o)}
        title={open ? 'סגירת הערות' : 'הערות הספק'}
        style={{
          position: 'fixed', left: open ? `${WIDTH}px` : '0', top: '50%', transform: 'translateY(-50%)',
          // Above modals (z-50). On the payments screen the "open row" IS a modal,
          // so a drawer underneath it would be rendered and unreachable. A left-edge
          // drawer and a centred dialog do not fight for the same space.
          zIndex: 61, background: 'white', border: '1px solid #E8E6EA', borderInlineStart: 'none',
          borderRadius: '0 12px 12px 0', padding: '14px 5px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
          boxShadow: '2px 0 8px rgba(16,17,21,.06)', transition: 'left 0.25s ease',
        }}
      >
        <ChevronLeft className="w-4 h-4" style={{ color: 'var(--brand-primary)', transform: open ? 'rotate(180deg)' : 'none' }} />
        {!open && <StickyNote className="w-4 h-4" style={{ color: '#9CA3AF' }} />}
        {!open && notes.length > 0 && (
          <span className="font-bold" style={{ fontSize: '10px', color: 'var(--brand-primary)' }}>{notes.length}</span>
        )}
      </button>

      <aside
        style={{
          position: 'fixed', left: 0, top: 0, bottom: 0, width: `${WIDTH}px`, zIndex: 60,
          background: '#F6F5F7', borderInlineEnd: '1px solid #E8E6EA',
          boxShadow: open ? '2px 0 16px rgba(16,17,21,.10)' : 'none',
          transform: open ? 'translateX(0)' : `translateX(-${WIDTH + 20}px)`,
          transition: 'transform 0.25s ease',
          display: 'flex', flexDirection: 'column', direction: 'rtl',
        }}
      >
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #E8E6EA', background: 'white', flexShrink: 0 }}>
          <div className="flex items-center gap-2">
            <StickyNote className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
            <h2 className="font-bold text-gray-800" style={{ fontSize: '14px' }}>הערות</h2>
            <span style={{ marginInlineStart: 'auto', fontSize: '11.5px', color: '#9CA3AF' }}>
              {notes.length ? `${notes.length} הערות` : ''}
            </span>
          </div>
          <p className="truncate" style={{ fontSize: '12.5px', color: '#6B6E73', marginTop: '2px' }} title={supplierName}>
            {supplierName}
          </p>
        </div>

        {/* Composer, at the top — this is a log, and the thing you came to do is add
            to it. The tag is shown, not chosen: it says where the note will be filed. */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #E8E6EA', background: 'white', flexShrink: 0 }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="הערה חדשה…"
            style={{
              width: '100%', minHeight: '58px', resize: 'vertical', fontFamily: 'inherit',
              fontSize: '13px', lineHeight: 1.55, color: '#1F2125',
              background: '#FAFAFC', border: '1px solid #E8E6EA', borderRadius: '10px', padding: '8px 10px',
            }}
          />
          <div className="flex items-center gap-2" style={{ marginTop: '7px' }}>
            <button
              onClick={async () => { await create(draft, tag); setDraft('') }}
              disabled={!draft.trim()}
              className="rounded-lg font-bold"
              style={{ background: 'var(--brand-primary)', color: 'white', border: 'none', padding: '6px 14px', fontSize: '12.5px', cursor: draft.trim() ? 'pointer' : 'not-allowed', opacity: draft.trim() ? 1 : 0.45 }}
            >הוספה</button>
            <span className="rounded-md font-bold" style={{ fontSize: '10.5px', padding: '2px 7px', ...{ background: TAG_STYLE[tag].bg, color: TAG_STYLE[tag].fg } }}>
              {NOTE_TAG_LABEL[tag]}
            </span>
            <span style={{ fontSize: '11px', color: '#9CA3AF' }}>התיוג נקבע לפי המסך</span>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {loading && notes.length === 0 && (
            <p className="text-center text-gray-400" style={{ fontSize: '12.5px', paddingTop: '16px' }}>טוען…</p>
          )}
          {!loading && notes.length === 0 && (
            <p className="text-center text-gray-400" style={{ fontSize: '12.5px', paddingTop: '16px', lineHeight: 1.6 }}>
              אין עדיין הערות לספק הזה.<br />ההערה הראשונה תופיע כאן.
            </p>
          )}
          {notes.map(n => (
            <NoteRow key={n.id} note={n} onSave={update} onDelete={remove} />
          ))}
        </div>
      </aside>
    </>
  )
}
