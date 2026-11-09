import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostedBy } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { tutorWrite } from "@/lib/tutor-access"
import { announceHandouts } from "@/lib/class-handouts"

type Ctx = { params: Promise<{ id: string; handoutId: string }> }

/** The handout, when it belongs to a class the signed-in tutor runs. */
async function ownHandout(params: Ctx["params"]) {
  const session = await getSession()
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) }
  if (session.role !== "TUTOR" && session.role !== "ADMIN") {
    return { error: NextResponse.json({ message: "Forbidden" }, { status: 403 }) }
  }
  const { id, handoutId } = await params
  const handout = await prisma.classHandout.findFirst({
    where: { id: handoutId, sessionId: id, session: hostedBy(session.sub) },
    select: { id: true, sessionId: true },
  })
  if (!handout) return { error: NextResponse.json({ message: "Handout not found" }, { status: 404 }) }
  return { handout }
}

// Moves when a handout opens.
async function handlePATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { handout, error } = await ownHandout(params)
    if (error) return error
    const body = await req.json().catch(() => ({})) as { releaseAt?: string }
    const releaseAt = new Date(body.releaseAt ?? "")
    if (isNaN(releaseAt.getTime())) return NextResponse.json({ message: "Pick a valid date and time" }, { status: 400 })

    const updated = await prisma.classHandout.update({ where: { id: handout.id }, data: { releaseAt } })
    if (releaseAt <= new Date()) await announceHandouts(new Date(), handout.sessionId)
    return NextResponse.json({ handout: updated })
  } catch (err) {
    console.error("[PATCH /api/tutor/sessions/[id]/handouts/[handoutId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { handout, error } = await ownHandout(params)
    if (error) return error
    await prisma.classHandout.delete({ where: { id: handout.id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/tutor/sessions/[id]/handouts/[handoutId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(tutorWrite("calendar", handlePATCH))
export const DELETE = withAudit(tutorWrite("calendar", handleDELETE))
