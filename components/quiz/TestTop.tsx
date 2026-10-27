"use client"

import { createContext, useCallback, useContext, useEffect, useRef } from "react"

const ScrollToTop = createContext<() => void>(() => {})

/**
 * Wraps a test so each of its screens opens at the top. Marking can be a long
 * page; without this the short score that follows opens scrolled far past it,
 * on a blank stretch of page.
 */
export function TestTop({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = useCallback(() => {
    const el = ref.current
    // Only when the top is hidden (under the sticky header or above it).
    if (el && el.getBoundingClientRect().top < 64) el.scrollIntoView({ block: "start" })
  }, [])
  return (
    <ScrollToTop.Provider value={scroll}>
      <div ref={ref} className="scroll-mt-20">{children}</div>
    </ScrollToTop.Provider>
  )
}

/** Brings the top of the test into view whenever `screen` changes. */
export function useTopOnNewScreen(screen: string) {
  const scroll = useContext(ScrollToTop)
  useEffect(() => { scroll() }, [screen, scroll])
}
