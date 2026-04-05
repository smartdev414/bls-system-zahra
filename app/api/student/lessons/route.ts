import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const courseId = searchParams.get("courseId")

    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: session.sub, ...(courseId ? { courseId } : {}) },
      include: {
        course: {
          include: {
            tutor: { select: { name: true, avatarUrl: true } },
            sections: {
              orderBy: { order: "asc" },
              include: {
                lessons: {
                  orderBy: { order: "asc" },
                  include: { assets: { orderBy: { order: "asc" } } },
                },
              },
            },
          },
        },
        progress: true,
      },
      orderBy: { enrolledAt: "asc" },
    })

    const courses = enrollments.map((enrollment) => {
      const allLessons = enrollment.course.sections.flatMap((s) => s.lessons)
      const totalLessons = allLessons.length
      const completedLessons = enrollment.progress.filter((p) => p.isCompleted).length

      // Find last accessed lesson (most recently updated progress)
      const lastProgress = enrollment.progress
        .filter((p) => p.updatedAt)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
      const lastLessonId = lastProgress?.lessonId ?? allLessons[0]?.id ?? null

      return {
        enrollmentId: enrollment.id,
        enrolledAt: enrollment.enrolledAt.toISOString(),
        course: {
          id: enrollment.course.id,
          title: enrollment.course.title,
          description: enrollment.course.description,
          thumbnailUrl: enrollment.course.thumbnailUrl,
          level: enrollment.course.level,
          tutor: enrollment.course.tutor,
        },
        stats: {
          totalLessons,
          completedLessons,
          completion: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
        },
        lastLessonId,
        sections: enrollment.course.sections.map((section) => ({
          id: section.id,
          title: section.title,
          order: section.order,
          lessons: section.lessons.map((lesson) => {
            const prog = enrollment.progress.find((p) => p.lessonId === lesson.id)
            return {
              id: lesson.id,
              title: lesson.title,
              type: lesson.type,
              order: lesson.order,
              isFree: lesson.isFree,
              duration: lesson.assets.find((a) => a.type === "VIDEO")?.duration ?? null,
              isCompleted: prog?.isCompleted ?? false,
              watchedSecs: prog?.watchedSecs ?? 0,
            }
          }),
        })),
      }
    })

    return NextResponse.json({ courses })
  } catch (err) {
    console.error("[GET /api/student/lessons]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
