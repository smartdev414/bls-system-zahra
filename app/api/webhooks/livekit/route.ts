import { NextRequest, NextResponse } from "next/server"
import { WebhookReceiver } from "livekit-server-sdk"
import { EgressStatus } from "@livekit/protocol"
import prisma from "@/lib/prisma"
import { withAudit } from "@/lib/audit"
import { reconcileSessionRecording } from "@/lib/recording"
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

      if (
        status === EgressStatus.EGRESS_FAILED
        || status === EgressStatus.EGRESS_ABORTED
        || status === EgressStatus.EGRESS_LIMIT_REACHED
      ) {
        console.error(
          "[webhook/livekit] egress failed for session:",
          liveSession.id,
          "egressId:",
          egressId,
          event.egressInfo?.error,
        )
        await prisma.liveSession.update({
          where: { id: liveSession.id },
          data: { egressId: null, recordingUrl: null },
        })
      } else if (status === EgressStatus.EGRESS_COMPLETE) {
        await reconcileSessionRecording(liveSession.id, { egressId })
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
