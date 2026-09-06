import { useState, useEffect } from 'react'

/**
 * Wide enough to put a document and its details side by side without either
 * becoming unusable. Below this, screens stack them instead.
 *
 * Lifted out of Invoices.tsx when the goods page adopted the same two-pane
 * layout: the threshold decides whether one screen matches another, so a second
 * copy with a slightly different number is how two screens quietly stop agreeing.
 */
export function useIsWide(breakpoint = 1100) {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.innerWidth >= breakpoint)
  useEffect(() => {
    const h = () => setV(window.innerWidth >= breakpoint)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [breakpoint])
  return v
}
