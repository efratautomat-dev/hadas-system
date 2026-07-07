import type { InputHTMLAttributes } from 'react'

// Approved text input primitive (spec/design-preview): 44px tall, 10px radius,
// burgundy focus border. Wraps the `.hds-input` class in index.css.
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`hds-input ${className}`} {...props} />
}

export default Input
