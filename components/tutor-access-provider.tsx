"use client"

import { createContext, useContext } from "react"
import { FULL_ACCESS, type TutorAccess } from "@/lib/tutor-areas"

// The signed-in teacher's switches (lib/tutor-areas.ts), set once by the tutor
// layout. Pages shared with admins read full access, since admins are never
// limited.
const TutorAccessContext = createContext<TutorAccess>(FULL_ACCESS)

export function TutorAccessProvider({ access, children }: { access: TutorAccess; children: React.ReactNode }) {
  return <TutorAccessContext.Provider value={access}>{children}</TutorAccessContext.Provider>
}

export function useTutorAccess(): TutorAccess {
  return useContext(TutorAccessContext)
}
