import { useMemo, useState } from 'react'
import { Camera, Check, X, ArrowLeft } from 'lucide-react'
import ParkedDocuments from '../ParkedDocuments'
import { useInvoices } from '../../hooks/useInvoices'
import { useDeliveryNotes } from '../../hooks/useDeliveryNotes'
import { usePayments } from '../../hooks/usePayments'
import { useStatements } from '../../hooks/useStatements'
import { useOrders } from '../../hooks/useOrders'
import { useOpenNotes, type OpenNote } from '../../hooks/useOpenNotes'
import { useTasks } from '../../hooks/useTasks'
import { resolveAlertDestination, getAlertTypeConf } from '../Alerts'
import type { Alert } from '../../data/mockData'
import type { NoteOpenIntent } from '../../lib/noteSources'
import { brand } from '../../brand.config'
import { tierAllows } from '../../lib/tiers'
import { STATUS } from '../../theme/status'
import { todayIso, shortDate } from '../../lib/clock'
import {
  buildAttention, dueSoon, customersWaiting, flowCounts,
  type AttentionTarget, type ChipTone,
} from '../../lib/attention'

// ── The home screen: who is waiting for you this morning ────────────────────
//
// Built to the mockup the owner approved (spec/STATUS.md → "מסך הבית"): not tiles
// with numbers but WHO is waiting and, beside each, WHY — every reason a chip that
// opens its own record. Three rules, and every block below keeps them:
//   1. Silent at zero — a block with nothing to say is not rendered at all.
//   2. No invented numbers — every figure is a count of rows or a row's amount.
//   3. Every chip opens the record, never a list.
//
// ⚠️ Rendered in DEMO MODE ONLY for now (Layout decides). The live system keeps
// the old Dashboard until the owner has tried this one.

const BORDER = '#EEEEF2'
const SHADOW = '0 1px 2px rgba(16,17,21,.04), 0 4px 16px rgba(16,17,21,.05)'
const MAX_SUPPLIERS = 5
const MAX_NOTES = 5

const TONE: Record<ChipTone, { bg: string; fg: string; border: string }> = {
  red:    { ...STATUS.red,    border: '#F8C9C9' },
  amber:  { ...STATUS.orange, border: '#F6CFA8' },
  yellow: { ...STATUS.yellow, border: '#EFE1A0' },
  blue:   { ...STATUS.blue,   border: '#BFD5F5' },
  gray:   { ...STATUS.gray,   border: '#E3E4E7' },
}

const ils = (n: number) => '₪' + Math.round(Math.abs(n)).toLocaleString('he-IL')

function greeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return `בוקר טוב ${brand.greetingName}`
  if (hour >= 12 && hour < 17) return `צהריים טובים ${brand.greetingName}`
  if (hour >= 17 && hour < 21) return `ערב טוב ${brand.greetingName}`
  return `לילה טוב ${brand.greetingName}`
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export interface HomeProps {
  alerts:                         Alert[]
  onPageChange:                   (page: string) => void
  onMarkRead?:                    (id: string) => void
  onOpenInvoice:                  (id: string) => void
  onOpenInvoiceDuplicate:         (id: string) => void
  onOpenInvoiceByGmailMessageId?: (msgId: string) => void
  onOpenSupplier:                 (id: string) => void
  onOpenSupplierByName?:          (name: string) => void
  onOpenReturn?:                  (id: string) => void
  onOpenStatement:                (id: string) => void
  onOpenDeliveryNote:             (id: string) => void
  onOpenPayment:                  (id: string) => void
  onCreateSupplierFromAlert?:     (alert: Alert) => void
  /** A note's or a task's way back to its record. */
  onNavigate:                     (intent: NoteOpenIntent) => void
}

// ── Small building blocks ────────────────────────────────────────────────────

