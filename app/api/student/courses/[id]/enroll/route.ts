import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotification } from "@/lib/notifications"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: courseId } = await params

    const course = await prisma.course.findFirst({
      where: { id: courseId, status: "PUBLISHED" },
      include: { tutor: { select: { id: true } } },
    })
    if (!course) return NextResponse.json({ message: "Course not found" }, { status: 404 })

    const existing = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId },
    })
    if (existing) return NextResponse.json({ message: "Already enrolled" }, { status: 409 })

    const enrollment = await prisma.enrollment.create({
      data: { studentId: session.sub, courseId },
    })

    // Notify tutor
    void createNotification(
      course.tutor.id,
      "NEW_ENROLLMENT",
      "New student enrolled",
      `${session.name} enrolled in "${course.title}"`,
      `/tutor/courses/${courseId}`,
    )
    // Notify student (confirmation)
    void createNotification(
      session.sub,
      "NEW_ENROLLMENT",
      "Enrollment confirmed",
      `You're now enrolled in "${course.title}"`,
      `/student/lessons?courseId=${courseId}`,
    )

    return NextResponse.json({ enrollment }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/student/courses/[id]/enroll]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: courseId } = await params

    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId },
    })
    if (!enrollment) return NextResponse.json({ message: "Not enrolled" }, { status: 404 })

    await prisma.enrollment.delete({ where: { id: enrollment.id } })
    return NextResponse.json({ message: "Unenrolled successfully" })
  } catch (err) {
    console.error("[DELETE /api/student/courses/[id]/enroll]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
