import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ChevronDown, X, Plus } from 'lucide-react'

// ── Shared searchable combobox ───────────────────────────────────────────────
// A drop-in replacement for a native <select> when the option list is long
// (e.g. 81 suppliers). The user types to filter; the list narrows live.
// RTL/Hebrew first, keyboard-navigable, no external dependency.
//
// Generic on purpose: callers pass plain {value,label,keywords} options, so the
// same component works whether the stored value is an id (most places) or a
// name string (Payments). `keywords` is extra text to match against — we use it
// to make a supplier findable by its ח.פ number as well as its name.

export interface SearchableOption {
  value: string
  label: string
  /** Extra text to match typed queries against (not displayed), e.g. ח.פ. */
  keywords?: string
  /**
   * A status dot rendered BEFORE the label — a colour and a short note.
   *
   * The point of putting it here rather than in a list below is the moment: the
   * question "does this supplier need me?" is asked while choosing, so the answer
   * belongs inside the choosing. Optional, so every other caller is unaffected.
   */
  dot?: { color: string; title?: string }
}

export interface SearchableSelectProps {
  value: string
  onChange: (value: string) => void
  options: SearchableOption[]
  placeholder?: string
  /** Show a "clear selection" affordance; clearing emits `clearValue`. */
  allowClear?: boolean
  /** Value emitted when cleared (filters that use 'all' can override ''). */
  clearValue?: string
  /** When set, an "add new" row appears for unmatched queries. */
  onAddNew?: (name: string) => void
  /** Label template for the add-new row; receives the typed text. */
  addNewLabel?: (query: string) => string
  disabled?: boolean
  /** Field style overrides (width, height) to match each call site. */
  style?: React.CSSProperties
}

const ACCENT = 'var(--brand-primary)'
const BORDER = '#DEDFE5'

const FIELD: React.CSSProperties = {
  border: `1.5px solid ${BORDER}`,
  borderRadius: '10px',
  padding: '9px 13px',
  fontSize: '15px',
  textAlign: 'right',
  direction: 'rtl',
  background: 'white',
  width: '100%',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  cursor: 'pointer',
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '-- בחר --',
  allowClear = false,
  clearValue = '',
  onAddNew,
  addNewLabel = q => `הוסף "${q}"`,
  disabled = false,
  style,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => options.find(o => o.value === value),
    [options, value],
  )

  // Filter by label + keywords (case-insensitive substring). Empty query = all.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      o =>
        o.label.toLowerCase().includes(q) ||
        (o.keywords ?? '').toLowerCase().includes(q),
    )
  }, [options, query])

  // Whether to offer "add new" — only when nothing matches the typed text exactly.
  const trimmed = query.trim()
  const showAddNew =
    !!onAddNew &&
    trimmed.length > 0 &&
    !options.some(o => o.label.toLowerCase() === trimmed.toLowerCase())

  // Total selectable rows (options + optional add-new), for highlight clamping.
  const rowCount = filtered.length + (showAddNew ? 1 : 0)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const commit = useCallback(
    (v: string) => {
      onChange(v)
      close()
    },
    [onChange, close],
  )

  // Click outside closes (and discards the in-progress query).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, close])

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-row="${highlight}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const openMenu = () => {
    if (disabled) return
    setOpen(true)
    setHighlight(0)
    // focus the text input on next tick so typing starts immediately
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) return openMenu()
      setHighlight(h => Math.min(h + 1, rowCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!open) return openMenu()
      if (showAddNew && highlight === filtered.length) {
        onAddNew!(trimmed)
        close()
      } else if (filtered[highlight]) {
        commit(filtered[highlight].value)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      {/* Closed field: shows selection (or placeholder); opens on click/focus. */}
      <div
        role="combobox"
        aria-expanded={open}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={openMenu}
        onFocus={openMenu}
        onKeyDown={onKeyDown}
        style={{
          ...FIELD,
          ...style,
          borderColor: open ? ACCENT : BORDER,
          display: open ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          color: selected ? '#1A1D23' : '#9CA3AF',
          background: disabled ? '#F8F8FA' : 'white',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {allowClear && selected && (
            <X
              size={15}
              color="#9CA3AF"
              onClick={e => {
                e.stopPropagation()
                onChange(clearValue)
              }}
            />
          )}
          <ChevronDown size={16} color="#9CA3AF" />
        </span>
      </div>

      {/* Open: search input + filtered list. */}
      {open && (
        <>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setHighlight(0) }}
            onKeyDown={onKeyDown}
            placeholder={selected ? selected.label : placeholder}
            style={{ ...FIELD, ...style, borderColor: ACCENT, cursor: 'text' }}
          />
          <div
            ref={listRef}
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              insetInlineStart: 0,
              width: '100%',
              maxHeight: '260px',
              overflowY: 'auto',
              background: 'white',
              border: `1px solid ${BORDER}`,
              borderRadius: '10px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
              zIndex: 50,
              direction: 'rtl',
              padding: '4px',
            }}
          >
            {filtered.length === 0 && !showAddNew && (
              <div style={{ padding: '10px 12px', fontSize: '14px', color: '#9CA3AF', textAlign: 'right' }}>
                לא נמצאו תוצאות
              </div>
            )}

            {filtered.map((o, i) => (
              <div
                key={o.value}
                data-row={i}
                onMouseDown={e => {
                  e.preventDefault()
                  commit(o.value)
                }}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  padding: '9px 12px',
                  fontSize: '15px',
                  textAlign: 'right',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  background: highlight === i ? '#FCE9ED' : 'transparent',
                  color: o.value === value ? ACCENT : '#1A1D23',
                  fontWeight: o.value === value ? 600 : 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {o.dot ? (
                  <span className="inline-flex items-center gap-2" title={o.dot.title}>
                    <i
                      aria-hidden="true"
                      style={{
                        width: 8, height: 8, borderRadius: 999,
                        background: o.dot.color, flex: 'none', display: 'inline-block',
                      }}
                    />
                    {o.label}
                    {o.dot.title && (
                      <small style={{ color: '#9CA3AF', fontSize: '12px', fontWeight: 400 }}>
                        {o.dot.title}
                      </small>
                    )}
                  </span>
                ) : o.label}
              </div>
            ))}

            {showAddNew && (
              <div
                data-row={filtered.length}
                onMouseDown={e => {
                  e.preventDefault()
                  onAddNew!(trimmed)
                  close()
                }}
                onMouseEnter={() => setHighlight(filtered.length)}
                style={{
                  padding: '9px 12px',
                  fontSize: '15px',
                  textAlign: 'right',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '6px',
                  background: highlight === filtered.length ? '#FCE9ED' : 'transparent',
                  color: 'var(--brand-primary-dark)',
                  fontWeight: 600,
                  borderTop: filtered.length > 0 ? `1px solid ${BORDER}` : undefined,
                  marginTop: filtered.length > 0 ? '4px' : undefined,
                }}
              >
                {addNewLabel(trimmed)}
                <Plus size={15} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
