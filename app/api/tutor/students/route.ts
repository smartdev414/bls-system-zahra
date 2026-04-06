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

    // All enrollments in this tutor's courses, optionally filtered by student name/email
    const enrollments = await prisma.enrollment.findMany({
      where: {
        course: { tutorId: session.sub },
        ...(q ? {
          student: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          },
        } : {}),
      },
      include: {
        student: {
          select: { id: true, name: true, email: true, avatarUrl: true, bslLevel: true, createdAt: true },
        },
        course: { select: { id: true, title: true } },
        progress: true,
        _count: { select: { progress: true } },
      },
      orderBy: { enrolledAt: "desc" },
    })

    // Aggregate per student
    const studentMap = new Map<string, {
      id: string
      name: string
      email: string
      avatarUrl: string | null
      bslLevel: string | null
      joinedAt: string
      courses: Array<{
        id: string
        title: string
        enrolledAt: string
        totalLessons: number
        completedLessons: number
        completion: number
      }>
    }>()

    // Pre-fetch lesson counts per course
    const courseIds = [...new Set(enrollments.map((e) => e.courseId))]
    const courseLessonCounts = await Promise.all(
      courseIds.map(async (courseId) => {
        const count = await prisma.lesson.count({
          where: { section: { courseId } },
        })
        return { courseId, count }
      })
    )
    const lessonCountMap = new Map(courseLessonCounts.map((c) => [c.courseId, c.count]))

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

    const students = [...studentMap.values()]
    return NextResponse.json({ students, total: students.length })
  } catch (err) {
    console.error("[GET /api/tutor/students]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
