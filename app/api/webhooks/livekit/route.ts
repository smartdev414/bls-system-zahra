import { NextRequest, NextResponse } from "next/server"
import { WebhookReceiver } from "livekit-server-sdk"
import { EgressStatus } from "@livekit/protocol"
import prisma from "@/lib/prisma"
import { withAudit } from "@/lib/audit"
import { reconcileSessionRecording, startRecordingSegment } from "@/lib/recording"
import { completeLiveSession, scheduledEnd } from "@/lib/live-session-status"

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
)

async function handlePOST(req: NextRequest) {
  try {
    const body = await req.text()
    const authorization = req.headers.get("Authorization") ?? ""

    const event = await receiver.receive(body, authorization)

    // When everyone leaves the LiveKit room it closes. Once the booked slot is
    // over that means the class is done, so mark it completed — co-teachers
    // otherwise keep seeing "Live Now" after the host walked away. Before then
    // it's a break (the tutor went for a cup of tea): the class stays live so
    // they can come back, and completeOverdueLiveSessions finishes it later if
    // nobody does.
    if (event.event === "room_finished") {
      const roomName = event.room?.name
      if (roomName) {
        const liveSession = await prisma.liveSession.findFirst({
          where: { roomName, status: "LIVE" },
        })
        if (liveSession && scheduledEnd(liveSession) <= new Date()) {
          await completeLiveSession(liveSession)
          console.info("[webhook/livekit] auto-completed session", liveSession.id, "after room finished")
        } else if (liveSession) {
          console.info("[webhook/livekit] room closed mid-slot; session", liveSession.id, "stays live")
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
