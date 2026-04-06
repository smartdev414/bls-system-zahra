import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { withAudit } from "@/lib/audit"

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
      select: { status: true, visibility: true, invites: { select: { studentId: true } } },
    })

    if (!liveSession) {
      return NextResponse.json({ message: "Session not found" }, { status: 404 })
    }

    // For INVITE_ONLY sessions, ensure the student is invited (tutors/admins can always access)
    if (
      liveSession.visibility === "INVITE_ONLY" &&
      session.role === "STUDENT"
    ) {
      const invited = liveSession.invites.some((i) => i.studentId === session.sub)
      if (!invited) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 })
      }
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
