"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { usePathname } from "next/navigation"

/**
 * useState that survives leaving the page and coming back (Back button or a
 * "Back to list" link) for the rest of the browser tab's life. Used for list
 * searches, filters and page numbers so people land where they left off.
 *
 * The saved value is read after mount (not during render) so server and
 * client render the same thing first and hydration never mismatches.
 * Keys are scoped to the current path, so /admin/courses and
 * /support/courses remember separately.
 */
export function useRememberedState<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const pathname = usePathname()
  const key = `remember:${pathname}:${name}`
  const [value, setValue] = useState<T>(initial)
  // Don't save until the old value has been read back, or the starting value
  // would overwrite it.
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(key)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after hydration
      if (raw !== null) setValue(JSON.parse(raw) as T)
    } catch {
      // Storage blocked or bad JSON: just start fresh.
    }
    setRestored(true)
  }, [key])

  useEffect(() => {
    if (!restored) return
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Ignore quota/private-mode errors; the page still works, it just won't remember.
    }
  }, [key, value, restored])

  return [value, setValue]
}
