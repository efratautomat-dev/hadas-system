import { useState } from 'react'
import { ChevronLeft, StickyNote, Pencil, Trash2, Check, X, ExternalLink } from 'lucide-react'
import {
  useSupplierNotes, NOTE_TAG_LABEL, NOTE_TAG_STYLE,
  type NoteTag, type FeedNote,
} from '../hooks/useSupplierNotes'
import { NOTE_SOURCES, type NoteOpenIntent } from '../lib/noteSources'

/** The panel's width when open. Layout reads it too — it shifts the page by
 *  exactly this much — so it lives here, next to the thing it measures. */
export const NOTES_PANEL_WIDTH = 344

/** `efrat@hadas.co.il` → `efrat`. There is no display name anywhere in the app —
 *  `allowed_users` holds only (email, role) — so the local part is the most
 *  human thing available. */
function authorLabel(email: string | null | undefined): string {
  if (!email) return ''
  return email.split('@')[0]
}

/** Date-only records (a payment, a return) have no clock reading to show, so
 *  showing 00:00 for them would be an invention. Time appears only when the
 *  stored value actually carries one. */
function noteDate(iso: string): string {
  if (!iso) return 'ללא תאריך'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'ללא תאריך'
  const day = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
  return /\d\d:\d\d/.test(iso)
    ? `${day} · ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
    : day
}

const CARD: React.CSSProperties = {
  background: 'white', border: '1px solid #E8E6EA', borderRadius: '12px', padding: '9px 11px',
}

function Tag({ style, children }: { style: { bg: string; fg: string }; children: React.ReactNode }) {
  return (
    <span className="rounded-md font-bold"
      style={{ fontSize: '10.5px', padding: '2px 7px', background: style.bg, color: style.fg }}>
      {children}
    </span>
  )
}

/** A note WRITTEN in the panel — the only kind that can be edited here. */
function OwnNoteRow({ note, onSave, onDelete }: {
  note: FeedNote
  onSave: (id: string, body: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(note.body)

  return (
    <div style={CARD}>
      <div className="flex items-center gap-2" style={{ marginBottom: '5px' }}>
        <Tag style={note.style}>{note.label}</Tag>
        <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{noteDate(note.date)}</span>
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
              onClick={() => void onDelete(note.noteId!)}
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
              onClick={async () => { await onSave(note.noteId!, draft); setEditing(false) }}
              disabled={!draft.trim()}
              className="flex items-center gap-1 rounded-lg font-bold"
              style={{
                background: 'var(--brand-primary)', color: 'white', border: 'none',
                padding: '4px 10px', fontSize: '12px',
                cursor: draft.trim() ? 'pointer' : 'not-allowed', opacity: draft.trim() ? 1 : 0.45,
              }}
            ><Check className="w-3 h-3" />שמירה</button>
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 rounded-lg font-bold"
              style={{ background: 'white', color: '#6B6E73', border: '1px solid #E8E6EA', padding: '4px 10px', fontSize: '12px', cursor: 'pointer' }}
            ><X className="w-3 h-3" />ביטול</button>
          </div>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.55, whiteSpace: 'pre-wrap', color: '#1F2125' }}>
          {note.body}
        </p>
      )}
    </div>
  )
}

/**
 * A note COLLECTED from elsewhere. Dashed border and a "נאסף אוטומטית" chip so
 * it never reads as something written here, and a footer that names the record
 * and opens it — the note without its context is half the information.
 */
function DerivedNoteRow({ note, onOpen }: {
  note: FeedNote
  onOpen: (intent: NoteOpenIntent) => void
}) {
  return (
    <div style={{ ...CARD, background: '#FBFBFD', borderStyle: 'dashed' }}>
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: '5px' }}>
        <Tag style={note.style}>{note.label}</Tag>
        <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{noteDate(note.date)}</span>
        <span className="font-bold" style={{
          marginInlineStart: 'auto', fontSize: '10px', color: '#9CA3AF',
          border: '1px solid #E8E6EA', borderRadius: '5px', padding: '1px 5px',
        }}>נאסף אוטומטית</span>
      </div>

      <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.55, whiteSpace: 'pre-wrap', color: '#1F2125' }}>
        {note.body}
      </p>

      {note.ref && (
        <div className="flex items-center gap-1.5 flex-wrap" style={{
          marginTop: '7px', paddingTop: '6px', borderTop: '1px dashed #E8E6EA',
          fontSize: '11.5px', color: '#6B6E73',
        }}>
          <span>{note.ref.label}</span>
          {note.ref.figure && (
            <span className="font-bold" style={{ color: '#1F2125', direction: 'ltr', unicodeBidi: 'isolate' }}>
              {note.ref.figure}
            </span>
          )}
          {note.open && (
            <button
              onClick={() => onOpen(note.open!)}
              className="flex items-center gap-1 font-bold"
              style={{
                marginInlineStart: 'auto', background: 'none', border: 'none', padding: 0,
                cursor: 'pointer', color: 'var(--brand-primary)', fontSize: '11.5px',
              }}
            >{note.ref.action}<ExternalLink className="w-3 h-3" /></button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The supplier notes panel — everything the system knows in words about one
 * supplier, in one column.
 *
 * Mounted ONCE, in Layout, so the open state survives navigation and the tag for
 * a new note comes straight from the active page. It is fixed to the left edge
 * and Layout shifts the page content by NOTES_PANEL_WIDTH to match: the panel
 * SQUEEZES the page rather than covering it, so nothing you were reading
 * disappears behind it.
 *
 * With no supplier in focus the handle is not offered at all: a note has to
 * belong to someone.
 */
export function SupplierNotesPanel({ supplierId, supplierName, tag, open, onToggle, onOpenRecord }: {
  supplierId: string | null
  supplierName: string
  tag: NoteTag
  open: boolean
  onToggle: () => void
  onOpenRecord: (intent: NoteOpenIntent) => void
}) {
  const { feed, loading, create, update, remove } = useSupplierNotes(supplierId)
  const [draft, setDraft]   = useState('')
  const [filter, setFilter] = useState<string>('all')

  if (!supplierId) return null

  // Chips are built from the registry plus the one hand-written kind, so a new
  // source gets its chip for free. Counts come from the feed itself — a chip
  // that would show 0 is not offered rather than shown empty.
  const chipDefs = [
    { key: 'manual', label: 'נכתב ידנית' },
    ...NOTE_SOURCES.map(s => ({ key: s.key, label: s.label })),
  ]
  const counts: Record<string, number> = {}
  for (const n of feed) counts[n.sourceKey] = (counts[n.sourceKey] ?? 0) + 1

  const shown = filter === 'all' ? feed : feed.filter(n => n.sourceKey === filter)
  const W = NOTES_PANEL_WIDTH

  return (
    <>
      {/* Handle — visible whether the panel is open or shut, so the way back in
          is never hidden behind the thing it opens. */}
      <button
        onClick={onToggle}
        title={open ? 'סגירת הערות' : 'הערות הספק'}
        style={{
          position: 'fixed', left: open ? `${W}px` : '0', top: '50%', transform: 'translateY(-50%)',
          // Above modals (z-50). On the payments screen the "open row" IS a modal,
          // so a drawer underneath it would be rendered and unreachable.
          zIndex: 61, background: 'white', border: '1px solid #E8E6EA', borderInlineStart: 'none',
          borderRadius: '0 12px 12px 0', padding: '14px 5px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
          boxShadow: '2px 0 8px rgba(16,17,21,.06)', transition: 'left 0.25s ease',
        }}
      >
        <ChevronLeft className="w-4 h-4" style={{ color: 'var(--brand-primary)', transform: open ? 'rotate(180deg)' : 'none' }} />
        {!open && <StickyNote className="w-4 h-4" style={{ color: '#9CA3AF' }} />}
        {!open && feed.length > 0 && (
          <span className="font-bold" style={{ fontSize: '10px', color: 'var(--brand-primary)' }}>{feed.length}</span>
        )}
      </button>

      <aside
        style={{
          position: 'fixed', left: 0, top: 0, bottom: 0, width: `${W}px`, zIndex: 60,
          background: '#F6F5F7', borderInlineEnd: '1px solid #E8E6EA',
          transform: open ? 'translateX(0)' : `translateX(-${W + 20}px)`,
          transition: 'transform 0.25s ease',
          display: 'flex', flexDirection: 'column', direction: 'rtl',
        }}
      >
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #E8E6EA', background: 'white', flexShrink: 0 }}>
          <div className="flex items-center gap-2">
            <StickyNote className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
            <h2 className="font-bold text-gray-800" style={{ fontSize: '14px' }}>הערות</h2>
            <span style={{ marginInlineStart: 'auto', fontSize: '11.5px', color: '#9CA3AF' }}>
              {feed.length ? `${feed.length} הערות` : ''}
            </span>
          </div>
          <p className="truncate" style={{ fontSize: '12.5px', color: '#6B6E73', marginTop: '2px' }} title={supplierName}>
            {supplierName}
          </p>
          <p style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '1px' }}>
            כל מה שנכתב על הספק — מכל מסך במערכת
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
            <Tag style={NOTE_TAG_STYLE[tag]}>{NOTE_TAG_LABEL[tag]}</Tag>
            <span style={{ fontSize: '11px', color: '#9CA3AF' }}>התיוג נקבע לפי המסך</span>
          </div>
        </div>

        {/* Source filter. Only kinds that actually have rows get a chip. */}
        {feed.length > 0 && (
          <div className="flex flex-wrap gap-1" style={{ padding: '8px 12px', borderBottom: '1px solid #E8E6EA', flexShrink: 0 }}>
            {[{ key: 'all', label: 'הכל' }, ...chipDefs.filter(c => counts[c.key])].map(c => {
              const active = filter === c.key
              const n = c.key === 'all' ? feed.length : counts[c.key]
              return (
                <button
                  key={c.key}
                  onClick={() => setFilter(c.key)}
                  className="rounded-full font-bold"
                  style={{
                    fontSize: '11.5px', padding: '3px 10px', cursor: 'pointer',
                    border: `1px solid ${active ? '#1F2125' : '#E8E6EA'}`,
                    background: active ? '#1F2125' : 'white',
                    color: active ? 'white' : '#6B6E73',
                  }}
                >{c.label} · {n}</button>
              )
            })}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {loading && feed.length === 0 && (
            <p className="text-center text-gray-400" style={{ fontSize: '12.5px', paddingTop: '16px' }}>טוען…</p>
          )}
          {!loading && feed.length === 0 && (
            <p className="text-center text-gray-400" style={{ fontSize: '12.5px', paddingTop: '16px', lineHeight: 1.6 }}>
              אין עדיין הערות לספק הזה.<br />ההערה הראשונה תופיע כאן.
            </p>
          )}
          {feed.length > 0 && shown.length === 0 && (
            <p className="text-center text-gray-400" style={{ fontSize: '12.5px', paddingTop: '16px' }}>
              אין הערות בסינון הזה.
            </p>
          )}
          {shown.map(n => n.editable
            ? <OwnNoteRow key={n.key} note={n} onSave={update} onDelete={remove} />
            : <DerivedNoteRow key={n.key} note={n} onOpen={onOpenRecord} />
          )}
        </div>
      </aside>
    </>
  )
}
