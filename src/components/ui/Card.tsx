import type { HTMLAttributes } from 'react'

// Approved card primitive (spec/design-preview): white surface, 12px radius, 1px
// brand border, soft shadow, 24px padding. Wraps the `.hds-card` class in index.css.
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`hds-card ${className}`} {...props} />
}

export default Card
