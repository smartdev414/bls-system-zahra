import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { withAudit } from "@/lib/audit"
import { studentMayJoinSession } from "@/lib/session-access"

const PPT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]

// ─── GET /api/sessions/[id]/slides ───────────────────────────────────────────
// Returns the presentation file URL for any authenticated user who can see the session

async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const liveSession = await prisma.liveSession.findUnique({
      where: { id },
      select: { id: true, status: true, visibility: true, courseId: true },
    })

    if (!liveSession) {
      return NextResponse.json({ message: "Session not found" }, { status: 404 })
    }

    // Students only get the slides of a session they may join (tutors/admins can always access)
    if (session.role === "STUDENT" && !(await studentMayJoinSession(liveSession, session.sub))) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const resource = await prisma.liveSessionResource.findFirst({
      where: { sessionId: id, mimeType: { in: PPT_MIME_TYPES } },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ resource: resource ?? null })
  } catch (err) {
    console.error("[GET /api/sessions/[id]/slides]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
