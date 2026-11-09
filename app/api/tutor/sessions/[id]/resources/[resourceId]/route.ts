import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostedBy } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { tutorWrite } from "@/lib/tutor-access"

async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; resourceId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, resourceId } = await params

    // Verify tutor owns the session
    const liveSession = await prisma.liveSession.findFirst({
      where: { id, ...hostedBy(session.sub) },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    await prisma.liveSessionResource.deleteMany({
      where: { id: resourceId, sessionId: id },
    })

    return NextResponse.json({ message: "Deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/sessions/[id]/resources/[resourceId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const DELETE = withAudit(tutorWrite("calendar", handleDELETE))
