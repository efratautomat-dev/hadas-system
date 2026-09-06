import { useState } from 'react'
import { MailWarning, RefreshCw, ChevronDown } from 'lucide-react'
import { useParkedDocuments } from '../hooks/useParkedDocuments'

// ── "מסמכים שלא נכנסו" ───────────────────────────────────────────────────────
//
// The one failure mode the system could not report on itself. Ingest gives an
// email two tries, then parks it behind a Gmail label so it stops clogging the
// queue — and from that moment it existed only in a table no screen read. Every
// dashboard said healthy while a supplier's invoice sat unread.
//
// Two deliberate choices about how loud this is:
//
//   · it renders NOTHING at zero. A permanent "0 documents lost" panel is noise,
//     and noise is what people stop seeing. It appears when there is something.
//   · at one or more it is red and near the top, because the cost is asymmetric.
//     A false alarm costs a click; a missed invoice costs a supplier relationship
//     and is discovered months later by someone else.

export default function ParkedDocuments() {
  const { data, loading, error, busy, retry } = useParkedDocuments()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  if (loading || (data.length === 0 && !error && !result)) return null

  const run = async (mode: 'requeue' | 'sweep') => {
    const res = await retry(mode) as { parkedBefore?: number; parkedAfter?: number }
    const recovered = (res.parkedBefore ?? 0) - (res.parkedAfter ?? 0)
    setResult(
      recovered > 0
        ? `${recovered} מסמכים חזרו לתור ונקלטים כעת.`
        : mode === 'requeue'
          ? 'לא נמצאו מיילים עם תווית "פענוח נכשל". נסי סריקה רחבה.'
          : 'הסריקה הרחבה לא מצאה מסמכים נוספים.',
    )
  }

  return (
    <div
      className="bg-white border"
      style={{ borderColor: '#FCA5A5', borderInlineStartWidth: '3px', borderInlineStartColor: '#DC2626', marginBottom: '20px' }}
    >
      <div className="flex items-center gap-3 flex-wrap" style={{ padding: '14px 18px' }}>
        <MailWarning className="w-5 h-5" style={{ color: '#DC2626', flex: 'none' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="font-bold text-gray-800" style={{ fontSize: '15px', margin: 0 }}>
            {data.length === 1 ? 'מסמך אחד לא נכנס למערכת' : `${data.length} מסמכים לא נכנסו למערכת`}
          </h3>
          <p style={{ fontSize: '12.5px', color: '#6B6E73', margin: '2px 0 0' }}>
            המיילים האלה נכשלו בפענוח ונשמרו בצד. הם עדיין בתיבה — אפשר להחזיר אותם לתור.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() => run('requeue')}
          className="font-semibold inline-flex items-center gap-1.5 text-white"
          style={{ background: '#DC2626', border: 'none', padding: '8px 15px', fontSize: '13px', cursor: busy ? 'wait' : 'pointer' }}
        ><RefreshCw className="w-4 h-4" />{busy ? 'מנסה…' : 'נסי שוב'}</button>
      </div>

      {result && (
        <p style={{ margin: 0, padding: '0 18px 12px', fontSize: '13px', color: '#166534' }}>{result}</p>
      )}
      {error && (
        <p style={{ margin: 0, padding: '0 18px 12px', fontSize: '13px', color: '#DC2626' }}>
          לא ניתן לקרוא את רשימת המסמכים: {error}
        </p>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5"
        style={{ background: 'transparent', border: 'none', color: '#6B6E73', fontSize: '12.5px', cursor: 'pointer', padding: '0 18px 12px' }}
      >
        <ChevronDown className="w-3.5 h-3.5" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        {open ? 'סגירת הפירוט' : 'מה נכשל, ולמה'}
      </button>

      {open && (
        <div style={{ borderTop: '1px solid #FEE2E2' }}>
          {data.map(d => (
            <div key={d.gmailMessageId} style={{ padding: '10px 18px', borderBottom: '1px solid #FEF2F2', fontSize: '12.5px' }}>
              <div style={{ color: '#4B5563' }}>
                {new Date(d.lastAttemptAt).toLocaleString('he-IL')} · {d.attempts} ניסיונות
              </div>
              <div style={{ color: '#9CA3AF', direction: 'ltr', textAlign: 'left', wordBreak: 'break-word' }}>
                {d.lastError || '—'}
              </div>
            </div>
          ))}
          <div style={{ padding: '12px 18px' }}>
            <button
              disabled={busy}
              onClick={() => run('sweep')}
              style={{ background: 'white', color: '#DC2626', border: '1px solid #DC2626', padding: '7px 13px', fontSize: '12.5px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}
            >סריקה רחבה — 120 יום</button>
            {/* Two different holes, not one with a bigger number: requeue finds
                emails wearing the FAILED label; sweep finds those left unlabeled
                for a retry that then aged out of the routine 14-day window. */}
            <p style={{ fontSize: '11.5px', color: '#9CA3AF', margin: '6px 0 0' }}>
              למיילים שנכשלו, נשארו ללא תווית, והזדקנו מעבר לחלון השגרתי.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
