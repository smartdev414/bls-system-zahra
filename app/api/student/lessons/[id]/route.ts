import { NextResponse } from "next/server"
import { freePreviewOpen } from "@/lib/course-visibility"
import { COURSE_CLOSED_MESSAGE, isCourseClosed } from "@/lib/course-closing"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { isReleased, releaseLabel } from "@/lib/lesson-release"
import { lessonKindKey } from "@/lib/lesson-kind"
import { urlsHiddenFromStudents } from "@/lib/background-clean"

async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: {
        assets: { orderBy: { order: "asc" } },
        section: {
          include: {
            course: {
              include: {
                tutor: {
                  select: {
                    id: true,
                    name: true,
                    avatarUrl: true,
                    tutorProfile: { select: { bio: true, qualifications: true } },
                  },
                },
                sections: {
                  orderBy: { order: "asc" },
                  include: {
                    lessons: { orderBy: { order: "asc" }, include: { assets: { select: { type: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!lesson) {
      return NextResponse.json({ message: "Lesson not found" }, { status: 404 })
    }

    // The course has finished: nothing on it can be opened any more.
    if (isCourseClosed(lesson.section.course)) {
      return NextResponse.json({ message: COURSE_CLOSED_MESSAGE, closed: true }, { status: 403 })
    }

    // Verify student is enrolled
    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId: lesson.section.courseId },
      include: { progress: true },
    })

    if (!enrollment && !freePreviewOpen(lesson, lesson.section.course)) {
      return NextResponse.json({ message: "Not enrolled in this course" }, { status: 403 })
    }

    // A lesson held back for a later release is locked: the student sees it in
    // the outline with its date, but cannot open it until then. Checked after
    // enrolment so someone not on the course learns nothing about it.
    const now = new Date()
    if (!isReleased(lesson, now)) {
      return NextResponse.json(
        {
          message: `This lesson unlocks on ${releaseLabel(lesson.releaseAt!)}`,
          locked: true,
          releaseAt: lesson.releaseAt!.toISOString(),
          courseId: lesson.section.course.id,
        },
        { status: 403 },
      )
    }

    // Build ordered flat list of all lessons for prev/next navigation. A locked
    // neighbour is still listed, so the page can say when it opens.
    const allLessons = lesson.section.course.sections.flatMap((s) =>
      s.lessons.map((l) => {
        const locked = !isReleased(l, now)
        return { id: l.id, sectionId: s.id, title: l.title, locked, releaseAt: locked ? l.releaseAt!.toISOString() : null }
      })
    )
    const currentIndex = allLessons.findIndex((l) => l.id === id)
    const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null
    const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null

    const progress = enrollment?.progress.find((p) => p.lessonId === id) ?? null

    // Per-section completion for sidebar
    const sections = lesson.section.course.sections.map((section) => ({
      id: section.id,
      title: section.title,
      order: section.order,
      lessons: section.lessons.map((l) => {
        const prog = enrollment?.progress.find((p) => p.lessonId === l.id)
        const locked = !isReleased(l, now)
        return {
          id: l.id,
          title: l.title,
          type: l.type,
          kind: lessonKindKey(l.type, l.assets),
          order: l.order,
          isFree: l.isFree,
          isCompleted: prog?.isCompleted ?? false,
          isCurrent: l.id === id,
          locked,
          releaseAt: locked ? l.releaseAt!.toISOString() : null,
        }
      }),
    }))

    const totalLessons = allLessons.length
    const completedCount = enrollment?.progress.filter((p) => p.isCompleted).length ?? 0

    const hiddenUrls = await urlsHiddenFromStudents(lesson.assets.map((asset) => asset.fileUrl))

    return NextResponse.json({
      lesson: {
        id: lesson.id,
        title: lesson.title,
        type: lesson.type,
        description: lesson.description,
        isFree: lesson.isFree,
        // A recording whose background is still being replaced isn't shown yet.
        assets: lesson.assets.filter((asset) => !hiddenUrls.has(asset.fileUrl)),
        videoPending: hiddenUrls.size > 0,
        isCompleted: progress?.isCompleted ?? false,
        watchedSecs: progress?.watchedSecs ?? 0,
      },
      course: {
        id: lesson.section.course.id,
        title: lesson.section.course.title,
        tutor: lesson.section.course.tutor,
      },
      section: {
        id: lesson.section.id,
        title: lesson.section.title,
      },
      navigation: {
        prev: prevLesson,
        next: nextLesson,
        currentIndex: currentIndex + 1,
        total: totalLessons,
      },
      progress: {
        completedLessons: completedCount,
        totalLessons,
        completion: totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0,
      },
      sections,
      enrollmentId: enrollment?.id ?? null,
    })
  } catch (err) {
    console.error("[GET /api/student/lessons/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
