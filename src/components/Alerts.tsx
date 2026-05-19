import { useState } from 'react'
import { Truck, Copy, Scale, Check, Eye, Trash2, Bell, UserPlus } from 'lucide-react'
import type { Alert, AlertType, AlertStatus } from '../data/mockData'

const TYPE_CONFIG: Record<AlertType, {
  label: string
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  bg: string
  color: string
  border: string
}> = {
  duplicate_invoice: {
    label: 'כפילות חשבונית',
    Icon: Copy,
    bg: '#FEF3C7',
    color: '#D97706',
    border: '#FDE68A',
  },
  delivery_note: {
    label: 'תעודת משלוח',
    Icon: Truck,
    bg: '#DBEAFE',
    color: '#1E40AF',
    border: '#BFDBFE',
  },
  statement_mismatch: {
    label: 'אי-התאמת כרטסת',
    Icon: Scale,
    bg: '#FEE2E2',
    color: '#DC2626',
    border: '#FECACA',
  },
  supplier_not_found: {
    label: 'ספק לא זוהה',
    Icon: UserPlus,
    bg: '#F5F3FF',
    color: '#7C3AED',
    border: '#DDD6FE',
  },
}

const STATUS_CONFIG: Record<AlertStatus, {
  label: string
  bg: string
  color: string
  indicator: string
}> = {
  new:      { label: 'חדש',  bg: '#FEE2E2', color: '#DC2626', indicator: '#EF4444' },
  read:     { label: 'נקרא', bg: '#F3F4F6', color: '#6B7280', indicator: '#D1D5DB' },
  resolved: { label: 'טופל', bg: '#DCFCE7', color: '#166534', indicator: '#22C55E' },
}

const TYPE_LABELS: Record<AlertType, string> = {
  duplicate_invoice:  'כפילות חשבונית',
  delivery_note:      'תעודת משלוח',
  statement_mismatch: 'אי-התאמת כרטסת',
  supplier_not_found: 'ספק לא זוהה',
}

const STATUS_LABELS: Record<AlertStatus, string> = {
  new:      'חדש',
  read:     'נקרא',
  resolved: 'טופל',
}

interface AlertCardProps {
  alert: Alert
  onMarkRead: (id: string) => void
  onMarkResolved: (id: string) => void
  onDelete: (id: string) => void
  onCreateSupplierFromAlert?: (alert: Alert) => void
}

