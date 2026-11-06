import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { studentOwnSessions, studentVisibleSessions } from "@/lib/session-access"
import { isReleased } from "@/lib/lesson-release"
import { lessonKindKey } from "@/lib/lesson-kind"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }
    if (session.role !== "STUDENT") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      include: {
        // Only courses that are running count: an archived or unpublished
        // course drops out of the student's stats and "continue" card.
        enrollments: {
          where: { course: { status: "PUBLISHED" } },
          include: {
            course: {
              include: {
                tutor: { select: { name: true } },
                sections: {
                  orderBy: { order: "asc" },
                  // Every lesson counts towards the total; a locked one just
                  // cannot be the next to open.
                  include: { lessons: { orderBy: { order: "asc" }, include: { assets: { select: { type: true } } } } },
                },
              },
            },
            progress: true,
          },
        },
      },
    })

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 })
    }

    // Lessons: every lesson on the student's running courses counts towards
    // the total, ticked off by completing it.
    let totalLessons = 0
    let completedLessons = 0
    const releasedTestIds: string[] = []
    const now = new Date()

    for (const enrollment of user.enrollments) {
      const done = new Set(enrollment.progress.filter((p) => p.isCompleted).map((p) => p.lessonId))
      for (const section of enrollment.course.sections) {
        for (const lesson of section.lessons) {
          totalLessons++
          if (done.has(lesson.id)) completedLessons++
          if (lesson.type === "QUIZ" && isReleased(lesson, now)) releasedTestIds.push(lesson.id)
        }
      }
    }

    // Tests: counted the same way as the Tests page — released tests only, and
    // a test is passed by passing an attempt.
    const [passedTests, classesAttended] = await Promise.all([
      releasedTestIds.length > 0
        ? prisma.quizAttempt
            .findMany({
              where: { userId: session.sub, passed: true, lessonId: { in: releasedTestIds } },
              distinct: ["lessonId"],
              select: { lessonId: true },
            })
            .then((rows) => rows.length)
        : Promise.resolve(0),
      prisma.liveSessionAttendance.count({
        where: { studentId: session.sub, joinedAt: { not: null } },
      }),
    ])

    // ── Current course: enrollment with the most recent progress activity ──
    let currentCourse: {
      courseId: string
      courseTitle: string
      thumbnailUrl: string | null
      tutorName: string
      completion: number
      completedLessons: number
      totalLessons: number
      nextLesson: { id: string; title: string; type: string } | null
    } | null = null

    if (user.enrollments.length > 0) {
      // Pick the enrollment with the latest progress update, falling back to most recently enrolled
      const active = user.enrollments.slice().sort((a, b) => {
        const aLatest = a.progress.reduce((max, p) => Math.max(max, p.updatedAt.getTime()), 0)
        const bLatest = b.progress.reduce((max, p) => Math.max(max, p.updatedAt.getTime()), 0)
        if (aLatest !== bLatest) return bLatest - aLatest
        return b.enrolledAt.getTime() - a.enrolledAt.getTime()
      })[0]

      const allLessons = active.course.sections.flatMap((s) => s.lessons)
      const enrollTotal = allLessons.length
      const enrollCompleted = active.progress.filter((p) => p.isCompleted).length
      const completedIds = new Set(active.progress.filter((p) => p.isCompleted).map((p) => p.lessonId))
      const nextLesson = allLessons.find((l) => !completedIds.has(l.id) && isReleased(l)) ?? null

      currentCourse = {
        courseId: active.course.id,
        courseTitle: active.course.title,
        thumbnailUrl: active.course.thumbnailUrl,
        tutorName: active.course.tutor.name,
        completion: enrollTotal > 0 ? Math.round((enrollCompleted / enrollTotal) * 100) : 0,
        completedLessons: enrollCompleted,
        totalLessons: enrollTotal,
        nextLesson: nextLesson
          ? { id: nextLesson.id, title: nextLesson.title, type: lessonKindKey(nextLesson.type, nextLesson.assets) }
          : null,
      }
    }

    // Upcoming live sessions — include LIVE ones (even if scheduledAt is past) + future SCHEDULED
    const upcomingSessions = await prisma.liveSession.findMany({
      where: {
        AND: [
          {
            OR: [
              { status: "LIVE" },
              { status: "SCHEDULED", scheduledAt: { gte: new Date() } },
            ],
          },
          studentVisibleSessions(session.sub),
        ],
      },
      orderBy: [{ status: "desc" }, { scheduledAt: "asc" }],
      take: 4,
      include: { tutor: { select: { name: true } } },
    })

    // ── This week: the student's next class, the lessons to do, and the
    // recording of their last class — what a weekly-class student needs.
    const [nextClass, lastRecorded] = await Promise.all([
      prisma.liveSession.findFirst({
        where: {
          AND: [
            {
              OR: [
                { status: "LIVE" },
                // A class running late to start still counts as "next" for an hour.
                { status: "SCHEDULED", scheduledAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
              ],
            },
            studentOwnSessions(session.sub),
          ],
        },
        // LIVE sorts before SCHEDULED in the enum's descending order.
        orderBy: [{ status: "desc" }, { scheduledAt: "asc" }],
        include: { tutor: { select: { name: true } } },
      }),
      prisma.liveSession.findFirst({
        where: {
          status: "COMPLETED",
          recordingHidden: false,
          scheduledAt: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
          OR: [{ recordingUrl: { not: null } }, { recordingKey: { not: null } }],
          ...studentOwnSessions(session.sub),
        },
        orderBy: { scheduledAt: "desc" },
        select: { id: true, title: true, scheduledAt: true },
      }),
    ])

    // Homework: the next lessons that are open and not yet done, in course
    // order — on the course the student is working through first.
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000
    const homework: Array<{ id: string; title: string; type: string; courseTitle: string; isNew: boolean }> = []
    let homeworkLeft = 0
    const byActivity = user.enrollments.slice().sort((a, b) => {
      const aLatest = a.progress.reduce((max, p) => Math.max(max, p.updatedAt.getTime()), a.enrolledAt.getTime())
      const bLatest = b.progress.reduce((max, p) => Math.max(max, p.updatedAt.getTime()), b.enrolledAt.getTime())
      return bLatest - aLatest
    })
    for (const enrollment of byActivity) {
      const done = new Set(enrollment.progress.filter((p) => p.isCompleted).map((p) => p.lessonId))
      for (const lesson of enrollment.course.sections.flatMap((s) => s.lessons)) {
        if (done.has(lesson.id) || !isReleased(lesson, now)) continue
        homeworkLeft++
        if (homework.length < 3) {
          homework.push({
            id: lesson.id,
            title: lesson.title,
            type: lessonKindKey(lesson.type, lesson.assets),
            courseTitle: enrollment.course.title,
            isNew: !!lesson.releaseAt && now.getTime() - lesson.releaseAt.getTime() < WEEK_MS,
          })
        }
      }
    }

    // Trophies their teachers gave them, and the ones for finishing a course so far.
    const trophies = await prisma.trophy.findMany({
      where: { studentId: session.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, course: { select: { title: true } }, givenBy: { select: { name: true } } },
    })

    return NextResponse.json({
      student: { name: user.name, bslLevel: user.bslLevel },
      trophies: trophies.map((t) => ({
        id: t.id,
        courseTitle: t.course.title,
        givenBy: t.givenBy?.name ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
      thisWeek: {
        nextClass: nextClass
          ? {
              id: nextClass.id,
              title: nextClass.title,
              scheduledAt: nextClass.scheduledAt.toISOString(),
              durationMins: nextClass.durationMins,
              tutorName: nextClass.tutor.name,
              status: nextClass.status,
              inPerson: nextClass.inPerson,
              venue: nextClass.venue,
            }
          : null,
        homework,
        homeworkLeft,
        lastRecording: lastRecorded
          ? { id: lastRecorded.id, title: lastRecorded.title, scheduledAt: lastRecorded.scheduledAt.toISOString() }
          : null,
      },
      stats: {
        completedLessons,
        totalLessons,
        completion: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
        testsPassed: passedTests,
        totalTests: releasedTestIds.length,
        classesAttended,
      },
      currentCourse,
      upcomingSessions: upcomingSessions.map((s) => ({
        id: s.id,
        title: s.title,
        scheduledAt: s.scheduledAt.toISOString(),
        tutorName: s.tutor.name,
        status: s.status,
        inPerson: s.inPerson,
        venue: s.venue,
      })),
    })
  } catch (err) {
    console.error("[GET /api/student/dashboard]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
