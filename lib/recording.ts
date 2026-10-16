import { EgressClient, EncodedFileOutput, S3Upload } from "livekit-server-sdk"
import { EgressStatus } from "@livekit/protocol"
import prisma from "@/lib/prisma"
import { listObjectKeys, objectExists } from "@/lib/s3"
import { egressTemplateUrl } from "@/lib/publicUrl"
import { createRecorderPass } from "@/lib/recorder-pass"

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

/**
 * Start recording the room into the session's next MP4 segment. Segments share
 * the prefix `recordings/{sessionId}`: the first is `{id}.mp4`, later ones
 * `{id}-2.mp4`, `{id}-3.mp4`, … so playback can chain them in order.
 */
export async function startRecordingSegment(
  sessionId: string,
  roomName: string,
): Promise<{ egressId: string; filepath: string; segment: number }> {
  const existing = await discoverMp4Keys(sessionId)
  const last = existing.length ? segmentNumber(existing[existing.length - 1], sessionId) : 0
  const segment = Number.isFinite(last) ? last + 1 : existing.length + 1
  const filepath = segment === 1
    ? `recordings/${sessionId}.mp4`
    : `recordings/${sessionId}-${segment}.mp4`

  const s3Upload = new S3Upload({
    accessKey: process.env.AWS_ACCESS_KEY_ID!,
    secret: process.env.AWS_SECRET_ACCESS_KEY!,
    bucket: process.env.AWS_S3_BUCKET!,
    region: process.env.AWS_REGION ?? "eu-west-2",
  })
  const fileOutput = new EncodedFileOutput({
    filepath,
    output: { case: "s3", value: s3Upload },
  })

  // `customBaseUrl` points LiveKit's headless-Chrome egress worker at our
  // /egress template page, which films the tutor and what they present — never
  // the students. The pass in the path lets that page load the class's slides,
  // video and whiteboard. See app/egress/recorder-view.tsx.
  const pass = await createRecorderPass(sessionId)
  const info = await egressClient().startRoomCompositeEgress(
    roomName,
    { file: fileOutput },
    { customBaseUrl: `${egressTemplateUrl()}/${pass}` },
  )

  await prisma.liveSession.update({
    where: { id: sessionId },
    data: { egressId: info.egressId, recordingKey: filepath },
  })

  return { egressId: info.egressId, filepath, segment }
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

  const processingTimedOut = !!session.endedAt
    && Date.now() - session.endedAt.getTime() > RECORDING_PROCESSING_MS

  const egressId = opts?.egressId ?? session.egressId
  // Past the processing window there is nothing left to wait for — skip the
  // LiveKit poll and just look at what reached S3.
  if (egressId && opts?.pollEgress !== false && !processingTimedOut) {
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
        // LIMIT_REACHED still uploads what was recorded, and a failed egress
        // can leave a partial file — fall through to the S3 check either way.
        console.error(
          "[recording] egress ended abnormally:",
          sessionId,
          info.error || info.details || info.status,
        )
        await prisma.liveSession.update({
          where: { id: sessionId },
          data: { egressId: null },
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
    // Only drop the egress pointer we were reconciling — a late event for an
    // earlier segment must not orphan the segment that is recording now.
    const clearEgress = !!session.egressId && session.egressId === egressId
    if (session.recordingUrl !== primary || clearEgress) {
      await prisma.liveSession.update({
        where: { id: sessionId },
        data: { recordingUrl: primary, ...(clearEgress && { egressId: null }) },
      })
    }
    return { ready: true, keys: existing }
  }

  if (session.recordingUrl || (processingTimedOut && session.egressId)) {
    await prisma.liveSession.update({
      where: { id: sessionId },
      data: { recordingUrl: null, egressId: null },
    })
  }

  return { ready: false, keys: [], timedOut: processingTimedOut || undefined }
}

/**
 * How far back list endpoints look for recordings that reached S3 but were
 * never linked (missed webhook, slow upload). Older unlinked sessions are
 * left alone so a list load doesn't keep probing S3 for ones that truly failed.
 */
const UNLINKED_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000

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
    || (s.status === "COMPLETED" && !s.recordingUrl && !!s.egressId)
    || (
      s.status === "COMPLETED" && !s.recordingUrl && !!s.recordingKey
      && !!s.endedAt && Date.now() - s.endedAt.getTime() < UNLINKED_LOOKBACK_MS
    ),
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
