import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostScope } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createNotifications } from "@/lib/notifications"
import { withAudit } from "@/lib/audit"
import { tutorWrite } from "@/lib/tutor-access"
import { notifySessionStatusChange } from "@/lib/live-session-status"
import { shiftWeeksAfterCancel } from "@/lib/class-week-shift"

// Students need to know which days are off, in the school's time.
const classDate = (d: Date) => d.toLocaleString("en-GB", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
})

/**
 * Cancels several scheduled classes at once — e.g. a weekly run set up with the
 * wrong dates. Classes that are live or already over are left alone. Each
 * student is told once, not once per class.
 */
async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.edit")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({})) as { ids?: unknown; note?: unknown }
    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : []
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null
    if (ids.length === 0) return NextResponse.json({ message: "No classes chosen" }, { status: 400 })

    const sessions = await prisma.liveSession.findMany({
      where: { id: { in: ids }, status: "SCHEDULED", ...hostScope(session) },
      orderBy: { scheduledAt: "asc" },
      select: { id: true, title: true, scheduledAt: true, tutorId: true, courseId: true, groupId: true, week: true, visibility: true },
    })
    if (sessions.length === 0) return NextResponse.json({ cancelled: 0 })

    await prisma.liveSession.updateMany({
      where: { id: { in: sessions.map((s) => s.id) }, status: "SCHEDULED" },
      data: { status: "CANCELLED", cancelNote: note, cancelledAt: new Date() },
    })

    // The lessons move on: the next class takes a cancelled class's week.
    const renumbered = await shiftWeeksAfterCancel(sessions)

    for (const s of sessions) void notifySessionStatusChange(s.id, "CANCELLED", s.title, s.tutorId)

    // Everyone who would have been told about any one of these classes.
    const inviteOnly = sessions.filter((s) => s.visibility === "INVITE_ONLY").map((s) => s.id)
    const courseIds = [...new Set(sessions.filter((s) => s.visibility !== "INVITE_ONLY" && s.courseId).map((s) => s.courseId!))]
    const [invites, enrollments] = await Promise.all([
      inviteOnly.length > 0
        ? prisma.liveSessionInvite.findMany({ where: { sessionId: { in: inviteOnly } }, select: { studentId: true } })
        : [],
      courseIds.length > 0
        ? prisma.enrollment.findMany({ where: { courseId: { in: courseIds } }, select: { studentId: true } })
        : [],
    ])
    const audienceIds = [...new Set([...invites, ...enrollments].map((r) => r.studentId))]
    if (audienceIds.length > 0) {
      const titles = [...new Set(sessions.map((s) => s.title))]
      void createNotifications(
        audienceIds,
        "SESSION_CANCELLED",
        sessions.length === 1 ? "Live session cancelled" : `${sessions.length} live sessions cancelled`,
        (sessions.length === 1
          ? `"${sessions[0].title}" on ${classDate(sessions[0].scheduledAt)} has been cancelled`
          : `${sessions.length} classes of "${titles.join('", "')}" have been cancelled: ${sessions.map((s) => classDate(s.scheduledAt)).join("; ")}`)
          + (note ? `. Note: ${note}` : ""),
        `/student/classroom`,
      )
    }

    return NextResponse.json({ cancelled: sessions.length, renumbered })
  } catch (err) {
    console.error("[POST /api/tutor/sessions/cancel]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(tutorWrite("calendar", handlePOST))
