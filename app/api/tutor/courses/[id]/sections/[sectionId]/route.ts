import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: courseId, sectionId } = await params
    const { title } = await req.json() as { title: string }
    if (!title?.trim()) return NextResponse.json({ message: "Title is required" }, { status: 400 })

    const section = await prisma.section.findFirst({
      where: { id: sectionId, courseId },
      include: { course: { select: { tutorId: true } } },
    })

    if (!section) return NextResponse.json({ message: "Section not found" }, { status: 404 })
    if (section.course.tutorId !== session.sub) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const updated = await prisma.section.update({
      where: { id: sectionId },
      data: { title: title.trim() },
    })

    return NextResponse.json({ section: updated })
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
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: courseId, sectionId } = await params

    const section = await prisma.section.findFirst({
      where: { id: sectionId, courseId },
      include: { course: { select: { tutorId: true } } },
    })

    if (!section) return NextResponse.json({ message: "Section not found" }, { status: 404 })
    if (section.course.tutorId !== session.sub) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    await prisma.section.delete({ where: { id: sectionId } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/tutor/courses/[id]/sections/[sectionId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
