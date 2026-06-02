import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { RoomServiceClient, TrackSource } from "livekit-server-sdk"
import { withAudit } from "@/lib/audit"

function roomServiceClient() {
  return new RoomServiceClient(
    process.env.LIVEKIT_WS_URL!.replace(/^wss?/, "https"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )
}

const STUDENT_PUBLISH_SOURCES = [TrackSource.CAMERA, TrackSource.SCREEN_SHARE]
const STUDENT_PUBLISH_WITH_MIC = [
  TrackSource.CAMERA,
  TrackSource.SCREEN_SHARE,
  TrackSource.MICROPHONE,
]

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; identity: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, identity } = await params
    const body = (await req.json()) as { enabled?: boolean }
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ message: "enabled (boolean) is required" }, { status: 400 })
    }

    const liveSession = await prisma.liveSession.findFirst({
      where: { id, tutorId: session.sub },
      select: { id: true, roomName: true },
    })
    if (!liveSession) {
      return NextResponse.json({ message: "Session not found" }, { status: 404 })
    }

    const client = roomServiceClient()
    const participant = await client.getParticipant(liveSession.roomName, identity)

    const micTrack = participant.tracks?.find((t) => t.source === TrackSource.MICROPHONE)

    await client.updateParticipant(liveSession.roomName, identity, {
      permission: {
        // Important: permissions are applied atomically by LiveKit.
        // Always include subscribe/data flags so mic toggles don't strip them.
        canSubscribe: true,
        canPublishData: true,
        canPublish: true,
        canPublishSources: body.enabled ? STUDENT_PUBLISH_WITH_MIC : STUDENT_PUBLISH_SOURCES,
      },
    })

    // LiveKit rejects remote unmute in some room configs ("remote unmute not enabled").
    // For enabling, we rely on the student client to call setMicrophoneEnabled(true)
    // after receiving the tutor's data-channel command.
    // For disabling, keep best-effort server-side mute if a mic track exists.
    if (!body.enabled && micTrack?.sid) {
      try {
        await client.mutePublishedTrack(
          liveSession.roomName,
          identity,
          micTrack.sid,
          true,
        )
      } catch {
        // Best effort only: permission + client command still enforce mute.
      }
    }

    return NextResponse.json({ enabled: body.enabled })
  } catch (err) {
    console.error("[PATCH /api/tutor/sessions/[id]/participants/[identity]/mic]", err)
    return NextResponse.json({ message: "Could not update microphone" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