function AlertCard({ alert, onMarkRead, onMarkResolved, onDelete, onCreateSupplierFromAlert }: AlertCardProps) {
  const typeConf   = TYPE_CONFIG[alert.type]
  const statusConf = STATUS_CONFIG[alert.status]
  const TypeIcon   = typeConf.Icon
  const isResolved = alert.status === 'resolved'

  return (
    <div
      className="bg-white rounded-2xl shadow-sm border overflow-hidden transition-opacity"
      style={{
        borderColor: '#E2E4E9',
        borderRight: `4px solid ${statusConf.indicator}`,
        opacity: isResolved ? 0.72 : 1,
      }}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-2.5">
          {/* Right: type icon + badge */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: typeConf.bg }}
            >
              <TypeIcon className="w-4 h-4" style={{ color: typeConf.color }} />
            </div>
            <span
              className="px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap"
              style={{ background: typeConf.bg, color: typeConf.color }}
            >
              {typeConf.label}
            </span>
          </div>

          {/* Left: supplier + date + status */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {alert.supplier && (
              <span className="text-sm font-semibold text-gray-700">{alert.supplier}</span>
            )}
            <span className="text-xs text-gray-400">{alert.date}</span>
            <span
              className="px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap"
              style={{ background: statusConf.bg, color: statusConf.color }}
            >
              {statusConf.label}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-gray-600 leading-relaxed text-right mb-3">
          {alert.description}
        </p>

        {/* Actions */}
        {!isResolved && (
          <div className="flex items-center gap-2 flex-wrap">
            {alert.type === 'supplier_not_found' && onCreateSupplierFromAlert && (
              <button
                onClick={() => onCreateSupplierFromAlert(alert)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: '#F5F3FF', color: '#7C3AED' }}
              >
                <UserPlus className="w-3 h-3" />
                צור ספק
              </button>
            )}
            {alert.status === 'new' && (
              <button
                onClick={() => onMarkRead(alert.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: '#F3F4F6', color: '#374151' }}
              >
                <Eye className="w-3 h-3" />
                סמן כנקרא
              </button>
            )}
            <button
              onClick={() => onMarkResolved(alert.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ background: '#DCFCE7', color: '#166534' }}
            >
              <Check className="w-3 h-3" />
              סמן כטופל
            </button>
            <button
              onClick={() => onDelete(alert.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ background: '#FEE2E2', color: '#DC2626' }}
            >
              <Trash2 className="w-3 h-3" />
              מחק
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

type TypeFilter   = 'all' | AlertType
type StatusFilter = 'all' | AlertStatus

interface AlertsProps {
  alerts: Alert[]
  onMarkRead: (id: string) => void
  onMarkResolved: (id: string) => void
  onDelete: (id: string) => void
  onCreateSupplierFromAlert?: (alert: Alert) => void
}

export default function Alerts({ alerts, onMarkRead, onMarkResolved, onDelete, onCreateSupplierFromAlert }: AlertsProps) {
  const [typeFilter,   setTypeFilter]   = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const newCount      = alerts.filter(a => a.status === 'new').length
  const readCount     = alerts.filter(a => a.status === 'read').length
  const resolvedCount = alerts.filter(a => a.status === 'resolved').length

  const filtered = alerts.filter(a => {
    if (typeFilter   !== 'all' && a.type   !== typeFilter)   return false
    if (statusFilter !== 'all' && a.status !== statusFilter) return false
    return true
  })

  const filterBtn = (
    active: boolean,
    label: string,
    onClick: () => void,
    activeColor = '#8B1A3A',
  ) => (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-xl text-sm font-semibold transition-all"
      style={{
        background: active ? activeColor : 'white',
        color: active ? 'white' : '#6B7280',
        border: `1.5px solid ${active ? activeColor : '#E2E4E9'}`,
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-black text-gray-800">התראות מערכת</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          מעקב אחר חריגים והתראות הדורשים טיפול
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { value: newCount,      label: 'חדשות',  bg: '#FEE2E2', color: '#DC2626', iconBg: '#FCA5A5' },
          { value: readCount,     label: 'נקראו',  bg: '#F3F4F6', color: '#6B7280', iconBg: '#D1D5DB' },
          { value: resolvedCount, label: 'טופלו',  bg: '#DCFCE7', color: '#166534', iconBg: '#86EFAC' },
        ].map(({ value, label, bg, color, iconBg }) => (
          <div
            key={label}
            className="bg-white rounded-2xl p-4 shadow-sm border flex items-center gap-3"
            style={{ borderColor: '#E2E4E9' }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: bg }}
            >
              <Bell className="w-4 h-4" style={{ color: iconBg }} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-black" style={{ color }}>{value}</p>
              <p className="text-xs text-gray-500 font-medium">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border space-y-3" style={{ borderColor: '#E2E4E9' }}>
        {/* Type filter */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="text-xs font-semibold text-gray-400 ml-1">סוג:</span>
          {filterBtn(typeFilter === 'all', 'הכל', () => setTypeFilter('all'))}
          {(Object.keys(TYPE_LABELS) as AlertType[]).map(t =>
            filterBtn(typeFilter === t, TYPE_LABELS[t], () => setTypeFilter(t))
          )}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className="text-xs font-semibold text-gray-400 ml-1">סטטוס:</span>
          {filterBtn(statusFilter === 'all', 'הכל', () => setStatusFilter('all'))}
          {(Object.keys(STATUS_LABELS) as AlertStatus[]).map(s =>
            filterBtn(
              statusFilter === s,
              STATUS_LABELS[s],
              () => setStatusFilter(s),
              STATUS_CONFIG[s].indicator,
            )
          )}
        </div>
      </div>

      {/* Alert list */}
      {filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-2xl bg-white border shadow-sm"
          style={{ borderColor: '#E2E4E9', minHeight: '220px' }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: '#F3F4F6' }}
          >
            <Bell className="w-6 h-6 text-gray-300" />
          </div>
          <p className="font-bold text-gray-500 text-sm">אין התראות תואמות לסינון הנבחר</p>
          <p className="text-xs text-gray-400 mt-1">שנה את הסינון כדי לראות התראות נוספות</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400 text-right font-medium">
            מציג {filtered.length} מתוך {alerts.length} התראות
          </p>
          {filtered.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onMarkRead={onMarkRead}
              onMarkResolved={onMarkResolved}
              onDelete={onDelete}
              onCreateSupplierFromAlert={onCreateSupplierFromAlert}
            />
          ))}
        </div>
      )}
    </div>
  )
}
