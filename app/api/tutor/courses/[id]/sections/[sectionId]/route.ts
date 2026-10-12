import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { can, courseContentScope } from "@/lib/permissions"
import { parseReleaseAt } from "@/lib/lesson-release"

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: courseId, sectionId } = await params
    // { title } renames; { releaseAt: ISO } locks the whole section until then
    // and { releaseAt: null } unlocks it — every lesson in it gets the date.
    const body = await req.json() as { title?: string; releaseAt?: string | null }
    const hasTitle = body.title !== undefined
    const hasRelease = body.releaseAt !== undefined
    if (hasTitle && !body.title?.trim()) return NextResponse.json({ message: "Title is required" }, { status: 400 })
    if (!hasTitle && !hasRelease) return NextResponse.json({ message: "Nothing to change" }, { status: 400 })

    const releaseAt = hasRelease ? parseReleaseAt(body.releaseAt) : undefined
    if (hasRelease && releaseAt === undefined) {
      return NextResponse.json({ message: "The unlock date is not a valid date" }, { status: 400 })
    }

    const section = await prisma.section.findFirst({
      where: { id: sectionId, courseId, course: courseContentScope(session) },
    })

    if (!section) return NextResponse.json({ message: "Section not found" }, { status: 404 })

    const updated = hasTitle
      ? await prisma.section.update({ where: { id: sectionId }, data: { title: body.title!.trim() } })
      : section
    if (hasRelease) {
      await prisma.lesson.updateMany({ where: { sectionId }, data: { releaseAt } })
    }

    return NextResponse.json({ section: updated, ok: true })
  } catch (err) {
    console.error("[PATCH /api/tutor/courses/[id]/sections/[sectionId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: courseId, sectionId } = await params

    const section = await prisma.section.findFirst({
      where: { id: sectionId, courseId, course: courseContentScope(session) },
    })

    if (!section) return NextResponse.json({ message: "Section not found" }, { status: 404 })

    await prisma.section.delete({ where: { id: sectionId } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/tutor/courses/[id]/sections/[sectionId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
