import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { AccessToken, TrackSource } from "livekit-server-sdk"
import { withAudit } from "@/lib/audit"
import { ensureClassroomTranscriber } from "@/lib/livekit"
import { isSessionHost, studentMayJoinSession } from "@/lib/session-access"

async function handlePOST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const liveSession = await prisma.liveSession.findUnique({
      where: { id },
    })

    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })
    if (liveSession.status === "CANCELLED" || liveSession.status === "COMPLETED") {
      return NextResponse.json({ message: "Session is no longer active" }, { status: 410 })
    }
    // A face-to-face class has no online room to join.
    if (liveSession.inPerson) {
      return NextResponse.json(
        { message: liveSession.venue ? `This class is face to face, at ${liveSession.venue}.` : "This class is face to face, not online." },
        { status: 409 }
      )
    }

    // Students only get into the sessions meant for them: invited (or approved)
    // for invite-only ones, on the course for a course's class.
    if (session.role === "STUDENT" && !(await studentMayJoinSession(liveSession, session.sub))) {
      return NextResponse.json(
        {
          message: liveSession.visibility === "INVITE_ONLY"
            ? "This session is invite-only. Your request to join must be approved by the tutor first."
            : "This class is for students on the course. Ask your tutor to add you to it.",
        },
        { status: 403 }
      )
    }

    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    const wsUrl = process.env.LIVEKIT_WS_URL

    if (!apiKey || !apiSecret || !wsUrl) {
      return NextResponse.json(
        { message: "LiveKit is not configured. Add LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_WS_URL to your .env" },
        { status: 503 }
      )
    }

    // The owning tutor always gets tutor rights. A co-tutor (another tutor the
    // owner invited to this specific session) gets the same tutor metadata and
    // publish grant, so they join with full classroom controls.
    // A teacher on the class's course counts as its owner here: an admin puts
    // teachers on a course, so they take its classes whoever scheduled them.
    const isOwnerTutor = session.role === "TUTOR" && (
      session.sub === liveSession.tutorId || (await isSessionHost(session, id))
    )
    // Support staff can be invited too (an interpreter for the class); they
    // join as a co-teacher, never as the owner.
    const isCoTutor =
      (session.role === "TUTOR" || session.role === "SUPPORT") &&
      !isOwnerTutor &&
      !!(await prisma.liveSessionCoTutor.findUnique({
        where: { sessionId_tutorId: { sessionId: id, tutorId: session.sub } },
        select: { id: true },
      }))
    const isTutor = isOwnerTutor || isCoTutor

    // Only the owning tutor can open the room. LiveKit creates a room on first
    // join, so handing anyone else a token while the session is still SCHEDULED
    // put the class "live" — room up, transcriber dispatched, attendance
    // stamped — before the tutor had pressed Start.
    if (liveSession.status === "SCHEDULED" && !isOwnerTutor) {
      return NextResponse.json(
        { message: "The tutor hasn't started this session yet." },
        { status: 409 }
      )
    }

    // Use a UNIQUE identity per connection (`<userId>__<random>`) rather than the
    // bare user id. LiveKit Cloud revokes an *identity* — not just a single token —
    // when its session ends abnormally (a refresh kills the socket) or when
    // `removeParticipant` is called, and that revocation outlives the token TTL.
    // Reusing the bare user id therefore makes a rejoin fail with
    // "invalid token: revoked". A fresh suffix is never revoked, so every (re)join
    // connects cleanly. The base id stays recoverable via `participantBaseId()` for
    // the rare server-side check that needs it.
    const identity = `${session.sub}__${randomUUID().slice(0, 8)}`

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: session.name,
      ttl: 60 * 60, // 1 hour
      metadata: isTutor ? "tutor" : "student",
    })

    // Tutors publish camera + mic. Students publish camera/screen only — the tutor
    // enables each student's mic via the session controls when they may speak.
    at.addGrant(
      isTutor
        ? {
            roomJoin: true,
            room: liveSession.roomName,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
          }
        : {
            roomJoin: true,
            room: liveSession.roomName,
            canPublish: true,
            canPublishSources: [TrackSource.CAMERA, TrackSource.SCREEN_SHARE],
            canSubscribe: true,
            canPublishData: true,
          }
    )

    const token = await at.toJwt()

    // Await dispatch — Vercel kills fire-and-forget work when the response is sent.
    try {
      await ensureClassroomTranscriber(liveSession.roomName)
    } catch (err) {
      console.warn("[captions] transcriber dispatch failed (token still issued)", err)
    }

    // Record attendance for students
    if (session.role === "STUDENT") {
      await prisma.liveSessionAttendance.upsert({
        where: { sessionId_studentId: { sessionId: id, studentId: session.sub } },
        create: { sessionId: id, studentId: session.sub, joinedAt: new Date() },
        update: { joinedAt: new Date() },
      })
    }

    return NextResponse.json({ token, wsUrl, roomName: liveSession.roomName })
  } catch (err) {
    console.error("[POST /api/sessions/[id]/token]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
