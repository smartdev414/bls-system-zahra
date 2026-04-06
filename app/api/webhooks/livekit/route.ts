import { NextRequest, NextResponse } from "next/server"
import { WebhookReceiver } from "livekit-server-sdk"
import prisma from "@/lib/prisma"
import { withAudit } from "@/lib/audit"

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
)

async function handlePOST(req: NextRequest) {
  try {
    const body = await req.text()
    const authorization = req.headers.get("Authorization") ?? ""

    const event = await receiver.receive(body, authorization)

    if (event.event === "egress_ended") {
      const egressId = event.egressInfo?.egressId
      const status   = event.egressInfo?.status  // EgressStatus enum value

      if (!egressId) return NextResponse.json({ ok: true })

      // Find session by egressId
      const liveSession = await prisma.liveSession.findFirst({
        where: { egressId: { equals: egressId } },
      })
      if (!liveSession) return NextResponse.json({ ok: true })

      // EgressStatus.EGRESS_COMPLETE = 2, EGRESS_FAILED = 3
      const failed = (status as unknown as number) === 3
      if (!failed) {
        const key = (liveSession as unknown as { recordingKey?: string }).recordingKey
          ?? `recordings/${liveSession.id}.mp4`
        await prisma.liveSession.update({
          where: { id: liveSession.id },
          data: { recordingUrl: key },
        })
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
