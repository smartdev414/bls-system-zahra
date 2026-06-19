import { EgressClient } from "livekit-server-sdk"
import { EgressStatus } from "@livekit/protocol"
import prisma from "@/lib/prisma"
import { listObjectKeys, objectExists } from "@/lib/s3"

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

/**
 * Align DB recording pointers with what actually exists in S3.
 * Optionally polls LiveKit when an egress id is still set.
 */
export async function reconcileSessionRecording(
  sessionId: string,
  opts?: { egressId?: string | null; pollEgress?: boolean },
): Promise<{ ready: boolean; keys: string[] }> {
  const session = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: { id: true, egressId: true, recordingUrl: true },
  })
  if (!session) return { ready: false, keys: [] }

  const egressId = opts?.egressId ?? session.egressId
  if (egressId && opts?.pollEgress !== false) {
    try {
      const listed = await egressClient().listEgress({ egressId })
      const info = listed[0]
      if (info) {
        if (
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
      }
    } catch (err) {
      console.warn("[recording] listEgress failed for", sessionId, err)
    }
  }

  const mp4Keys = await discoverMp4Keys(sessionId)
  const existing: string[] = []
  for (const key of mp4Keys) {
    if (await objectExists(key)) existing.push(key)
  }

  if (existing.length > 0) {
    const primary = existing[0]
    if (session.recordingUrl !== primary) {
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

/** Poll S3 after stopEgress — webhook may be missing or delayed. */
export function scheduleRecordingReconcile(sessionId: string, egressId: string | null) {
  const delaysMs = [0, 5_000, 15_000, 30_000, 60_000, 120_000]
  void (async () => {
    for (const delay of delaysMs) {
      if (delay) await new Promise((r) => setTimeout(r, delay))
      const { ready } = await reconcileSessionRecording(sessionId, {
        egressId,
        pollEgress: true,
      })
      if (ready) return
    }
  })()
}
