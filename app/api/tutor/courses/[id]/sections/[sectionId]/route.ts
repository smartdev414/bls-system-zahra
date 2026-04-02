import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: courseId, sectionId } = await params

    // Verify ownership via course
    const section = await prisma.section.findFirst({
      where: { id: sectionId, courseId },
      include: { course: { select: { tutorId: true } } },
    })

    if (!section) return NextResponse.json({ message: "Section not found" }, { status: 404 })
    if (section.course.tutorId !== session.sub) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    // Cascade deletes lessons + assets via schema onDelete: Cascade
    await prisma.section.delete({ where: { id: sectionId } })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/tutor/courses/[id]/sections/[sectionId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
