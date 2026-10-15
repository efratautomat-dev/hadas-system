import { useState } from 'react'
import { PencilLine, X } from 'lucide-react'
import { useWishes } from '../../hooks/useWishes'
import { shortDate } from '../../lib/clock'

// ── "הייתי רוצה שיהיה אחרת" ──────────────────────────────────────────────────
//
// Sits in the top bar, so it is on EVERY screen, and stamps the screen she was on
// when she wrote — a wish about "here" is useless once nobody knows where here was.
// The dialog shows what was already asked underneath, so the list is read in
// order rather than lost one message at a time.

export default function WishButton({ page, pageLabel, compact }: { page: string; pageLabel: string; compact?: boolean }) {
  const [open, setOpen]   = useState(false)
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(false)
  const { wishes, add } = useWishes()

  const save = async () => {
    if (!draft.trim()) return
    await add(draft, page, pageLabel)
    setDraft('')
    setSaved(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setSaved(false) }}
        title="הייתי רוצה שיהיה אחרת"
        className="flex items-center gap-1.5 rounded-full text-[12.5px] font-semibold transition-colors flex-shrink-0"
        style={{ border: '1px dashed #D9D8DE', color: '#6B6E73', padding: compact ? '0' : '6px 13px', width: compact ? 36 : undefined, height: compact ? 36 : undefined, justifyContent: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand-primary)'; e.currentTarget.style.color = 'var(--brand-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#D9D8DE'; e.currentTarget.style.color = '#6B6E73' }}
      >
        <PencilLine className="w-4 h-4" />
        {!compact && 'הייתי רוצה שיהיה אחרת'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(17,17,26,.45)' }}
          onClick={() => setOpen(false)}>
          <div dir="rtl" className="bg-white rounded-2xl w-full max-w-md shadow-xl flex flex-col" style={{ maxHeight: '85vh' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid #F1F1F4' }}>
              <h2 className="text-base font-extrabold">הייתי רוצה שיהיה אחרת</h2>
              <button type="button" onClick={() => setOpen(false)} className="mr-auto text-gray-400 hover:text-gray-600" aria-label="סגירה">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-2">
              <p className="text-xs text-gray-500">
                בקשה על <b>המערכת</b>, לא על ספק. נשמרת יחד עם המסך שבו את נמצאת עכשיו: <b>{pageLabel}</b>.
              </p>
              <textarea
                autoFocus value={draft} onChange={e => { setDraft(e.target.value); setSaved(false) }}
                rows={4} placeholder="מה היית רוצה שיעבוד אחרת?"
                className="w-full text-sm rounded-xl px-3 py-2 outline-none resize-none"
                style={{ border: '1px solid #E4E5EA' }}
              />
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => void save()} disabled={!draft.trim()}
                  className="rounded-xl text-sm font-bold text-white px-4 py-2 disabled:opacity-40"
                  style={{ background: 'var(--brand-primary)' }}>
                  שמירה
                </button>
                {saved && <span className="text-xs font-bold" style={{ color: '#166534' }}>נשמר ✓</span>}
              </div>
            </div>

            {wishes.length > 0 && (
              <div className="overflow-y-auto px-5 pb-4" style={{ borderTop: '1px solid #F1F1F4' }}>
                <p className="text-[11px] font-extrabold text-gray-400 pt-3 pb-1.5">מה כבר ביקשת · {wishes.length}</p>
                {wishes.map(w => (
                  <div key={w.id} className="py-2" style={{ borderTop: '1px solid #F7F7F9' }}>
                    <p className="text-[13px]" style={{ color: '#3F4147' }}>{w.body}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{w.pageLabel || w.page} · {shortDate(w.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
