import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { activity } from "@/lib/test-progress"
import { engagementOf, isOnline, latest } from "@/lib/engagement"
import {
  activeDays, canViewStudent, courseProgress, learningByDay, learningSummary, learningTimeline,
} from "@/lib/student-activity"

// GET /api/tutor/students/:id/activity — one student's sign-ins and learning,
// for the student activity page. Tutors see their own students; staff see all.
// IP addresses are shown to admins only.

const HEATMAP_DAYS = 84 // 12 weeks

const ukDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "students.view")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    if (!(await canViewStudent(session, id))) {
      return NextResponse.json({ message: "Student not found" }, { status: 404 })
    }

    const since = new Date(Date.now() - HEATMAP_DAYS * 24 * 60 * 60 * 1000)
    const showIp = session.role === "ADMIN"

    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [student, seen, summary, byDay, onDays, timeline, courses, logins, loginCount30d, failedCount30d] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id },
        select: {
          id: true, name: true, email: true, avatarUrl: true, bslLevel: true, status: true,
          createdAt: true, lastLoginAt: true, lastActiveAt: true,
        },
      }),
      activity([id]),
      learningSummary([id]),
      learningByDay(id, since),
      activeDays(id, since),
      learningTimeline(id, 60),
      courseProgress(id),
      prisma.loginEvent.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, createdAt: true, success: true, method: true, failureReason: true, client: true, ip: true, userAgent: true },
      }),
      prisma.loginEvent.count({ where: { userId: id, success: true, createdAt: { gte: monthAgo } } }),
      prisma.loginEvent.count({ where: { userId: id, success: false, createdAt: { gte: monthAgo } } }),
    ])

    const s = summary.get(id)!
    const lastSeen = latest(seen.get(id)?.lastSeenAt, student.lastActiveAt, student.lastLoginAt)

    // One cell per day, oldest first, for the 12-week calendar.
    const days: Array<{ date: string; active: boolean; learning: number; kinds: Record<string, number> }> = []
    for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
      const date = ukDay(new Date(Date.now() - i * 24 * 60 * 60 * 1000))
      if (days.length && days[days.length - 1].date === date) continue // clock change
      const kinds = byDay.get(date) ?? {}
      // "lesson-completed" is the same lesson as its "lesson" row; don't count it twice.
      const learning = Object.entries(kinds).reduce((n, [k, v]) => (k === "lesson-completed" ? n : n + (v ?? 0)), 0)
      days.push({ date, active: onDays.has(date) || learning > 0, learning, kinds })
    }

    return NextResponse.json({
      student: {
        ...student,
        createdAt: student.createdAt.toISOString(),
        lastLoginAt: student.lastLoginAt?.toISOString() ?? null,
        lastActiveAt: student.lastActiveAt?.toISOString() ?? null,
      },
      lastSeenAt: lastSeen?.toISOString() ?? null,
      lastStudiedAt: s.lastStudiedAt?.toISOString() ?? null,
      engagement: engagementOf({ lastSeenAt: lastSeen, lastStudiedAt: s.lastStudiedAt }),
      online: isOnline(student.lastActiveAt),
      last30: {
        daysActive: seen.get(id)?.activeDates.length ?? 0,
        daysStudied: s.studyDates.length,
        logins: loginCount30d,
        failedLogins: failedCount30d,
        ...s.counts,
      },
      days,
      courses,
      timeline,
      logins: logins.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
        ip: showIp ? l.ip : null,
      })),
    })
  } catch (err) {
    console.error("[GET /api/tutor/students/:id/activity]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
