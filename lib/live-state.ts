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

/** Read the current stage. Returns null when nothing has ever been published. */
export async function fetchStageState(sessionId: string): Promise<StageState | null> {
  const res = await fetch(`/api/sessions/${sessionId}/live-state`, { cache: "no-store" })
  if (!res.ok) return null
  const data = await res.json() as { state: StageState | null }
  return data.state ?? null
}

/** Publish the stage (tutor only — students get a 403). */
export async function publishStageState(
  sessionId: string,
  payload: StagePayload,
): Promise<void> {
  await fetch(`/api/sessions/${sessionId}/live-state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}
