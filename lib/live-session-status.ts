import prisma from "@/lib/prisma"
import { triggerUserEvent } from "@/lib/pusher-server"
import { roomServiceClient } from "@/lib/livekit"

type SessionStatus = "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED"

/** Tear down the LiveKit room so remaining participants disconnect. */
export async function closeLiveKitRoom(roomName: string): Promise<void> {
  try {
    await roomServiceClient().deleteRoom(roomName)
  } catch (err) {
    console.error("[live-session] deleteRoom failed for", roomName, err)
  }
}

/** Push a status change to co-teachers (and the host) so open pages refresh. */
export async function notifySessionStatusChange(
  sessionId: string,
  status: SessionStatus,
  title: string,
  hostTutorId: string,
): Promise<void> {
  const coTutors = await prisma.liveSessionCoTutor.findMany({
    where: { sessionId },
    select: { tutorId: true },
  })
  const recipientIds = new Set([hostTutorId, ...coTutors.map((c) => c.tutorId)])

  await Promise.all(
    [...recipientIds].map((userId) =>
      triggerUserEvent(userId, "session-status", { sessionId, status, title }).catch(() => {}),
    ),
  )
}
