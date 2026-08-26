import { Mail, HardDrive, FileSpreadsheet, Store, Plug } from 'lucide-react'
import { SectionCard } from './ui/form'
import { STATUS } from '../theme/status'

// The connection points the top tier sells: where the system already meets other
// systems, and where it is fitted to a particular business.
//
// Shown only in the standalone demo (see CUSTOM_PAGES in src/lib/tiers.ts). The
// top tier is mostly adaptation work, which leaves it with little to *show* — this
// screen is what a prospect looks at while that is being explained. It has no
// place inside a system somebody already bought, where an integration is either
// configured or it is not.
//
// Every row states plainly whether it exists today or is bespoke work. A demo that
// implies a POS connection is already built would be a promise nobody meant to
// make — the same failure as a logo upload that reports success and saves nothing.

type Status = 'live' | 'custom'

interface Integration {
  Icon: typeof Mail
  title: string
  detail: string
  status: Status
}

const INTEGRATIONS: Integration[] = [
  {
    Icon: Mail,
    title: 'קליטה מתיבת המייל',
    detail: 'חשבוניות, תעודות משלוח, זיכויים וכרטסות נמשכים מהמייל, מסווגים ונקראים אוטומטית.',
    status: 'live',
  },
  {
    Icon: HardDrive,
    title: 'תיוק ב-Google Drive',
    detail: 'כל מסמך מקורי נשמר בתיקייה לפי ספק וחודש, עם קישור ישיר מכל שורה במערכת.',
    status: 'live',
  },
  {
    Icon: FileSpreadsheet,
    title: 'ייצוא להנהלת חשבונות',
    detail: 'קובץ ייצוא בפורמט של תוכנת ההנהלה, מוכן להעברה לרואה החשבון.',
    status: 'live',
  },
  {
    Icon: Store,
    title: 'חיבור לקופה',
    detail: 'התאמה בין מה שנקנה לבין מה שנמכר. נבנה מול הקופה הספציפית של העסק.',
    status: 'custom',
  },
  {
    Icon: Plug,
    title: 'מערכות נוספות',
    detail: 'מלאי, כספים, או כל מערכת אחרת שכבר עובדת אצלכם — נבחן ונחובר לפי הצורך.',
    status: 'custom',
  },
]

const BADGE: Record<Status, { label: string; bg: string; fg: string }> = {
  live:   { label: 'קיים במערכת',  bg: STATUS.green.bg,  fg: STATUS.green.fg },
  custom: { label: 'בהתאמה אישית', bg: STATUS.yellow.bg, fg: STATUS.yellow.fg },
}

export default function Integrations() {
  return (
    <div className="space-y-5" style={{ direction: 'rtl' }}>
      <SectionCard>
        <h2 className="font-bold text-gray-800" style={{ fontSize: '18px', marginBottom: '6px' }}>
          נקודות החיבור של המערכת
        </h2>
        <p className="text-gray-500" style={{ fontSize: '14px', lineHeight: 1.7, margin: 0 }}>
          המערכת לא עובדת לבד. חלק מהחיבורים פועלים מהיום הראשון, וחלק נבנים לפי מה
          שכבר קיים בעסק.
        </p>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {INTEGRATIONS.map(({ Icon, title, detail, status }) => {
          const badge = BADGE[status]
          return (
            <div
              key={title}
              className="bg-white rounded-2xl shadow-sm border p-5 flex gap-4"
              style={{ borderColor: '#E2E4E9' }}
            >
              <div
                className="rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ width: '44px', height: '44px', background: 'var(--brand-active-bg)' }}
              >
                <Icon className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: '4px' }}>
                  <h3 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>{title}</h3>
                  <span
                    className="font-semibold rounded-full"
                    style={{ fontSize: '11px', padding: '2px 9px', background: badge.bg, color: badge.fg }}
                  >
                    {badge.label}
                  </span>
                </div>
                <p className="text-gray-500" style={{ fontSize: '13px', lineHeight: 1.7, margin: 0 }}>
                  {detail}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
