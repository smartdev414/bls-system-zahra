import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { assertCanAccessSession } from "@/lib/session-access"
import { recorderSessionId } from "@/lib/recorder-pass"

// ─── /api/sessions/[id]/recording/privacy ────────────────────────────────────
// Which students of this class may have their face in the recording, and which
// asked not to be (User.recordingOptOut — often a safeguarding case).
//
// Read by the class recorder (app/egress/recorder-view.tsx), which films only
// students on the `recorded` list — a student it hasn't heard about yet stays
// out until it has — and by the tutor's tab, which pauses the recording while
// a `hidden` student is shown to the whole class.
//
// Students never see this: who opted out is nobody else's business.

async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params
    const auth = await getSession()
    if (auth) {
      const access = await assertCanAccessSession(auth, sessionId)
      if (access.error) return access.error
      if (!access.isTutor) return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    } else if ((await recorderSessionId()) !== sessionId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    // Everyone who has joined this class gets an attendance row before their
    // join token is issued, so this covers every student who can be in the room.
    const students = await prisma.user.findMany({
      where: { attendances: { some: { sessionId } } },
      select: { id: true, recordingOptOut: true },
    })

    return NextResponse.json(
      {
        recorded: students.filter((s) => !s.recordingOptOut).map((s) => s.id),
        hidden: students.filter((s) => s.recordingOptOut).map((s) => s.id),
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    console.error("[GET /api/sessions/[id]/recording/privacy]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
