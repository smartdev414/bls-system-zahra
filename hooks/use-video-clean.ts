"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"
import { rawKeyFromUrl } from "@/lib/background-clean-keys"

/**
 * Where background replacement stands for a recorded video (see
 * lib/background-clean.ts), for any component that shows one.
 *
 * Every user of the hook on a page shares one store, so a list of a hundred
 * signs asks the server once per round, not a hundred times. Rounds repeat
 * only while something is still processing.
 */

export type CleanState = "processing" | "done" | "failed"

const POLL_MS = 8000
const states = new Map<string, CleanState>()
const watched = new Map<string, number>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

function emit() {
  listeners.forEach((listener) => listener())
}

function schedule(delay: number) {
  if (timer === null) timer = setTimeout(poll, delay)
}

async function poll() {
  timer = null
  // "done" and "failed" only change through a retry made here, which updates
  // the store itself — so only the unknown and the unfinished need asking about.
  const urls = [...watched.keys()].filter((url) => {
    const state = states.get(url)
    return state === undefined || state === "processing"
  })
  if (urls.length === 0) return
  try {
    for (let i = 0; i < urls.length; i += 500) {
      const res = await fetch("/api/upload/clean-background/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urls.slice(i, i + 500) }),
      })
      if (!res.ok) return
      const data = await res.json() as { states?: Record<string, CleanState> }
      for (const [url, state] of Object.entries(data.states ?? {})) states.set(url, state)
    }
    emit()
  } catch {
    // A dropped round isn't news; the next one will ask again.
  }
  if ([...watched.keys()].some((url) => states.get(url) === "processing")) schedule(POLL_MS)
}

/** Record a state learnt some other way (the recorder knows as soon as it submits). */
export function setVideoCleanState(url: string, state: CleanState) {
  states.set(url, state)
  emit()
  if (state === "processing") schedule(POLL_MS)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * `state` is null for a video that isn't a raw recording (nothing to show) or
 * whose state hasn't loaded yet. `retry` starts a failed one again.
 */
export function useVideoCleanState(url: string | null | undefined): {
  state: CleanState | null
  retry: () => Promise<void>
} {
  const tracked = url && rawKeyFromUrl(url) ? url : null

  useEffect(() => {
    if (!tracked) return
    watched.set(tracked, (watched.get(tracked) ?? 0) + 1)
    // A short wait lets every badge on the page register before the first round.
    schedule(50)
    return () => {
      const count = (watched.get(tracked) ?? 1) - 1
      if (count > 0) watched.set(tracked, count)
      else watched.delete(tracked)
    }
  }, [tracked])

  const state = useSyncExternalStore(
    subscribe,
    () => (tracked ? states.get(tracked) ?? null : null),
    () => null,
  )

  const retry = useCallback(async () => {
    if (!tracked) return
    const res = await fetch("/api/upload/clean-background/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tracked }),
    })
    if (!res.ok) throw new Error("Could not retry")
    const { state: next } = await res.json() as { state: CleanState }
    setVideoCleanState(tracked, next)
  }, [tracked])

  return { state, retry }
}