function Block({ title, count, children, tone }: {
  title: string; count?: string; children: React.ReactNode; tone?: 'alarm'
}) {
  return (
    <section
      className="bg-white rounded-2xl overflow-hidden"
      style={{ border: `1px solid ${tone === 'alarm' ? '#F6CFCF' : BORDER}`, boxShadow: SHADOW }}
    >
      <header className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid #F1F1F4' }}>
        <h3 className="text-sm font-extrabold" style={{ color: '#1F2125' }}>{title}</h3>
        {count && <span className="text-xs font-bold mr-auto" style={{ color: '#9CA3AF' }}>{count}</span>}
      </header>
      {children}
    </section>
  )
}

function Chip({ tone, children, onClick, title }: {
  tone: ChipTone; children: React.ReactNode; onClick?: () => void; title?: string
}) {
  const t = TONE[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full text-xs font-bold transition-transform hover:-translate-y-px"
      style={{ background: t.bg, color: t.fg, border: `1px solid ${t.border}`, padding: '5px 11px', fontVariantNumeric: 'tabular-nums', cursor: onClick ? 'pointer' : 'default' }}
    >
      {children}
    </button>
  )
}

const rowHover = {
  onMouseEnter: (e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.background = '#FBF7F8'),
  onMouseLeave: (e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.background = 'transparent'),
}

// ── The screen ───────────────────────────────────────────────────────────────

