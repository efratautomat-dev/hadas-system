import { useEffect, useState } from 'react'

// Below this the sidebar leaves ~600px for the page — a portrait tablet — and
// a wide table pushes its last columns (actions, the gap) off-screen. Screens
// that use it switch to cards or drop secondary columns.
// Pass 640 for "a phone".
export function useNarrow(below = 1100) {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.innerWidth < below)
  useEffect(() => {
    const h = () => setV(window.innerWidth < below)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [below])
  return v
}
