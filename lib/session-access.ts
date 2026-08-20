import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"

/**
 * Who is allowed to read/write the live-classroom side channels (chat history,
 * stage state) for a session.
 *
 * Read access mirrors "could this person be in the room": the owning tutor, any
 * co-tutor, an admin, and — for INVITE_ONLY sessions — only students who hold an
 * invite or an approved join request. PUBLIC sessions are readable by any signed
 * in student, matching the join flow.
 */
export type SessionAccess = {
  id: string
  tutorId: string
  status: string
  visibility: string
  coTutors: { tutorId: string }[]
}

export type AccessResult =
  | { liveSession: SessionAccess; isTutor: boolean; error?: undefined }
  | { error: NextResponse; liveSession?: undefined; isTutor?: undefined }

export async function assertCanAccessSession(
  auth: { role: string; sub: string },
  sessionId: string,
): Promise<AccessResult> {
  const liveSession = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      tutorId: true,
      status: true,
      visibility: true,
      coTutors: { select: { tutorId: true } },
    },
  })

  if (!liveSession) {
    return { error: NextResponse.json({ message: "Session not found" }, { status: 404 }) }
  }

  if (auth.role === "ADMIN") return { liveSession, isTutor: true }

  const isOwner = auth.role === "TUTOR" && auth.sub === liveSession.tutorId
  const isCoTutor =
    auth.role === "TUTOR" &&
    liveSession.coTutors.some((c) => c.tutorId === auth.sub)

  if (isOwner || isCoTutor) return { liveSession, isTutor: true }

  if (auth.role !== "STUDENT") {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }

  if (liveSession.visibility === "INVITE_ONLY") {
    const [invite, approvedRequest] = await Promise.all([
      prisma.liveSessionInvite.findUnique({
        where: { sessionId_studentId: { sessionId, studentId: auth.sub } },
        select: { id: true },
      }),
      prisma.sessionJoinRequest.findFirst({
        where: { sessionId, studentId: auth.sub, status: "APPROVED" },
        select: { id: true },
      }),
    ])
    if (!invite && !approvedRequest) {
      return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
    }
  }

  return { liveSession, isTutor: false }
}
