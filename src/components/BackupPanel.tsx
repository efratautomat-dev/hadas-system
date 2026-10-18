import { useState } from 'react'
import {
  DatabaseBackup, Check, AlertCircle, Clock, RefreshCw, ExternalLink,
  LayoutGrid, Trash2, AlertTriangle,
} from 'lucide-react'
import { SectionCard } from './ui/form'
import { Button } from './ui/Button'
import { useBackups, BACKUP_STALE_DAYS, type BackupRun } from '../hooks/useBackups'
import { openExternal } from '../lib/native'
import { STATUS } from '../theme/status'

// ── Settings → גיבוי ─────────────────────────────────────────────────────────
//
// Two cards: the weekly backup, and the year-end prune. The first answers the one
// question anyone opens this tab for — did last week's backup happen, and was it
// complete — and everything else on it is the evidence for that answer rather
// than the answer itself.
//
// THE RULE THE STATES ARE BUILT ON: the panel never looks fine when it is not.
// A failure names the table and the size of the hole. And a last-successful
// backup older than ten days is painted as a problem EVEN THOUGH it succeeded,
// because the deepest failure here is a cron job that was deleted — there is no
// run, so nothing raises an alert, and this colour is the only symptom the system
// has for it.
//
// ⚠️ The Drive links go through `openExternal()`, never an <a target="_blank">.
// The shop runs this on an Android tablet where a new tab does not exist and a
// plain target="_blank" does nothing at all, silently. See docs/09-ANDROID-APP.md §5.

const HAIRLINE = '#E2E4E9'

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('he-IL')}, ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
}

function fmtBytes(n: number | null): string | null {
  if (!n) return null
  return n < 1024 * 1024 ? `${Math.round(n / 1024)}KB` : `${(n / (1024 * 1024)).toFixed(1)}MB`
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-xs font-bold rounded-full px-2.5 py-0.5"
      style={{ background: 'white', border: `1px solid ${HAIRLINE}`, color: '#4B5563', fontVariantNumeric: 'tabular-nums' }}
    >
      {children}
    </span>
  )
}

type Tone = 'ok' | 'bad' | 'warn' | 'run' | 'none'

const TONE: Record<Tone, { bg: string; border: string; chip: string; chipFg: string; title: string; body: string }> = {
  ok:   { bg: '#F4FCF6', border: '#CBEBD4', chip: STATUS.green.bg,  chipFg: STATUS.green.fg,  title: STATUS.green.fg,  body: '#4B7A5A' },
  bad:  { bg: '#FFF6F6', border: '#F6CDCD', chip: STATUS.red.bg,    chipFg: STATUS.red.fg,    title: STATUS.red.fg,    body: '#9B5555' },
  warn: { bg: '#FFFDF2', border: '#EFE3B4', chip: STATUS.yellow.bg, chipFg: STATUS.yellow.fg, title: STATUS.yellow.fg, body: '#8A7530' },
  run:  { bg: '#F5F9FF', border: '#C9DCF6', chip: STATUS.blue.bg,   chipFg: STATUS.blue.fg,   title: STATUS.blue.fg,   body: '#4A6590' },
  none: { bg: '#FAFAFB', border: HAIRLINE,  chip: STATUS.gray.bg,   chipFg: STATUS.gray.fg,   title: '#4B5563',        body: '#6B7280' },
}

