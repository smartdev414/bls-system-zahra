import { EgressClient } from "livekit-server-sdk"
import { EgressStatus } from "@livekit/protocol"
import prisma from "@/lib/prisma"
import { listObjectKeys, objectExists } from "@/lib/s3"

/** How long the UI shows "Recording processing…" after a session ends. */
export const RECORDING_PROCESSING_MS = 10 * 60 * 1000

export function egressClient() {
  return new EgressClient(
    process.env.LIVEKIT_WS_URL!.replace(/^wss?/, "https"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )
}

function segmentNumber(key: string, sessionId: string): number {
  const base = `recordings/${sessionId}`
  if (key === `${base}.mp4`) return 1
  const m = key.match(new RegExp(`^${base}-(\\d+)\\.mp4$`))
  if (m) return parseInt(m[1], 10)
  return Number.POSITIVE_INFINITY
}

/** Ordered MP4 segment keys for a session, discovered from S3. */
export async function discoverMp4Keys(sessionId: string): Promise<string[]> {
  const keys = await listObjectKeys(`recordings/${sessionId}`)
  return keys
    .filter((k) => k.endsWith(".mp4"))
    .sort((a, b) => segmentNumber(a, sessionId) - segmentNumber(b, sessionId))
}

const TERMINAL_EGRESS = new Set([
  EgressStatus.EGRESS_COMPLETE,
  EgressStatus.EGRESS_FAILED,
  EgressStatus.EGRESS_ABORTED,
  EgressStatus.EGRESS_LIMIT_REACHED,
])

/** Grace period after egress ends while we wait for S3 upload. */
const S3_UPLOAD_GRACE_MS = 3 * 60 * 1000

export function isRecordingLikelyProcessing(session: {
  status: string
  recordingUrl: string | null
  recordingKey?: string | null
  egressId?: string | null
  endedAt: Date | string | null
}): boolean {
  if (session.status !== "COMPLETED") return false
  if (session.recordingUrl) return false
  if (!session.recordingKey && !session.egressId) return false
  if (!session.endedAt) return !!session.egressId

  const elapsed = Date.now() - new Date(session.endedAt).getTime()
  if (elapsed >= RECORDING_PROCESSING_MS) return false
  if (session.egressId) return true
  // Egress finished but S3 may still be catching up.
  return !!session.recordingKey && elapsed < S3_UPLOAD_GRACE_MS
}

/**
 * Align DB recording pointers with what actually exists in S3.
 * Optionally polls LiveKit when an egress id is still set.
 */
export async function reconcileSessionRecording(
  sessionId: string,
  opts?: { egressId?: string | null; pollEgress?: boolean },
): Promise<{ ready: boolean; keys: string[]; timedOut?: boolean }> {
  const session = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      egressId: true,
      recordingUrl: true,
      recordingKey: true,
      endedAt: true,
      status: true,
    },
  })
  if (!session) return { ready: false, keys: [] }

  const processingTimedOut = session.endedAt
    && Date.now() - session.endedAt.getTime() > RECORDING_PROCESSING_MS

  if (processingTimedOut && !session.recordingUrl) {
    if (session.egressId) {
      await prisma.liveSession.update({
        where: { id: sessionId },
        data: { egressId: null },
      })
    }
    return { ready: false, keys: [], timedOut: true }
  }

  const egressId = opts?.egressId ?? session.egressId
  if (egressId && opts?.pollEgress !== false) {
    try {
      const listed = await egressClient().listEgress({ egressId })
      const info = listed[0]
      if (!info) {
        // Stale pointer — egress no longer exists server-side.
        await prisma.liveSession.update({
          where: { id: sessionId },
          data: { egressId: null },
        })
      } else if (
        info.status === EgressStatus.EGRESS_FAILED
        || info.status === EgressStatus.EGRESS_ABORTED
        || info.status === EgressStatus.EGRESS_LIMIT_REACHED
      ) {
        console.error(
          "[recording] egress terminal failure:",
          sessionId,
          info.error || info.details || info.status,
        )
        await prisma.liveSession.update({
          where: { id: sessionId },
          data: { egressId: null, recordingUrl: null },
        })
      } else if (TERMINAL_EGRESS.has(info.status)) {
        await prisma.liveSession.update({
          where: { id: sessionId },
          data: { egressId: null },
        })
      } else {
        // Egress still starting / active / ending — file not ready yet.
        return { ready: false, keys: [] }
      }
    } catch (err) {
      console.warn("[recording] listEgress failed for", sessionId, err)
      // Don't leave a stale egressId blocking the UI forever.
      await prisma.liveSession.update({
        where: { id: sessionId },
        data: { egressId: null },
      })
    }
  }

  const mp4Keys = await discoverMp4Keys(sessionId)
  const existing: string[] = []
  for (const key of mp4Keys) {
    if (await objectExists(key)) existing.push(key)
  }

  if (existing.length > 0) {
    const primary = existing[0]
    if (session.recordingUrl !== primary || session.egressId) {
      await prisma.liveSession.update({
        where: { id: sessionId },
        data: { recordingUrl: primary, egressId: null },
      })
    }
    return { ready: true, keys: existing }
  }

  if (session.recordingUrl) {
    await prisma.liveSession.update({
      where: { id: sessionId },
      data: { recordingUrl: null },
    })
  }

  return { ready: false, keys: [] }
}

/** Reconcile any sessions that may still be finalising a recording. */
export async function reconcilePendingRecordings(
  sessions: Array<{
    id: string
    status: string
    recordingUrl: string | null
    recordingKey: string | null
    egressId: string | null
    endedAt: Date | null
  }>,
): Promise<void> {
  const pending = sessions.filter((s) =>
    isRecordingLikelyProcessing(s)
    || (s.status === "COMPLETED" && !s.recordingUrl && !!s.egressId),
  )
  if (pending.length === 0) return
  await Promise.all(
    pending.map((s) =>
      reconcileSessionRecording(s.id, { egressId: s.egressId, pollEgress: true }),
    ),
  )
}

/** Best-effort follow-up polls (may not run on serverless after the response). */
export function scheduleRecordingReconcile(sessionId: string, egressId: string | null) {
  const delaysMs = [5_000, 15_000, 30_000, 60_000]
  void (async () => {
    for (const delay of delaysMs) {
      await new Promise((r) => setTimeout(r, delay))
      const { ready } = await reconcileSessionRecording(sessionId, {
        egressId,
        pollEgress: true,
      })
      if (ready) return
    }
  })()
}
