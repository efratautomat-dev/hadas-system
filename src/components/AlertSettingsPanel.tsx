import { useEffect, useState } from 'react'
import {
  ALERT_SETTING_GROUPS, DEFAULT_DISABLED, loadDisabledAlertTypes, saveDisabledAlertTypes,
  type AlertSettingRow,
} from '../lib/alertPrefs'
import { notify } from '../lib/dataBus'

// Settings → התראות, per the approved mockup (19.10): every alert type the system
// can raise, grouped by the same buckets as the alerts screen, each with a switch.
// Manager-only by construction — Settings is a manager screen, and employees
// have no alerts at all.
//
// Nothing is applied until "שמירה": she can flip several switches, look, and
// change her mind. The filter itself lives in useAlerts, not here.

const GROUP_PALETTE = {
  urgent: { bg: '#FEE2E2', fg: '#B91C1C' },
  action: { bg: '#FFEDD5', fg: '#C2410C' },
  check:  { bg: '#FEF3C7', fg: '#92400E' },
  info:   { bg: '#F3F4F6', fg: '#4B5563' },
} as const

const isOn = (row: AlertSettingRow, disabled: Set<string>) => !row.types.some(t => disabled.has(t))

export default function AlertSettingsPanel() {
  const [disabled, setDisabled] = useState<Set<string> | null>(null)
  const [saved, setSaved]       = useState<string>('')
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    void loadDisabledAlertTypes().then(d => {
      if (!alive) return
      setDisabled(d)
      setSaved(JSON.stringify([...d].sort()))
    })
    return () => { alive = false }
  }, [])

  if (!disabled) {
    return <div className="text-sm text-gray-400 text-right p-6">טוען…</div>
  }

  const dirty = JSON.stringify([...disabled].sort()) !== saved

  function toggle(row: AlertSettingRow) {
    setMsg(null)
    setDisabled(prev => {
      const next = new Set(prev)
      if (isOn(row, next)) row.types.forEach(t => next.add(t))
      else row.types.forEach(t => next.delete(t))
      return next
    })
  }

  async function save() {
    if (!disabled) return
    setBusy(true)
    try {
      await saveDisabledAlertTypes(disabled)
      setSaved(JSON.stringify([...disabled].sort()))
      // The feed, the badge and the alerts screen all read through useAlerts —
      // tell it to re-read, so the change shows without a reload.
      notify(['alerts'])
      setMsg({ type: 'success', text: 'נשמר ✓' })
    } catch {
      setMsg({ type: 'error', text: 'השמירה נכשלה — נסי שוב' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="bg-white rounded-2xl border text-right" style={{ borderColor: '#EEEEF2', padding: '14px 18px', fontSize: '14px', color: '#4B5563', lineHeight: 1.6, flex: '1 1 420px' }}>
          כל סוגי ההתראות שהמערכת יודעת לשלוח.{' '}
          <b style={{ color: '#1F2937' }}>התראה כבויה לא מוצגת ולא נספרת</b>
          {' '}— לא בפעמון, לא בדשבורד ולא במסך ההתראות. אפשר להדליק אותה שוב בכל רגע, וההתראות שלה יחזרו.
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setMsg(null); setDisabled(new Set(DEFAULT_DISABLED)) }}
            className="rounded-xl font-semibold"
            style={{ fontSize: '13px', padding: '9px 14px', border: '1.5px solid #DEDFE5', background: 'white', color: '#374151', cursor: 'pointer' }}
          >החזרה לברירת מחדל</button>
          <button
            onClick={() => void save()}
            disabled={!dirty || busy}
            className="rounded-xl font-bold"
            style={{
              fontSize: '13px', padding: '9px 18px', border: 'none',
              background: dirty && !busy ? 'var(--brand-primary)' : '#F3F4F6',
              color: dirty && !busy ? 'white' : '#9CA3AF',
              cursor: dirty && !busy ? 'pointer' : 'not-allowed',
            }}
          >{busy ? 'שומר…' : 'שמירה'}</button>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl p-3 text-sm text-right" style={msg.type === 'success'
          ? { background: '#DCFCE7', color: '#166534' }
          : { background: '#FEE2E2', color: '#B91C1C' }}>{msg.text}</div>
      )}

      {ALERT_SETTING_GROUPS.map(g => {
        const pal = GROUP_PALETTE[g.bucket]
        const onCount = g.rows.filter(r => isOn(r, disabled)).length
        return (
          <div key={g.bucket} className="bg-white border overflow-hidden" style={{ borderColor: '#EEEEF2', borderRadius: '18px' }}>
            <div className="flex items-center gap-2.5 flex-wrap" style={{ padding: '12px 18px', borderBottom: '1px solid #EEEEF2', background: '#FCFCFD' }}>
              <span className="font-bold" style={{ fontSize: '13px', padding: '3px 10px', borderRadius: '8px', background: pal.bg, color: pal.fg }}>{g.title}</span>
              <span style={{ fontSize: '13px', color: '#6B7280' }}>{g.sub}</span>
              <span style={{ marginInlineStart: 'auto', fontSize: '12.5px', color: '#6B7280' }}>{onCount} מתוך {g.rows.length} פעילות</span>
            </div>
            {g.rows.map(row => {
              const on = isOn(row, disabled)
              return (
                <div key={row.types[0]} className="flex items-center gap-4" style={{ padding: '12px 18px', borderBottom: '1px solid #F3F4F6' }}>
                  <div className="flex-1 min-w-0 text-right">
                    <div className="font-semibold" style={{ fontSize: '14.5px', color: on ? '#1F2937' : '#9CA3AF' }}>{row.label}</div>
                    <div style={{ fontSize: '12.5px', color: '#6B7280', marginTop: '2px', lineHeight: 1.5 }}>{row.desc}</div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={on}
                    aria-label={`${row.label} — ${on ? 'פעילה' : 'כבויה'}`}
                    onClick={() => toggle(row)}
                    className="relative flex-shrink-0 rounded-full transition-all duration-200"
                    style={{ width: '48px', height: '26px', border: 'none', padding: 0, cursor: 'pointer', background: on ? 'var(--brand-primary)' : '#D1D5DB' }}
                  >
                    <span
                      className="absolute rounded-full bg-white shadow transition-all duration-200"
                      style={{ top: '4px', width: '18px', height: '18px', right: on ? '4px' : 'calc(100% - 22px)' }}
                    />
                  </button>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
