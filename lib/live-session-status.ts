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

/** When a class's booked slot ends. */
export function scheduledEnd(s: { scheduledAt: Date; durationMins: number }): Date {
  return new Date(s.scheduledAt.getTime() + s.durationMins * 60_000)
}

/**
 * Marks a live class completed after its room has closed: tells co-teachers
 * and drops the stage snapshot late joiners hydrate from, so reopening the
 * session never restores a finished lesson.
 */
export async function completeLiveSession(s: {
  id: string
  title: string
  tutorId: string
  endedAt: Date | null
}): Promise<void> {
  await prisma.liveSession.update({
    where: { id: s.id },
    data: { status: "COMPLETED", endedAt: s.endedAt ?? new Date() },
  })
  void notifySessionStatusChange(s.id, "COMPLETED", s.title, s.tutorId)
  void prisma.liveSessionPresentation
    .deleteMany({ where: { sessionId: s.id } })
    .catch(() => { /* best effort */ })
}

/**
 * Completes classes still LIVE after their booked slot whose room is empty.
 * The room closing mid-slot (everyone stepped out for a break) leaves a class
 * live so the tutor can come back; this finishes the ones nobody came back to.
 */
export async function completeOverdueLiveSessions(now: Date = new Date()): Promise<void> {
  const live = await prisma.liveSession.findMany({
    where: { status: "LIVE", inPerson: false },
    select: { id: true, title: true, tutorId: true, endedAt: true, roomName: true, scheduledAt: true, durationMins: true },
  })
  const overdue = live.filter((s) => scheduledEnd(s) <= now)
  if (overdue.length === 0) return

  let occupied: Set<string>
  try {
    const rooms = await roomServiceClient().listRooms(overdue.map((s) => s.roomName))
    occupied = new Set(rooms.filter((r) => r.numParticipants > 0).map((r) => r.name))
  } catch (err) {
    // Can't tell who is still in class — leave them all live rather than end one mid-lesson.
    console.error("[live-session] listRooms failed", err)
    return
  }

  for (const s of overdue) {
    if (occupied.has(s.roomName)) continue
    await completeLiveSession(s).catch((err) =>
      console.error("[live-session] could not complete overdue session", s.id, err),
    )
  }
}
