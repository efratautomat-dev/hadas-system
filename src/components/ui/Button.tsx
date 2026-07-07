import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

// Approved button primitive (spec/design-preview/index.html). Renders the exact
// preview variants — radius 10px, 15/600, brand hover states — via the `.hds-btn`
// classes in index.css. Screens should adopt this instead of inline-styled buttons.
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`hds-btn hds-btn-${variant} ${className}`} {...props} />
}

export default Button
