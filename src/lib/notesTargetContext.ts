import { createContext, useContext, useEffect } from 'react'

/**
 * Which supplier the notes panel is currently about.
 *
 * The panel is mounted once in Layout, but only the SCREENS know which supplier
 * is in focus — and for payments that is the open row, state internal to
 * Payments.tsx and invisible to Layout. Threading it up as props would mean every
 * screen taking a callback it does not otherwise need.
 *
 * A screen DECLARES its target and forgets about it. `useNotesTarget` sets on
 * mount and clears on unmount, so navigating away cannot leave the panel pointing
 * at a supplier no longer on screen.
 *
 * Context + hooks live in this .ts file and the Provider component in the .tsx
 * beside it, so neither file mixes a component with non-component exports.
 */
export interface NotesTarget {
  supplierId: string | null
  supplierName: string
}

export const EMPTY_TARGET: NotesTarget = { supplierId: null, supplierName: '' }

export const NotesTargetContext = createContext<{
  target: NotesTarget
  setTarget: (t: NotesTarget) => void
}>({ target: EMPTY_TARGET, setTarget: () => {} })

/** Read the current target — for Layout, which renders the panel. */
export function useNotesTargetValue(): NotesTarget {
  return useContext(NotesTargetContext).target
}

/**
 * Declare the supplier this screen is about. Pass `null` when none is in focus
 * (a list view, or payments before a row is opened) and the panel hides itself —
 * a note has to belong to someone.
 */
export function useNotesTarget(supplierId: string | null | undefined, supplierName?: string | null) {
  const { setTarget } = useContext(NotesTargetContext)
  const id   = supplierId || null
  const name = supplierName ?? ''
  useEffect(() => {
    setTarget({ supplierId: id, supplierName: name })
    return () => setTarget(EMPTY_TARGET)
  }, [id, name, setTarget])
}
