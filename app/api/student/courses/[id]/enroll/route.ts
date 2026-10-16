import { NextResponse } from "next/server"
import { onStudentRemovedFromCourse } from "@/lib/course-groups"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { createNotification } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"

async function handlePOST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: courseId } = await params

    // Only public courses take self-enrolment; a private course is a class
    // that staff or its tutor put students on.
    const course = await prisma.course.findFirst({
      where: { id: courseId, status: "PUBLISHED", visibility: "PUBLIC" },
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

async function handleDELETE(
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
      include: { course: { select: { visibility: true } } },
    })
    if (!enrollment) return NextResponse.json({ message: "Not enrolled" }, { status: 404 })

    // A private course is the student's class — they could not enrol back on
    // to it, so leaving goes through their tutor or the office instead.
    if (enrollment.course.visibility !== "PUBLIC") {
      return NextResponse.json(
        { message: "This is your class course. Please ask your tutor if you need to leave it." },
        { status: 403 }
      )
    }

    await prisma.enrollment.delete({ where: { id: enrollment.id } })
    await onStudentRemovedFromCourse(courseId, session.sub)
    return NextResponse.json({ message: "Unenrolled successfully" })
  } catch (err) {
    console.error("[DELETE /api/student/courses/[id]/enroll]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
export const DELETE = withAudit(handleDELETE)
