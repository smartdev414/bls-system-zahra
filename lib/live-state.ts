"use client"

import { netFetch, netJson, POLL_TIMEOUT_MS } from "./net-fetch"

/**
 * Classroom stage state, persisted server-side.
 *
 * The LiveKit data channel only delivers events to whoever is connected at the
 * time, so it cannot answer "what is on screen right now?" for a student who
 * joins late or reloads. The tutor mirrors every stage change to
 * `/api/sessions/[id]/live-state`; everyone reads it on join and on reconnect.
 */

export type StageState = {
  active: boolean
  kind: "slides" | "video" | null
  url: string | null
  page: number
  totalPages: number
  selectedPages: number[]
  videoPlaying: boolean
  videoTime: number
  /** Server clock, ms since epoch. */
  updatedAt: number
}

export type StagePayload = {
  active: boolean
  kind?: "slides" | "video" | null
  url?: string | null
  page?: number
  totalPages?: number
  selectedPages?: number[]
  videoPlaying?: boolean
  videoTime?: number
}

/**
 * Read the current stage. Returns null when nothing has ever been published —
 * and also when the request failed, which callers already treat as "nothing to
 * apply". Both are on a deadline: this runs on a repeating reconcile while a
 * lesson is in progress, and an unbounded request here was one of the ways a
 * student on café Wi-Fi ended up holding a stale slide with a spinner that
 * never resolved.
 */
export async function fetchStageState(sessionId: string): Promise<StageState | null> {
  try {
    const data = await netJson<{ state: StageState | null }>(
      `/api/sessions/${sessionId}/live-state`,
      { cache: "no-store" },
      { timeoutMs: POLL_TIMEOUT_MS, retries: 0, report: false },
    )
    return data.state ?? null
  } catch {
    return null
  }
}

/**
 * Publish the stage (tutor only — students get a 403).
 *
 * Never retried. This is a fire-and-forget mirror of a change the tutor has
 * already made locally and already sent over the data channel; a replay would
 * race the next slide change and could put the class back a page.
 */
export async function publishStageState(
  sessionId: string,
  payload: StagePayload,
): Promise<void> {
  try {
    await netFetch(
      `/api/sessions/${sessionId}/live-state`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      { timeoutMs: POLL_TIMEOUT_MS, retries: 0 },
    )
  } catch {
    // The data channel already carried this to everyone connected; the stored
    // copy only matters to someone who joins or reloads later, and the next
    // stage change will write it again.
  }
}
