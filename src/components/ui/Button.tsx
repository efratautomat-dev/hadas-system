import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'

// Canonical action-button primitive — the single shared button style for the whole
// app. Renders the `.hds-btn` variants from index.css (12px radius, 44px tap target,
// brand hover). `size="sm"` gives the compact 38px toolbar variant. Screens should
// adopt this instead of hand-rolled inline-styled buttons.
export function Button({
  variant = 'primary',
  size,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' }) {
  return <button className={`hds-btn hds-btn-${variant}${size === 'sm' ? ' hds-btn-sm' : ''} ${className}`} {...props} />
}

export default Button