export default function Home(props: HomeProps) {
  const {
    alerts, onPageChange, onMarkRead, onOpenInvoice, onOpenInvoiceDuplicate, onOpenSupplier,
    onOpenStatement, onOpenDeliveryNote, onOpenPayment, onNavigate,
  } = props

  const { data: invoices }   = useInvoices()
  const { data: deliveries } = useDeliveryNotes()
  const { data: payments }   = usePayments()
  const { data: statements } = useStatements()
  const { data: orders }     = useOrders()
  const { notes, markHandled }       = useOpenNotes()
  const { tasks, add: addTask, setDone, remove: removeTask } = useTasks()

  const today = todayIso()
  const scope = {
    payments:   tierAllows('payments'),
    deliveries: tierAllows('deliveries'),
    statements: tierAllows('reconciliation'),
  }

  const { rows, unassigned } = useMemo(
    () => buildAttention({ invoices, deliveries, payments, statements, alerts, today, scope }),
    // scope is three booleans fixed for the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, deliveries, payments, statements, alerts, today],
  )
  const due       = scope.payments   ? dueSoon(payments, today) : []
  const customers = scope.deliveries ? customersWaiting(orders, today) : []
  const flow      = scope.deliveries ? flowCounts(deliveries) : []
  // A note whose record sits on a screen outside the tier cannot be opened, so it
  // is not offered — the same rule as every other pointer on this screen.
  const boardNotes = notes.filter(n => tierAllows(n.open.page))

  const [showAllSuppliers, setShowAllSuppliers] = useState(false)
  const [showAllNotes, setShowAllNotes]         = useState(false)

  const go = (t: AttentionTarget) => {
    switch (t.kind) {
      case 'invoice':   return onOpenInvoice(t.id)
      case 'duplicate': return onOpenInvoiceDuplicate(t.id)
      case 'delivery':  return onOpenDeliveryNote(t.id)
      case 'payment':   return onOpenPayment(t.id)
      case 'statement': return onOpenStatement(t.id)
      case 'approvals': return onPageChange('alerts')
      case 'alert':
        if (t.alert.status === 'new') onMarkRead?.(t.alert.id)
        return resolveAlertDestination(t.alert, { ...props, onOpenDeliveryNote, onOpenStatement })
    }
  }

  const chipCount  = rows.reduce((s, r) => s + r.chips.length, 0)
  const visibleRows = showAllSuppliers ? rows : rows.slice(0, MAX_SUPPLIERS)
  const workEmpty  = !due.length && !rows.length && !unassigned.length
  const taskedKeys = new Set(tasks.map(t => t.fromKey).filter(Boolean))

  return (
    <div className="space-y-4" dir="rtl">
      {/* Greeting + the one action that is always first */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold" style={{ color: '#1A1A2E' }}>{greeting()}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{longDate(today)}</p>
        </div>
        <button
          onClick={() => onPageChange('capture')}
          className="mr-auto flex items-center gap-2 rounded-xl font-bold text-white"
          style={{ minHeight: '44px', padding: '0 20px', background: 'var(--brand-primary)', fontSize: '15px', boxShadow: '0 4px 14px rgba(169,29,58,0.25)' }}
        >
          <Camera className="w-5 h-5" />
          צלמי מסמך
        </button>
      </div>

      {/* Silent at zero, and above everything: a document that never got in is
          the one failure the system cannot report on any other screen. */}
      <ParkedDocuments />

      <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ── The work ───────────────────────────────────────────────────── */}
        <div className="space-y-4 min-w-0">
          {workEmpty && (
            <div className="bg-white rounded-2xl text-center px-6 py-12" style={{ border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
              <p className="text-base font-extrabold" style={{ color: STATUS.green.fg }}>אין מה לטפל הבוקר</p>
              <p className="text-sm text-gray-400 mt-1.5">
                כל המסמכים נכנסו, אין סחורה תקועה ואין תשלום שיורד היום או מחר.<br />
                המסך ריק כי אין מה להראות — לא כי משהו לא נטען.
              </p>
            </div>
          )}

          {due.length > 0 && (
            <Block title="היום ומחר" count={String(due.length)}>
              {due.map(({ payment: p, days }) => (
                <div key={p.id} role="button" tabIndex={0}
                  onClick={() => onOpenPayment(p.id)}
                  onKeyDown={e => { if (e.key === 'Enter') onOpenPayment(p.id) }}
                  className="flex items-center gap-3 px-4 py-3 text-sm cursor-pointer flex-wrap"
                  style={{ borderTop: '1px solid #F5F5F7' }} {...rowHover}
                >
                  <span className="font-bold">{p.supplier}</span>
                  <span className="font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{ils(p.amount)}</span>
                  <span className="text-xs" style={{ color: days < 0 ? STATUS.red.fg : '#9CA3AF', fontWeight: days < 0 ? 700 : 400 }}>
                    {p.type || 'תשלום'} · {days < 0 ? `תאריך הערך עבר — ${shortDate(p.valueDate)}` : days === 0 ? 'תאריך ערך היום' : `תאריך ערך מחר, ${shortDate(p.valueDate)}`}
                  </span>
                  <span className="mr-auto text-xs font-bold" style={{ color: 'var(--brand-primary)' }}>פתחי את התשלום ←</span>
                </div>
              ))}
            </Block>
          )}

          {rows.length > 0 && (
            <Block title="מחכים לך" count={`${chipCount} ${chipCount === 1 ? 'דבר' : 'דברים'} אצל ${rows.length} ${rows.length === 1 ? 'ספק' : 'ספקים'}`}>
              {visibleRows.map(r => (
                <div key={r.supplierId} className="px-4 py-3" style={{ borderTop: '1px solid #F5F5F7' }}>
                  <p className="flex items-center gap-2 mb-2">
                    <button type="button" onClick={() => onOpenSupplier(r.supplierId)}
                      className="text-[15px] font-extrabold hover:underline" style={{ color: '#1F2125' }}>
                      {r.supplierName || 'ספק'}
                    </button>
                    {r.chips.length > 1 && <small className="text-xs text-gray-400">{r.chips.length} דברים</small>}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.chips.map(c => {
                      const label = c.target.kind === 'alert' ? getAlertTypeConf(c.target.alert.type).label : c.label
                      return <Chip key={c.key} tone={c.tone} onClick={() => go(c.target)}>{label}</Chip>
                    })}
                  </div>
                </div>
              ))}
              {rows.length > MAX_SUPPLIERS && (
                <button type="button" onClick={() => setShowAllSuppliers(v => !v)}
                  className="w-full text-right px-4 py-2.5 text-xs font-bold" style={{ borderTop: '1px solid #F5F5F7', color: 'var(--brand-primary)' }}>
                  {showAllSuppliers ? 'פחות ↑' : `עוד ${rows.length - MAX_SUPPLIERS} ספקים ←`}
                </button>
              )}
            </Block>
          )}

          {unassigned.length > 0 && (
            <Block title="ללא שיוך לספק" count={String(unassigned.length)}>
              {unassigned.map(u => (
                <div key={u.key} role="button" tabIndex={0}
                  onClick={() => go(u.target)}
                  onKeyDown={e => { if (e.key === 'Enter') go(u.target) }}
                  className="flex items-center gap-3 px-4 py-3 text-sm cursor-pointer flex-wrap"
                  style={{ borderTop: '1px solid #F5F5F7' }} {...rowHover}
                >
                  <span className="font-bold">{u.title}</span>
                  <span className="text-xs text-gray-400">{u.meta}</span>
                  <span className="mr-auto text-xs font-bold" style={{ color: 'var(--brand-primary)' }}>{u.action}</span>
                </div>
              ))}
            </Block>
          )}

          {/* NOT a pie: the stages are a sequence, and one bar in the pipeline's
              own order says it in the system's own words. */}
          {flow.length > 0 && (
            <Block title="הסחורה שבדרך" count={`${flow.reduce((s, f) => s + f.count, 0)} שורות פתוחות`}>
              <div className="px-4 py-3">
                <button type="button" onClick={() => onPageChange('deliveries')}
                  className="flex w-full overflow-hidden rounded-md" style={{ height: '26px' }} title="פתיחת מעקב הסחורה">
                  {flow.map(f => (
                    <span key={f.stage} className="grid place-items-center text-[11.5px] font-extrabold text-white"
                      style={{ flex: f.count, background: f.color }}>{f.count}</span>
                  ))}
                </button>
                <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ color: '#6B6E73' }}>
                  {flow.map(f => (
                    <span key={f.stage} className="inline-flex items-center gap-1.5">
                      <i className="inline-block rounded-sm" style={{ width: 9, height: 9, background: f.color }} />
                      {f.label} · {f.count}
                    </span>
                  ))}
                </div>
              </div>
            </Block>
          )}
        </div>

        {/* ── The side: what she decided, what was said, who is waiting ─────── */}
        {/* A div, not an <aside>: the app's sidebar is THE aside, and the E2E
            walkthrough finds it by that tag. */}
        <div className="space-y-4 min-w-0">
          <TasksBlock
            tasks={tasks}
            onAdd={body => addTask({ body })}
            onToggle={setDone}
            onRemove={removeTask}
            onNavigate={intent => tierAllows(intent.page) && onNavigate(intent)}
          />

          {boardNotes.length > 0 && (
            <Block title="לוח ההערות" count={`${boardNotes.length} פתוחות`}>
              {(showAllNotes ? boardNotes : boardNotes.slice(0, MAX_NOTES)).map(n => (
                <NoteItem key={n.key} note={n}
                  tasked={taskedKeys.has(n.key)}
                  onOpen={() => onNavigate(n.open)}
                  onOpenSupplier={() => onOpenSupplier(n.supplierId)}
                  onHandled={() => markHandled(n)}
                  onToTask={() => addTask({
                    body: n.body,
                    fromLabel: `נוצרה מהערה · ${n.supplierName || 'ספק'}${n.date ? ` · ${shortDate(n.date)}` : ''}`,
                    fromIntent: n.open,
                    fromKey: n.key,
                  })}
                />
              ))}
              {boardNotes.length > MAX_NOTES && (
                <button type="button" onClick={() => setShowAllNotes(v => !v)}
                  className="w-full text-right px-4 py-2.5 text-xs font-bold" style={{ borderTop: '1px solid #F5F5F7', color: 'var(--brand-primary)' }}>
                  {showAllNotes ? 'פחות ↑' : `עוד ${boardNotes.length - MAX_NOTES} הערות ←`}
                </button>
              )}
            </Block>
          )}

          {customers.length > 0 && (
            <Block title="לקוחות שמחכות" count={String(customers.length)}>
              {customers.map(({ order: o, state, days }) => (
                <div key={o.id} role="button" tabIndex={0}
                  onClick={() => o.deliveryNoteId ? onOpenDeliveryNote(o.deliveryNoteId) : onPageChange('deliveries')}
                  onKeyDown={e => { if (e.key === 'Enter') { if (o.deliveryNoteId) onOpenDeliveryNote(o.deliveryNoteId); else onPageChange('deliveries') } }}
                  className="px-4 py-3 grid gap-1 cursor-pointer" style={{ borderTop: '1px solid #F5F5F7' }} {...rowHover}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold">{o.customerName}</span>
                    <span className="mr-auto rounded-full text-[11px] font-bold px-2 py-0.5"
                      style={state === 'arrived' ? { background: STATUS.green.bg, color: STATUS.green.fg } : { background: STATUS.orange.bg, color: STATUS.orange.fg }}>
                      {state === 'arrived' ? 'הגיע לחנות' : 'טרם הגיע'}
                    </span>
                  </div>
                  <div className="text-[13px]" style={{ color: '#3F4147' }}>{o.supplierName} · {o.description}</div>
                  <div className="text-[11.5px] text-gray-400">
                    {state === 'arrived'
                      ? <>הגיע {shortDate(o.arrivedAt)} · <b style={{ color: STATUS.orange.fg }}>{days === 0 ? 'היום, עוד לא נמסרה הודעה' : `${days} ימים בלי שנמסרה הודעה`}</b></>
                      : <>הוזמן {shortDate(o.isoDate)} · <b style={{ color: STATUS.orange.fg }}>{days} ימים</b></>}
                  </div>
                </div>
              ))}
            </Block>
          )}
        </div>
      </div>
    </div>
  )
}

