import { useState, type ReactNode } from 'react'
import { NotesTargetContext, EMPTY_TARGET, type NotesTarget } from './notesTargetContext'

/** Holds the current notes target. The context and the hooks that read it live in
 *  ./notesTargetContext — this file exports a component and nothing else. */
export function NotesTargetProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<NotesTarget>(EMPTY_TARGET)
  return (
    <NotesTargetContext.Provider value={{ target, setTarget }}>
      {children}
    </NotesTargetContext.Provider>
  )
}
