// Whether this viewer wants live captions on screen.
//
// Captions are the only channel for the spoken part of the room for some
// participants, and clutter over the tutor's hands for others — so it is each
// viewer's own choice, not the tutor's, and turning them off here hides them
// for nobody else. The transcriber keeps running either way.
//
// Remembered per device (localStorage), because it follows the person rather
// than the lesson: someone who needs captions needs them in every class.
//
// A tiny external store rather than React state, so the controls bar and the
// overlay can share it without threading a prop through the whole room.

import { useSyncExternalStore } from "react"

const STORAGE_KEY = "bsl:captions-enabled"

let cached: boolean | null = null
const listeners = new Set<() => void>()

function read(): boolean {
  if (cached !== null) return cached
  let value = true
  try {
    value = window.localStorage.getItem(STORAGE_KEY) !== "0"
  } catch { /* site data disabled — default to on */ }
  cached = value
  return value
}

// On by default: someone who needs captions should never have to find a switch
// to get them.
function readServer(): boolean {
  return true
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setCaptionsEnabled(enabled: boolean): void {
  cached = enabled
  try { window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0") } catch { /* ignore */ }
  for (const l of listeners) l()
}

export function useCaptionsEnabled(): boolean {
  return useSyncExternalStore(subscribe, read, readServer)
}

// ─── Typed-caption composer (tutors) ──────────────────────────────────────────
// Whether the tutor has the "type a caption" box open. Opened from the controls
// bar, rendered by the captions overlay. Not remembered: it is per lesson.

let composerOpen = false
const composerListeners = new Set<() => void>()

function subscribeComposer(listener: () => void): () => void {
  composerListeners.add(listener)
  return () => { composerListeners.delete(listener) }
}

export function setCaptionComposerOpen(open: boolean): void {
  composerOpen = open
  for (const l of composerListeners) l()
}

export function useCaptionComposerOpen(): boolean {
  return useSyncExternalStore(subscribeComposer, () => composerOpen, () => false)
}