// ── The noticeboard line ─────────────────────────────────────────────────────

function NoteItem({ note, tasked, onOpen, onOpenSupplier, onHandled, onToTask }: {
  note: OpenNote; tasked: boolean
  onOpen: () => void; onOpenSupplier: () => void; onHandled: () => void; onToTask: () => void
}) {
  const pill = 'inline-flex items-center gap-1 rounded-full text-[10.5px] font-extrabold px-2 py-0.5 transition-colors'
  return (
    <div className="px-4 py-3 grid gap-1.5" style={{ borderTop: '1px solid #F5F5F7' }}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onOpenSupplier} className="text-[13.5px] font-extrabold hover:underline truncate">
          {note.supplierName || 'ספק'}
        </button>
        <button type="button" onClick={onToTask} disabled={tasked}
          title={tasked ? 'כבר ברשימת המשימות' : 'להכניס לרשימת המשימות שלי'}
          className={`${pill} mr-auto`}
          style={{ border: '1px solid #E8E6EA', color: tasked ? '#C4C4CC' : '#9CA3AF', cursor: tasked ? 'default' : 'pointer' }}
          onMouseEnter={e => { if (!tasked) { e.currentTarget.style.borderColor = 'var(--brand-primary)'; e.currentTarget.style.color = 'var(--brand-primary)' } }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E8E6EA'; e.currentTarget.style.color = tasked ? '#C4C4CC' : '#9CA3AF' }}
        >
          {tasked ? '✓ משימה' : '→ משימה'}
        </button>
        <button type="button" onClick={onHandled} title="סימון שטופל — מוריד את ההערה מהלוח ומהפאנל"
          className={pill}
          style={{ border: '1px solid #E8E6EA', color: '#9CA3AF' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#86EFAC'; e.currentTarget.style.color = STATUS.green.fg; e.currentTarget.style.background = STATUS.green.bg }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E8E6EA'; e.currentTarget.style.color = '#9CA3AF'; e.currentTarget.style.background = 'transparent' }}
        >
          <Check className="w-3 h-3" /> טופל
        </button>
      </div>
      <button type="button" onClick={onOpen} className="text-right text-[13px] leading-relaxed hover:underline" style={{ color: '#3F4147' }}>
        {note.body}
      </button>
      <div className="flex items-center gap-2 text-[11.5px] text-gray-400">
        <span className="rounded-full px-1.5 font-bold" style={{ background: note.style.bg, color: note.style.fg }}>{note.label}</span>
        {note.date ? shortDate(note.date) : 'ללא תאריך'}
      </div>
    </div>
  )
}

// ── Her tasks ────────────────────────────────────────────────────────────────

function TasksBlock({ tasks, onAdd, onToggle, onRemove, onNavigate }: {
  tasks: ReturnType<typeof useTasks>['tasks']
  onAdd: (body: string) => Promise<void>
  onToggle: (id: string, done: boolean) => void
  onRemove: (id: string) => void
  onNavigate: (intent: NoteOpenIntent) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft]   = useState('')
  // Open first, done after — a finished task stays visible (struck through) so
  // the click is seen to have landed, but it no longer competes for attention.
  const ordered = [...tasks.filter(t => !t.done), ...tasks.filter(t => t.done)]
  const open = tasks.filter(t => !t.done).length

  const save = async () => {
    if (!draft.trim()) { setAdding(false); return }
    await onAdd(draft)
    setDraft('')
    setAdding(false)
  }

  return (
    <Block title="המשימות שלי" count={open ? String(open) : undefined}>
      {ordered.length === 0 && !adding && (
        <p className="px-4 py-4 text-xs text-gray-400 text-center">אין משימות פתוחות. "→ משימה" על הערה מוסיף אחת לכאן.</p>
      )}
      {ordered.map(t => (
        <div key={t.id} className="group flex gap-2.5 items-start px-4 py-2.5" style={{ borderTop: '1px solid #F5F5F7' }}>
          <input type="checkbox" checked={t.done} onChange={e => onToggle(t.id, e.target.checked)}
            className="mt-1 w-[15px] h-[15px] flex-shrink-0 cursor-pointer" style={{ accentColor: 'var(--brand-primary)' }}
            aria-label={t.done ? 'סימון כלא בוצע' : 'סימון כבוצע'} />
          <div className="min-w-0 flex-1">
            <span className="text-[13px] leading-snug" style={t.done ? { textDecoration: 'line-through', color: '#9CA3AF' } : undefined}>{t.body}</span>
            {t.fromLabel && (
              t.fromIntent
                ? <button type="button" onClick={() => onNavigate(t.fromIntent!)}
                    className="block text-[11px] text-gray-400 mt-0.5 hover:underline text-right">{t.fromLabel} <ArrowLeft className="inline w-3 h-3" /></button>
                : <span className="block text-[11px] text-gray-400 mt-0.5">{t.fromLabel}</span>
            )}
          </div>
          <button type="button" onClick={() => onRemove(t.id)} title="מחיקת המשימה"
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-300 hover:text-gray-500 transition-opacity">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      {adding ? (
        <div className="px-4 py-2.5 flex gap-2" style={{ borderTop: '1px solid #F5F5F7' }}>
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { setDraft(''); setAdding(false) } }}
            placeholder="מה צריך לעשות?"
            className="flex-1 min-w-0 text-[13px] rounded-lg px-2.5 py-1.5 outline-none"
            style={{ border: '1px solid #E4E5EA' }} />
          <button type="button" onClick={() => void save()}
            className="text-xs font-bold text-white rounded-lg px-3" style={{ background: 'var(--brand-primary)' }}>הוספה</button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="w-full text-right px-4 py-2.5 text-[12.5px] font-bold" style={{ borderTop: '1px solid #F5F5F7', color: 'var(--brand-primary)' }}>
          + משימה חדשה
        </button>
      )}
    </Block>
  )
}
