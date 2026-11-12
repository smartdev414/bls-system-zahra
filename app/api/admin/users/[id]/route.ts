import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can, roleLabel, type AppRole } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"
import { createNotification } from "@/lib/notifications"
import { enrolStudents } from "@/lib/course-groups"
import { deleteStudentAnswerVideos } from "@/lib/test-recordings"
import { notifyReplaced } from "@/lib/single-session"
import { SUSPEND_REASON_MAX } from "@/lib/account-approval"
import { ACCESS_SELECT, accessFromProfile, accessToProfileData, type TutorAccess } from "@/lib/tutor-access"

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "users.edit")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params

    const body = await req.json() as {
      role?: AppRole
      isVerified?: boolean
      /** Approve or turn down a student who signed up on their own. */
      status?: "ACTIVE" | "REJECTED"
      /** Suspend a student (e.g. over behaviour) until staff lift it, or lift it. */
      suspended?: boolean
      /** Staff-only note on why — never shown to the student. */
      suspendedReason?: string
      /** Courses to put a student on as they are approved, so staff don't have to do it after. */
      courseIds?: string[]
      /** What this teacher may change; only the switches sent are saved. */
      access?: Partial<TutorAccess>
      /** Leave a student out of class recordings (safeguarding). Set by staff,
       *  so the student can't turn it off themselves. */
      recordingOptOut?: boolean
      /** Tidy up the name someone typed at sign-up. */
      name?: string
    }

    // Staff may fix their own name, but not their own role, access or status.
    const onlyName = Object.keys(body).every((k) => k === "name")
    if (id === session.sub && !onlyName) {
      return NextResponse.json({ message: "Cannot modify your own account" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return NextResponse.json({ message: "User not found" }, { status: 404 })

    // Handing out (or taking away) a staff role is admin-only — otherwise
    // support staff could promote themselves to full access.
    const touchesStaffRole =
      (body.role && (body.role === "ADMIN" || body.role === "SUPPORT")) ||
      user.role === "ADMIN" ||
      user.role === "SUPPORT"
    if (touchesStaffRole && !can(session.role, "users.assignStaffRole")) {
      return NextResponse.json(
        { message: `Only an administrator can change a ${roleLabel(user.role)} account` },
        { status: 403 },
      )
    }

    if (typeof body.name === "string") {
      const name = body.name.replace(/\s+/g, " ").trim()
      if (!name || name.length > 100) {
        return NextResponse.json({ message: "Please enter a name (up to 100 characters)" }, { status: 400 })
      }
      await prisma.user.update({ where: { id }, data: { name } })
    }

    if (body.role) {
      await prisma.user.update({ where: { id }, data: { role: body.role } })
      // Ensure TutorProfile exists if promoting to TUTOR
      if (body.role === "TUTOR") {
        await prisma.tutorProfile.upsert({
          where: { userId: id },
          create: { userId: id },
          update: {},
        })
      }
    }

    if (typeof body.isVerified === "boolean" && user.role === "TUTOR") {
      await prisma.tutorProfile.update({
        where: { userId: id },
        data: { isVerified: body.isVerified },
      })
    }

    if (body.access && typeof body.access === "object") {
      if (!can(session.role, "users.tutorAccess")) {
        return NextResponse.json({ message: "Only an administrator can change what a teacher may do" }, { status: 403 })
      }
      if (user.role !== "TUTOR") {
        return NextResponse.json({ message: "Only teachers have these settings" }, { status: 400 })
      }
      const data = accessToProfileData(body.access)
      await prisma.tutorProfile.upsert({ where: { userId: id }, create: { userId: id, ...data }, update: data })
    }

    if (typeof body.recordingOptOut === "boolean") {
      if (user.role !== "STUDENT") {
        return NextResponse.json({ message: "Only students are in class recordings" }, { status: 400 })
      }
      await prisma.user.update({
        where: { id },
        data: { recordingOptOut: body.recordingOptOut, recordingOptOutByStaff: body.recordingOptOut },
      })
    }

    if (typeof body.suspended === "boolean") {
      if (user.role !== "STUDENT") {
        return NextResponse.json({ message: "Only students can be suspended" }, { status: 400 })
      }
      if (body.suspended) {
        if (user.status === "PENDING" || user.status === "REJECTED") {
          return NextResponse.json({ message: "Approve or reject this sign-up instead" }, { status: 400 })
        }
        const reason = typeof body.suspendedReason === "string"
          ? body.suspendedReason.trim().slice(0, SUSPEND_REASON_MAX) || null
          : null
        await prisma.user.update({
          where: { id },
          data: { status: "SUSPENDED", suspendedAt: new Date(), suspendedReason: reason },
        })
        // Any open tab (including a live class) checks in and is moved to the
        // "account paused" page; the phone app does the same on its next call.
        await notifyReplaced(id)
      } else if (user.status === "SUSPENDED") {
        // Back exactly as they were: courses, groups and progress were never touched.
        await prisma.user.update({
          where: { id },
          data: { status: "ACTIVE", suspendedAt: null, suspendedReason: null },
        })
      }
    }

    if ((body.status === "ACTIVE" || body.status === "REJECTED") && body.status !== user.status && user.status !== "SUSPENDED") {
      if (user.role !== "STUDENT") {
        return NextResponse.json({ message: "Only student sign-ups are approved here" }, { status: 400 })
      }
      const courseIds = body.status === "ACTIVE" && Array.isArray(body.courseIds) ? body.courseIds : []
      if (courseIds.length > 0 && !can(session.role, "enrolments.manage")) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 })
      }
      const courses = courseIds.length > 0
        ? await prisma.course.findMany({
            where: { id: { in: courseIds }, status: { not: "ARCHIVED" } },
            select: { id: true, title: true, tutorId: true },
          })
        : []

      await prisma.user.update({ where: { id }, data: { status: body.status } })
      // The student is sitting on the waiting page (or will be next time they
      // sign in); the email is how they find out.
      if (body.status === "ACTIVE") {
        for (const course of courses) {
          // The approval email below names the courses, so no separate enrolment email.
          await enrolStudents(course, [id], session, { notifyStudents: false })
        }
        const onCourses = courses.map((c) => `"${c.title}"`).join(", ")
        void createNotification(
          id,
          "ACCOUNT_APPROVED",
          "Your account is approved",
          courses.length > 0
            ? `Welcome to Teach Me Sign! Your account has been approved and you've been added to ${onCourses} — sign in to start learning.`
            : "Welcome to Teach Me Sign! Your account has been approved — sign in to start learning.",
          courses.length === 1 ? `/student/lessons?courseId=${courses[0].id}` : "/student",
        )
      } else {
        void createNotification(
          id,
          "ACCOUNT_REJECTED",
          "Your account request was not approved",
          "We couldn't approve your account this time. If you think this is a mistake, please get in touch with us.",
        )
      }
    }

    const updated = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true, status: true, recordingOptOut: true,
        suspendedAt: true, suspendedReason: true,
        tutorProfile: { select: { isVerified: true, ...ACCESS_SELECT } },
      },
    })

    return NextResponse.json({
      user: updated && { ...updated, access: updated.role === "TUTOR" ? accessFromProfile(updated.tutorProfile) : null },
    })
  } catch (err) {
    console.error("[PATCH /api/admin/users/[id]]", err)
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
    if (!can(session.role, "users.delete")) return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    if (id === session.sub) {
      return NextResponse.json({ message: "Cannot delete your own account" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return NextResponse.json({ message: "User not found" }, { status: 404 })

    // Courses and hosted sessions carry other people's enrolments, attendance
    // and recordings, so they are never removed as a side effect of deleting
    // their tutor — the admin has to deal with them explicitly first.
    const [courseCount, sessionCount] = await Promise.all([
      prisma.course.count({ where: { tutorId: id } }),
      prisma.liveSession.count({ where: { tutorId: id } }),
    ])
    if (courseCount > 0 || sessionCount > 0) {
      const owned = [
        courseCount > 0 && `${courseCount} course${courseCount === 1 ? "" : "s"}`,
        sessionCount > 0 && `${sessionCount} live session${sessionCount === 1 ? "" : "s"}`,
      ].filter(Boolean).join(" and ")
      return NextResponse.json(
        { message: `${user.name} still owns ${owned}. Delete or reassign them before deleting this account.` },
        { status: 409 },
      )
    }

    // Most relations to User have no ON DELETE rule in the database, so a bare
    // user.delete fails on the first enrolment, message or review. Clear the
    // user's own records first; everything else cascades or nulls itself.
    await prisma.$transaction(async (tx) => {
      // Co-tutor invites this user sent stay valid — hand them to the host.
      const sentInvites = await tx.liveSessionCoTutor.findMany({
        where: { invitedById: id },
        select: { id: true, session: { select: { tutorId: true } } },
      })
      for (const invite of sentInvites) {
        await tx.liveSessionCoTutor.update({
          where: { id: invite.id },
          data: { invitedById: invite.session.tutorId },
        })
      }

      await tx.message.deleteMany({ where: { senderId: id } })
      await tx.conversation.deleteMany({ where: { OR: [{ studentId: id }, { tutorId: id }] } })
      await tx.ticketComment.deleteMany({ where: { authorId: id } })
      await tx.review.deleteMany({ where: { studentId: id } })
      await tx.tutorReview.deleteMany({ where: { OR: [{ studentId: id }, { tutorId: id }] } })
      await tx.sessionJoinRequest.deleteMany({ where: { studentId: id } })
      await tx.liveSessionAttendance.deleteMany({ where: { studentId: id } })
      await tx.enrollment.deleteMany({ where: { studentId: id } })
      await tx.certEnrollment.deleteMany({ where: { studentId: id } })
      await tx.user.delete({ where: { id } })
    })
    // Their recordings in tests went with their attempts; the files go too.
    if (user.role === "STUDENT") await deleteStudentAnswerVideos(id)
    return NextResponse.json({ message: "User deleted" })
  } catch (err) {
    console.error("[DELETE /api/admin/users/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
