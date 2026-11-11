import { openCourses } from "@/lib/course-closing"
import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { releasedLessons } from "@/lib/lesson-release"
import { inBackground } from "@/lib/push"
import { awardIfFinished } from "@/lib/trophies"

async function handlePATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: lessonId } = await params
    const body = await req.json() as { watchedSecs?: number; isCompleted?: boolean; enrollmentId: string }

    const { enrollmentId, watchedSecs, isCompleted } = body
    if (!enrollmentId) {
      return NextResponse.json({ message: "enrollmentId is required" }, { status: 400 })
    }

    // Verify enrollment belongs to this student
    const enrollment = await prisma.enrollment.findFirst({
      // Not on a course that has finished (lib/course-closing.ts).
      where: { id: enrollmentId, studentId: session.sub, course: openCourses() },
    })
    if (!enrollment) return NextResponse.json({ message: "Enrollment not found" }, { status: 404 })

    // Progress only counts for a lesson on that course which has been released.
    const lesson = await prisma.lesson.findFirst({
      where: { id: lessonId, section: { courseId: enrollment.courseId }, ...releasedLessons() },
      select: { id: true, type: true },
    })
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    // A test is completed by passing it (the attempt route records that), so it
    // cannot be ticked off — or un-ticked — by hand.
    if (lesson.type === "QUIZ" && typeof isCompleted === "boolean") {
      return NextResponse.json({ message: "A test is completed by passing it" }, { status: 400 })
    }

    const data: Record<string, unknown> = { updatedAt: new Date() }
    if (typeof watchedSecs === "number") data.watchedSecs = watchedSecs
    if (typeof isCompleted === "boolean") {
      data.isCompleted = isCompleted
      if (isCompleted) data.completedAt = new Date()
    }

    const progress = await prisma.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
      create: {
        enrollmentId,
        lessonId,
        watchedSecs: watchedSecs ?? 0,
        isCompleted: isCompleted ?? false,
        completedAt: isCompleted ? new Date() : null,
      },
      update: data,
    })

    // Their last lesson may have finished the course so far: a trophy is due.
    if (isCompleted === true) inBackground(() => awardIfFinished(session.sub, enrollment.courseId))

    return NextResponse.json({ progress })
  } catch (err) {
    console.error("[PATCH /api/student/lessons/[id]/progress]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
