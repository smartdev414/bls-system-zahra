import { NextRequest, NextResponse } from "next/server"
import { WebhookReceiver } from "livekit-server-sdk"
import { EgressStatus } from "@livekit/protocol"
import prisma from "@/lib/prisma"
import { withAudit } from "@/lib/audit"
import { reconcileSessionRecording, startRecordingSegment } from "@/lib/recording"
import { notifySessionStatusChange } from "@/lib/live-session-status"

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
)

async function handlePOST(req: NextRequest) {
  try {
    const body = await req.text()
    const authorization = req.headers.get("Authorization") ?? ""

    const event = await receiver.receive(body, authorization)

    // When everyone leaves the LiveKit room it closes; mark the session completed
    // so co-teachers don't keep seeing "Live Now" after the host walked away.
    if (event.event === "room_finished") {
      const roomName = event.room?.name
      if (roomName) {
        const liveSession = await prisma.liveSession.findFirst({
          where: { roomName, status: "LIVE" },
        })
        if (liveSession) {
          const updated = await prisma.liveSession.update({
            where: { id: liveSession.id },
            data: {
              status: "COMPLETED",
              endedAt: liveSession.endedAt ?? new Date(),
            },
          })
          void notifySessionStatusChange(
            liveSession.id,
            "COMPLETED",
            updated.title,
            liveSession.tutorId,
          )
          // The stage snapshot is what late joiners hydrate from — clear it with
          // the room, so reopening this session never restores a finished lesson.
          void prisma.liveSessionPresentation
            .deleteMany({ where: { sessionId: liveSession.id } })
            .catch(() => { /* best effort */ })
          console.info("[webhook/livekit] auto-completed session", liveSession.id, "after room finished")
        }
      }
    }

    if (event.event === "egress_ended") {
      const egressId = event.egressInfo?.egressId
      const status   = event.egressInfo?.status

      if (!egressId) return NextResponse.json({ ok: true })

      let liveSession = await prisma.liveSession.findFirst({
        where: { egressId: { equals: egressId } },
      })

      // Fallback: egress id may already have been cleared by a prior poll.
      if (!liveSession && event.egressInfo?.roomName) {
        liveSession = await prisma.liveSession.findFirst({
          where: { roomName: event.egressInfo.roomName },
          orderBy: { endedAt: "desc" },
        })
      }

      if (!liveSession) return NextResponse.json({ ok: true })

      // Was this the recording currently running for a class that is still on?
      // (A tutor pause clears egressId first, so it never matches here.)
      const wasCurrentWhileLive =
        liveSession.egressId === egressId && liveSession.status === "LIVE"

      if (status !== EgressStatus.EGRESS_COMPLETE) {
        console.error(
          "[webhook/livekit] egress ended abnormally for session:",
          liveSession.id,
          "egressId:",
          egressId,
          "status:",
          status,
          event.egressInfo?.error,
        )
      }

      // Every terminal status can leave a file behind — LIMIT_REACHED always
      // uploads what was recorded — so link whatever reached S3.
      await reconcileSessionRecording(liveSession.id, { egressId, pollEgress: false })

      // LiveKit Cloud caps how long one egress may run. Hitting the cap mid-class
      // would silently stop the recording, so carry on in a new segment.
      if (status === EgressStatus.EGRESS_LIMIT_REACHED && wasCurrentWhileLive) {
        try {
          const next = await startRecordingSegment(liveSession.id, liveSession.roomName)
          console.info("[webhook/livekit] egress limit reached; continued in", next.filepath)
        } catch (err) {
          console.error("[webhook/livekit] could not continue recording after limit", err)
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[webhook/livekit]", err)
    // Return 200 so LiveKit doesn't retry on validation errors
    return NextResponse.json({ ok: false })
  }
}

export const POST = withAudit(handlePOST)