function StatusCard({
  tone, Icon, title, children, actions,
}: {
  tone: Tone
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  title: string
  children?: React.ReactNode
  actions?: React.ReactNode
}) {
  const t = TONE[tone]
  return (
    <div
      className="flex gap-3.5 items-start rounded-2xl"
      style={{ background: t.bg, border: `1px solid ${t.border}`, padding: '16px 18px' }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0 rounded-xl"
        style={{ width: 38, height: 38, background: t.chip }}
      >
        <Icon className="w-5 h-5" style={{ color: t.chipFg }} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h4 className="font-bold text-[15px] mb-0.5" style={{ color: t.title }}>{title}</h4>
        <div className="text-[13px] leading-relaxed" style={{ color: t.body }}>{children}</div>
        {actions && <div className="flex flex-wrap gap-2.5 items-center mt-3">{actions}</div>}
      </div>
    </div>
  )
}

function DriveLink({ url, label }: { url: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => void openExternal(url)}
      className="inline-flex items-center gap-1.5 text-[13.5px] font-bold"
      style={{ color: 'var(--brand-primary)', textDecoration: 'underline', textUnderlineOffset: 3, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
    >
      {label}
      <ExternalLink className="w-3.5 h-3.5" />
    </button>
  )
}

function HistoryRow({ run }: { run: BackupRun }) {
  const pill = run.status === 'ok'
    ? (run.quarter_anchor ? { bg: '#EDE9FE', fg: '#5B21B6', text: `עוגן · ${run.quarter_anchor}` }
                          : { bg: STATUS.green.bg, fg: STATUS.green.fg, text: 'הצליח' })
    : run.status === 'failed'
      ? { bg: STATUS.red.bg,  fg: STATUS.red.fg,  text: 'נכשל' }
      : { bg: STATUS.blue.bg, fg: STATUS.blue.fg, text: 'רץ' }

  return (
    <div
      className="grid gap-3 items-center py-2.5 text-[13px]"
      style={{ gridTemplateColumns: '1fr auto auto', borderBottom: '1px solid #F2F3F5' }}
    >
      <span style={{ color: '#4B5563', fontVariantNumeric: 'tabular-nums', minWidth: 0 }}>
        {new Date(run.started_at).toLocaleDateString('he-IL')}
        <small className="block text-[11.5px]" style={{ color: '#9CA3AF' }}>
          {new Date(run.started_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
          {' · '}
          {run.triggered_by === 'cron' ? 'אוטומטי' : 'ידני'}
        </small>
      </span>
      <span style={{ color: '#6B7280', fontVariantNumeric: 'tabular-nums' }}>
        {run.total_rows !== null ? `${run.total_rows.toLocaleString('he-IL')} שורות` : '—'}
      </span>
      <span className="text-[11.5px] font-bold rounded-full px-2.5 py-0.5" style={{ background: pill.bg, color: pill.fg }}>
        {pill.text}
      </span>
    </div>
  )
}

export default function BackupPanel() {
  const { runs, cleanups, latest, isRunning, loading, error, busy, canRun, runNow, cleanupYear } = useBackups()
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmYear, setConfirmYear] = useState<number | null>(null)
  const [cleanupDone, setCleanupDone] = useState<string | null>(null)

  const lastOk = runs.find(r => r.status === 'ok') ?? null
  const staleDays = lastOk ? daysSince(lastOk.started_at) : null
  const isStale = staleDays !== null && staleDays > BACKUP_STALE_DAYS

  // Only years that have ENDED, and only ones a backup actually touched — a
  // picker offering a year with nothing in it invites a destructive click that
  // does nothing and teaches nothing.
  const thisYear = new Date().getFullYear()
  const prunableYears = [...new Set(
    runs.filter(r => r.status === 'ok').map(r => Number(r.run_date.slice(0, 4))),
  )].filter(y => y < thisYear).sort((a, b) => b - a)

  const handleRun = async () => {
    setActionError(null)
    try { await runNow() } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
  }

  const handleCleanup = async (year: number) => {
    setActionError(null)
    setCleanupDone(null)
    try {
      const result = await cleanupYear(year) as { result?: { trashed?: string[] } } | undefined
      const trashed = result?.result?.trashed ?? []
      setCleanupDone(trashed.length
        ? `${trashed.length} תיקיות חודש של ${year} הועברו לפח האשפה של דרייב`
        : `לא נמצאו תיקיות חודש למחיקה ב-${year}`)
      setConfirmYear(null)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
      setConfirmYear(null)
    }
  }

  const runButton = (
    <Button variant="primary" onClick={handleRun} disabled={busy || isRunning || !canRun}>
      <RefreshCw className="w-4 h-4" />
      {busy ? 'מתחיל…' : 'גיבוי עכשיו'}
    </Button>
  )

  return (
    <div className="space-y-5">
      <SectionCard title="גיבוי אוטומטי לדרייב">
        <p className="text-sm mb-4.5 leading-relaxed" style={{ color: '#6B7280', maxWidth: '66ch', marginBottom: 18 }}>
          כל שבת ב-04:00 המערכת שולפת את <b style={{ color: '#374151' }}>כל</b> נתוני המערכת
          ושומרת אותם בדרייב, בתיקייה של אותו חודש. כל גיבוי הוא צילום מלא ועומד בפני עצמו.
        </p>

        {/* An unreadable history is reported as such. Saying "never backed up"
            when we simply could not read the table would be the one lie this
            panel exists to prevent. */}
        {error && (
          <StatusCard tone="warn" Icon={AlertTriangle} title="לא ניתן לקרוא את היסטוריית הגיבויים">
            {error}
          </StatusCard>
        )}

        {!error && loading && (
          <StatusCard tone="none" Icon={Clock} title="טוען…" />
        )}

        {!error && !loading && isRunning && (
          <StatusCard
            tone="run" Icon={RefreshCw} title="הגיבוי מתבצע…"
            actions={<Button variant="outline" disabled>גיבוי עכשיו</Button>}
          >
            התחיל ב-{fmtDateTime(latest!.started_at)}. אפשר לעזוב את המסך — הגיבוי
            ממשיך ברקע, והשורה תתעדכן כשהוא יסתיים.
          </StatusCard>
        )}

        {!error && !loading && !isRunning && !latest && (
          <StatusCard
            tone="none" Icon={DatabaseBackup} title="עדיין לא בוצע גיבוי" actions={canRun ? runButton : undefined}
          >
            התזמון השבועי יתחיל בשבת הקרובה. אפשר גם להריץ אחד עכשיו.
          </StatusCard>
        )}

        {!error && !loading && !isRunning && latest?.status === 'failed' && (
          <StatusCard
            tone="bad" Icon={AlertCircle} title="הגיבוי נכשל"
            actions={
              <Button variant="outline" onClick={handleRun} disabled={busy || !canRun}>
                <RefreshCw className="w-4 h-4" />
                נסי שוב
              </Button>
            }
          >
            {fmtDateTime(latest.started_at)}
            <br />
            {latest.error_stage && <>נעצר בשלב <b>{latest.error_stage}</b>. </>}
            {latest.error}
            <br />
            <span style={{ opacity: 0.85 }}>לא הועלה כלום, והגיבוי הקודם לא נגע בו.</span>
          </StatusCard>
        )}

        {!error && !loading && !isRunning && latest?.status === 'ok' && (
          <>
            <StatusCard
              tone={isStale ? 'warn' : 'ok'}
              Icon={isStale ? Clock : Check}
              title={isStale
                ? `הגיבוי האחרון לפני ${staleDays} ימים`
                : 'הגיבוי האחרון הצליח'}
              actions={
                <>
                  {canRun ? runButton : (
                    <>
                      <Button variant="primary" disabled>גיבוי עכשיו</Button>
                      <span className="text-[11.5px] font-bold rounded-full px-2.5 py-0.5"
                            style={{ background: STATUS.gray.bg, color: STATUS.gray.fg }}>
                        לא זמין בהדגמה
                      </span>
                    </>
                  )}
                  {latest.drive_folder_link && (
                    <DriveLink url={latest.drive_folder_link} label="פתיחת התיקייה בדרייב" />
                  )}
                </>
              }
            >
              {fmtDateTime(latest.started_at)}
              {staleDays !== null && staleDays > 0 && ` · לפני ${staleDays} ימים`}
              {isStale && (
                <>
                  <br />
                  <b>הריצה הצליחה, אבל מאז לא רץ גיבוי — ייתכן שהתזמון השבועי הפסיק לפעול.</b>
                </>
              )}
              <div className="flex flex-wrap gap-2 mt-2.5">
                {latest.summary?.tables && <Fact>{latest.summary.tables.length} טבלאות</Fact>}
                {latest.total_rows !== null && <Fact>{latest.total_rows.toLocaleString('he-IL')} שורות</Fact>}
                {latest.file_count !== null && <Fact>{latest.file_count} קבצים</Fact>}
                {fmtBytes(latest.bytes) && <Fact>{fmtBytes(latest.bytes)}</Fact>}
              </div>
            </StatusCard>

            {latest.quarter_anchor && (
              <div className="mt-2.5">
                <StatusCard
                  tone="ok" Icon={LayoutGrid} title="נשמר גם כעוגן רבעוני"
                  actions={latest.quarter_folder_link
                    ? <DriveLink url={latest.quarter_folder_link} label="פתיחת תיקיית הרבעון" />
                    : undefined}
                >
                  הגיבוי האחרון של <b>{latest.quarter_anchor}</b> הועתק לתיקיית הרבעונים —
                  הוא יישאר שם גם אחרי ניקוי סוף השנה.
                </StatusCard>
              </div>
            )}
          </>
        )}

        {/* Warnings on an otherwise-successful run: an unclassified table, a
            workbook that fell back to CSV, rows that changed mid-read. */}
        {latest?.status === 'ok' && !!latest.summary?.warnings?.length && (
          <div
            className="mt-2.5 rounded-2xl text-[13px]"
            style={{ background: '#FFFDF2', border: '1px solid #EFE3B4', padding: '14px 18px', color: '#8A7530' }}
          >
            {latest.summary.warnings.map((w, i) => <div key={i}>• {w}</div>)}
          </div>
        )}

        {actionError && (
          <p className="text-xs mt-3 font-semibold" style={{ color: STATUS.red.fg }}>{actionError}</p>
        )}

        {runs.length > 0 && (
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid #ECECEF' }}>
            <h5 className="text-xs font-extrabold mb-2.5" style={{ color: '#9CA3AF', letterSpacing: '.04em' }}>
              הריצות האחרונות
            </h5>
            {/* The page must never scroll sideways — wide content scrolls inside
                its own box. `overflow-x: clip` would be the tidier rule and the
                shop tablet's WebView IGNORES it (see the Layout fix), so this is
                `auto`/`hidden` territory only. */}
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 280 }}>
                {runs.slice(0, 5).map(run => <HistoryRow key={run.id} run={run} />)}
              </div>
            </div>
          </div>
        )}

        <p className="mt-4 pt-3.5 text-xs leading-relaxed" style={{ borderTop: '1px solid #F2F3F5', color: '#9CA3AF' }}>
          <b style={{ color: '#6B7280' }}>מה נשמר:</b> ספקים, חשבוניות, תשלומים, חזרות,
          תעודות משלוח, הזמנות, כרטסות, הערות, התראות והגדרות.
          <br />
          {/* Anyone reading "full backup" assumes everything is in there. This
              line is the difference between an assumption and a known limit. */}
          <b style={{ color: '#6B7280' }}>מה לא:</b> קבצי המסמכים עצמם, ששמורים בדרייב
          מרגע הקליטה, ולוגי המערכת.
        </p>
      </SectionCard>

      <SectionCard title="ניקוי סוף שנה">
        <p className="text-sm leading-relaxed" style={{ color: '#6B7280', maxWidth: '66ch', marginBottom: 16 }}>
          מחיקת תיקיות החודשים של שנה שהסתיימה.{' '}
          <b style={{ color: '#374151' }}>ארבע תיקיות הרבעונים נשמרות</b> — נשארת תמונה אחת לכל רבעון.
        </p>

        {prunableYears.length === 0 && (
          <p className="text-[13px]" style={{ color: '#9CA3AF' }}>
            אין עדיין שנה שהסתיימה עם גיבויים לנקות.
          </p>
        )}

        {/* A second confirmation before anything is moved — the same policy as
            rejecting an invoice, which is also destructive. And it is worded by
            what SURVIVES, before what goes. */}
        {prunableYears.length > 0 && confirmYear === null && (
          <div className="flex flex-wrap gap-2.5 items-center">
            {prunableYears.map(year => (
              <Button key={year} variant="danger" onClick={() => setConfirmYear(year)} disabled={busy || !canRun}>
                <Trash2 className="w-4 h-4" />
                ניקוי {year}
              </Button>
            ))}
          </div>
        )}

        {confirmYear !== null && (
          <div
            className="rounded-2xl"
            style={{ background: '#FFF6F6', border: '1px solid #F6CDCD', padding: '16px 18px' }}
          >
            <p className="text-[13.5px] leading-relaxed mb-3" style={{ color: '#9B5555' }}>
              <b style={{ color: STATUS.red.fg }}>למחוק את תיקיות החודשים של {confirmYear}?</b>
              <br />
              תיקיות הרבעונים של {confirmYear} נשמרות.
              <br />
              הכל עובר לפח האשפה של דרייב וניתן לשחזור 30 יום.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="danger" onClick={() => void handleCleanup(confirmYear)} disabled={busy}>
                {busy ? 'מוחק…' : 'כן, למחוק'}
              </Button>
              <Button variant="outline" onClick={() => setConfirmYear(null)} disabled={busy}>ביטול</Button>
            </div>
          </div>
        )}

        {cleanupDone && (
          <p className="text-xs mt-3 font-semibold" style={{ color: STATUS.green.fg }}>{cleanupDone}</p>
        )}

        {!canRun && prunableYears.length > 0 && (
          <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>לא זמין בהדגמה.</p>
        )}

        {cleanups.length > 0 && (
          <p className="text-xs mt-4 pt-3" style={{ borderTop: '1px solid #F2F3F5', color: '#9CA3AF' }}>
            ניקוי אחרון: {fmtDateTime(cleanups[0].started_at)}
            {cleanups[0].status !== 'ok' && ' — נכשל'}
          </p>
        )}
      </SectionCard>
    </div>
  )
}
