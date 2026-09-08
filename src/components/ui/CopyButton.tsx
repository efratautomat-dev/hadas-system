import { useEffect, useRef, useState } from 'react'
import { Copy, Check, X } from 'lucide-react'
import { copyText } from '../../lib/clipboard'

// ── "עד שהשליחה תפותח" ───────────────────────────────────────────────────────
//
// The owner's ask, and it is the right shape for the gap: sending a note by mail
// or WhatsApp is built and not wired, and until it is she writes the note here
// and retypes it in her mail client. One click that puts the exact text on the
// clipboard closes that gap without pretending the send exists.
//
// What it copies is the NOTE TEXT and nothing else — no header, no supplier name,
// no date. She is pasting into a message she is writing herself, and anything the
// system adds is something she has to delete.
//
// The answer is shown, not assumed: the icon turns into a tick for a moment, or
// into an ✗ if the clipboard refused. A button that reports a success it did not
// have sends an empty paste to a supplier.

export function CopyButton({
  text, title = 'העתקה', size = 14, color = '#9CA3AF',
}: {
  text: string
  title?: string
  size?: number
  color?: string
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Nothing written yet = nothing to copy. An enabled control over an empty note
  // is a click that silently does nothing.
  if (!text.trim()) return null

  const run = async () => {
    const ok = await copyText(text)
    setState(ok ? 'done' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1800)
  }

  const Icon = state === 'done' ? Check : state === 'failed' ? X : Copy
  const tint = state === 'done' ? '#0E9F6E' : state === 'failed' ? '#DC2626' : color

  return (
    <button
      type="button"
      onClick={run}
      title={state === 'done' ? 'הועתק' : state === 'failed' ? 'ההעתקה לא הצליחה' : title}
      aria-label={title}
      className="inline-flex items-center gap-1"
      style={{
        background: 'none', border: 'none', padding: '2px', cursor: 'pointer',
        color: tint, fontFamily: 'inherit', fontSize: '11.5px', fontWeight: 700,
      }}
    >
      <Icon style={{ width: size, height: size }} />
      {state === 'done' && <span>הועתק</span>}
      {state === 'failed' && <span>לא הועתק</span>}
    </button>
  )
}
