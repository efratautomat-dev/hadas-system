// The form primitives behind the Settings screens (categories, employees, app
// settings) — a calm centered column of white cards with a titled header strip.
//
// Extracted here so the SUPPLIER form can use the very same components rather
// than a look-alike: the owner asked for the supplier form to look like the
// category form, and a copy would drift the moment either side is restyled.

import React from 'react'

/** A white card with an optional title strip. The building block of a form column. */
export function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border" style={{ borderColor: '#E2E4E9' }}>
      {title && (
        <div className="px-6 py-4 border-b" style={{ borderColor: '#E2E4E9' }}>
          <h3 className="font-bold text-gray-700 text-base">{title}</h3>
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  )
}

export function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-semibold text-gray-600 mb-1.5">
      {children}
      {required && <span style={{ color: 'var(--brand-primary)' }}> *</span>}
    </label>
  )
}

const FIELD_BORDER = '#E2E4E9'
const FIELD_FOCUS  = '#E8645A'

// Shared by TextInput / Select / Textarea so all three focus identically.
const fieldStyle = (disabled?: boolean): React.CSSProperties => ({
  borderColor: FIELD_BORDER,
  padding: '10px 14px',
  background: disabled ? '#F8F9FA' : 'white',
  color: disabled ? '#9CA3AF' : undefined,
})

const fieldClass = 'w-full rounded-xl border text-sm text-gray-800 outline-none transition-all'

function focusOn(e: React.FocusEvent<HTMLElement>, disabled?: boolean) {
  if (!disabled) e.target.style.borderColor = FIELD_FOCUS
}
function focusOff(e: React.FocusEvent<HTMLElement>) {
  e.target.style.borderColor = FIELD_BORDER
}


/**
 * Props for a native date field that shows OUR `DD/MM/YYYY` placeholder while it
 * is empty. An empty `type="date"` paints a placeholder the browser owns and
 * localises to its UI language — a Hebrew Chrome renders the month as `מ"מ` — and
 * neither CSS nor a `lang` attribute overrides it (verified). Swapping to a text
 * box while empty is the only reliable way to show day-first Latin text; focus
 * restores the real date input, so the picker and validation are untouched.
 *
 * Spread onto any date input:
 *   const d = useDateField(value)
 *   <input {...d} value={value} onChange={...} />
 */
export function useDateField(value: string) {
  const [focused, setFocused] = React.useState(false)
  const empty = !value && !focused
  return {
    type: empty ? 'text' : 'date',
    placeholder: 'DD/MM/YYYY',
    dir: 'ltr' as const,
    onFocus: () => setFocused(true),
    onBlur:  () => setFocused(false),
  }
}


/**
 * Drop-in replacement for `<input type="date">` that shows a day-first
 * `DD/MM/YYYY` placeholder while empty. Takes any input props (style, required,
 * onFocus/onBlur…) so an existing raw date input can be swapped one-for-one.
 * A COMPONENT rather than a bare hook so each call site keeps its own state
 * without the caller having to add a hook call at the top of its component.
 */
export function DateField({
  value, onChange, onFocus, onBlur, ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const d = useDateField(value)
  return (
    <input
      {...rest}
      type={d.type}
      placeholder={d.placeholder}
      dir={d.dir}
      value={value}
      onChange={onChange}
      onFocus={e => { d.onFocus(); onFocus?.(e) }}
      onBlur={e => { d.onBlur(); onBlur?.(e) }}
    />
  )
}

export function TextInput({
  value, onChange, placeholder, type = 'text', disabled, dir, step,
}: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
  /** 'ltr' for numbers, ids, email and phone — they read left-to-right inside the RTL form. */
  dir?: 'rtl' | 'ltr'
  step?: string
}) {
  // An EMPTY `type="date"` paints a placeholder the browser owns and localises to
  // its own UI language — a Hebrew Chrome shows `מ"מ` for the month, and no CSS or
  // `lang` attribute can override it (verified: `lang` on the input changes
  // nothing). So while the field is empty it is a plain text box showing our own
  // `DD/MM/YYYY` — day-first, the Israeli order — and it becomes a real date input
  // on focus so the native picker and validation are still there.
  const isDate = type === 'date'
  const [dateFocused, setDateFocused] = React.useState(false)
  const effectiveType = isDate && !value && !dateFocused ? 'text' : type

  return (
    <input
      type={effectiveType}
      step={step}
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={isDate ? 'DD/MM/YYYY' : placeholder}
      disabled={disabled}
      dir={isDate ? 'ltr' : dir}
      className={`${fieldClass} ${dir === 'ltr' || isDate ? 'text-left' : 'text-right'} placeholder-gray-300`}
      style={fieldStyle(disabled)}
      onFocus={e => { if (isDate) setDateFocused(true); focusOn(e, disabled) }}
      onBlur={e => { if (isDate) setDateFocused(false); focusOff(e) }}
    />
  )
}

export function Select({
  value, onChange, options, disabled,
}: {
  value: string
  onChange?: (v: string) => void
  options: string[]
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={e => onChange?.(e.target.value)}
      disabled={disabled}
      className={`${fieldClass} text-right`}
      style={{ ...fieldStyle(disabled), direction: 'rtl', cursor: disabled ? 'default' : 'pointer' }}
      onFocus={e => focusOn(e, disabled)}
      onBlur={focusOff}
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

export function Textarea({
  value, onChange, placeholder, rows = 3,
}: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`${fieldClass} text-right placeholder-gray-300`}
      style={{ ...fieldStyle(), resize: 'vertical', lineHeight: 1.6 }}
      onFocus={e => focusOn(e)}
      onBlur={focusOff}
    />
  )
}

/** Label + control, stacked. The unit every form row is built from. */
export function Field({
  label, required, children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
    </div>
  )
}

/** Two fields side by side on desktop, stacked on tablet/narrow. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
}
