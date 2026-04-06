import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""

    const nameEmailFilter = q
      ? { OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ] }
      : {}

    // 1. All enrollments in this tutor's courses
    const enrollments = await prisma.enrollment.findMany({
      where: {
        course: { tutorId: session.sub },
        ...(q ? { student: nameEmailFilter } : {}),
      },
      include: {
        student: {
          select: { id: true, name: true, email: true, avatarUrl: true, bslLevel: true, createdAt: true },
        },
        course: { select: { id: true, title: true } },
        progress: true,
      },
      orderBy: { enrolledAt: "desc" },
    })

    // 2. Students invited by this tutor (accepted the invite — invitedById is set)
    const invitedStudents = await prisma.user.findMany({
      where: {
        invitedById: session.sub,
        ...nameEmailFilter,
      },
      select: { id: true, name: true, email: true, avatarUrl: true, bslLevel: true, createdAt: true },
    })
    const invitedStudentIds = new Set(invitedStudents.map((s) => s.id))

    // Pre-fetch lesson counts per course
    const courseIds = [...new Set(enrollments.map((e) => e.courseId))]
    const courseLessonCounts = await Promise.all(
      courseIds.map(async (courseId) => {
        const count = await prisma.lesson.count({ where: { section: { courseId } } })
        return { courseId, count }
      })
    )
    const lessonCountMap = new Map(courseLessonCounts.map((c) => [c.courseId, c.count]))

    // Build map from enrollments
    const studentMap = new Map<string, {
      id: string
      name: string
      email: string
      avatarUrl: string | null
      bslLevel: string | null
      joinedAt: string
      source: "enrolled" | "invited" | "both"
      courses: Array<{
        id: string
        title: string
        enrolledAt: string
        totalLessons: number
        completedLessons: number
        completion: number
      }>
    }>()

    for (const enrollment of enrollments) {
      const sid = enrollment.student.id
      const totalLessons = lessonCountMap.get(enrollment.courseId) ?? 0
      const completedLessons = enrollment.progress.filter((p) => p.isCompleted).length
      const completion = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0

      if (!studentMap.has(sid)) {
        studentMap.set(sid, {
          id: sid,
          name: enrollment.student.name,
          email: enrollment.student.email,
          avatarUrl: enrollment.student.avatarUrl,
          bslLevel: enrollment.student.bslLevel,
          joinedAt: enrollment.student.createdAt.toISOString(),
          source: invitedStudentIds.has(sid) ? "both" : "enrolled",
          courses: [],
        })
      }

      studentMap.get(sid)!.courses.push({
        id: enrollment.course.id,
        title: enrollment.course.title,
        enrolledAt: enrollment.enrolledAt.toISOString(),
        totalLessons,
        completedLessons,
        completion,
      })
    }

    // Merge invited students who are not yet enrolled in any course
    for (const student of invitedStudents) {
      if (!studentMap.has(student.id)) {
        studentMap.set(student.id, {
          id: student.id,
          name: student.name,
          email: student.email,
          avatarUrl: student.avatarUrl,
          bslLevel: student.bslLevel,
          joinedAt: student.createdAt.toISOString(),
          source: "invited",
          courses: [],
        })
      } else {
        // Already in map from enrollment — upgrade source
        studentMap.get(student.id)!.source = "both"
      }
    }

    const students = [...studentMap.values()]
    return NextResponse.json({ students, total: students.length })
  } catch (err) {
    console.error("[GET /api/tutor/students]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
