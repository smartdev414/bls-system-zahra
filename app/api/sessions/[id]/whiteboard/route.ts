import { NextRequest, NextResponse } from "next/server"
import { recorderSessionId } from "@/lib/recorder-pass"
import type { Prisma } from "@/app/generated/prisma/client"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

// Persistence for the tldraw classroom whiteboard. One snapshot row per
// session. The tutor (and co-tutors) seed the board from here on open and
// autosave changes; students receive live state over the LiveKit data channel,
// so only tutors touch this endpoint.

async function loadSession(sessionId: string) {
  return prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      tutorId: true,
      status: true,
      coTutors: { select: { tutorId: true } },
      // Teachers on the class's course run it like its owner.
      course: { select: { tutorId: true, teachers: { select: { tutorId: true } } } },
    },
  })
}

function canWrite(
  auth: { role: string; sub: string },
  liveSession: {
    tutorId: string
    coTutors: { tutorId: string }[]
    course: { tutorId: string; teachers: { tutorId: string }[] } | null
  },
) {
  if (auth.role !== "TUTOR") return false
  if (auth.sub === liveSession.tutorId) return true
  if (liveSession.course?.tutorId === auth.sub) return true
  if (liveSession.course?.teachers.some((t) => t.tutorId === auth.sub)) return true
  return liveSession.coTutors.some((c) => c.tutorId === auth.sub)
}

async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params
    const auth = await getSession()
    // The class recorder may read this class's board (read-only), nothing else.
    const isRecorder = !auth && (await recorderSessionId()) === sessionId
    if (!auth && !isRecorder) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const liveSession = await loadSession(sessionId)
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    if (auth && !canWrite(auth, liveSession)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const doc = await prisma.whiteboardDoc.findUnique({
      where: { sessionId },
      select: { snapshot: true, updatedAt: true },
    })

    return NextResponse.json({ snapshot: doc?.snapshot ?? null, updatedAt: doc?.updatedAt ?? null })
  } catch (err) {
    console.error("[GET /api/sessions/[id]/whiteboard]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params
    const auth = await getSession()
    // The class recorder may read this class's board (read-only), nothing else.
    const isRecorder = !auth && (await recorderSessionId()) === sessionId
    if (!auth && !isRecorder) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const liveSession = await loadSession(sessionId)
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    if (auth && !canWrite(auth, liveSession)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const body = await req.json() as { snapshot?: unknown }
    if (body.snapshot == null || typeof body.snapshot !== "object") {
      return NextResponse.json({ message: "snapshot (object) is required" }, { status: 400 })
    }

    const snapshot = body.snapshot as Prisma.InputJsonValue
    await prisma.whiteboardDoc.upsert({
      where: { sessionId },
      create: { sessionId, snapshot },
      update: { snapshot },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[PUT /api/sessions/[id]/whiteboard]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = handleGET
export const PUT = withAudit(handlePUT)
