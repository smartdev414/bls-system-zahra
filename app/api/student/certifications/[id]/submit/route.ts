import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { createNotification } from "@/lib/notifications"
import { issueCertificateIfComplete } from "@/lib/certification-complete"

// POST — submit a step (video upload, quiz result, or live assessment request)
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: programId } = await params
    const { stepId, data } = await req.json() as {
      stepId: string
      data: Record<string, any>  // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    if (!stepId) return NextResponse.json({ message: "stepId required" }, { status: 400 })

    // Verify enrollment exists
    const enrollment = await prisma.certEnrollment.findUnique({
      where: { studentId_programId: { studentId: session.sub, programId } },
    })
    if (!enrollment) return NextResponse.json({ message: "Not enrolled" }, { status: 403 })
    if (enrollment.status !== "ACTIVE") {
      return NextResponse.json({ message: "Enrollment is not active" }, { status: 400 })
    }

    // Verify step exists and belongs to this program
    const step = await prisma.certStep.findUnique({
      where: { id: stepId, programId },
      include: { program: { select: { title: true } } },
    })
    if (!step) return NextResponse.json({ message: "Step not found" }, { status: 404 })

    // Check previous steps are passed (enforce order)
    const allSteps = await prisma.certStep.findMany({
      where: { programId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, sortOrder: true },
    })
    const prevSteps = allSteps.filter((s) => s.sortOrder < step.sortOrder)
    if (prevSteps.length > 0) {
      const prevSubs = await prisma.certStepSubmission.findMany({
        where: {
          enrollmentId: enrollment.id,
          stepId: { in: prevSteps.map((s) => s.id) },
        },
      })
      const allPrevPassed = prevSteps.every((ps) =>
        prevSubs.find((sub) => sub.stepId === ps.id && sub.status === "PASSED")
      )
      if (!allPrevPassed) {
        return NextResponse.json({ message: "Complete previous steps first" }, { status: 400 })
      }
    }

    // Determine status based on step type
    let status: "PENDING" | "PASSED" = "PENDING"

    // COURSE_COMPLETION — auto-check if student completed all required courses
    if (step.type === "COURSE_COMPLETION") {
      const config = step.config as { courseId?: string; courses?: { courseId: string; courseTitle: string }[] }
      // Support both legacy single-course and new multi-course config
      const courseEntries = config.courses ?? (config.courseId ? [{ courseId: config.courseId, courseTitle: "" }] : [])
      if (courseEntries.length === 0) {
        return NextResponse.json({ message: "Step misconfigured — no courses set" }, { status: 400 })
      }

      const incomplete: string[] = []
      let totalAll = 0
      let completedAll = 0

      for (const entry of courseEntries) {
        const courseEnrollment = await prisma.enrollment.findFirst({
          where: { studentId: session.sub, courseId: entry.courseId },
          include: {
            progress: { where: { isCompleted: true } },
            course: { include: { sections: { include: { _count: { select: { lessons: true } } } } } },
          },
        })
        if (!courseEnrollment) {
          incomplete.push(entry.courseTitle || entry.courseId)
          continue
        }
        const total = courseEnrollment.course.sections.reduce((s, sec) => s + sec._count.lessons, 0)
        const completed = courseEnrollment.progress.length
        totalAll += total
        completedAll += completed
        if (total === 0 || completed < total) {
          incomplete.push(`${courseEnrollment.course.title} (${completed}/${total})`)
        }
      }

      if (incomplete.length > 0) {
        return NextResponse.json({
          message: `Complete all required courses first. Remaining: ${incomplete.join(", ")}`,
          status: "FAILED",
        }, { status: 400 })
      }

      status = "PASSED"
      data.completedLessons = completedAll
      data.totalLessons = totalAll
    }

    // QUIZ — auto-grade if score data provided
    if (step.type === "QUIZ" && data.score !== undefined) {
      const config = step.config as { passScore?: number }
      const passScore = config.passScore ?? 80
      status = (data.score as number) >= passScore ? "PASSED" : "PENDING" // PENDING = failed quiz, can retry
      if ((data.score as number) < passScore) {
        // For quiz, we set FAILED so student can retry
        await prisma.certStepSubmission.upsert({
          where: { enrollmentId_stepId: { enrollmentId: enrollment.id, stepId } },
          create: { enrollmentId: enrollment.id, stepId, status: "FAILED", data, submittedAt: new Date() },
          update: { status: "FAILED", data, submittedAt: new Date(), reviewerId: null, reviewNote: null, reviewedAt: null },
        })
        return NextResponse.json({ message: "Quiz score below pass threshold. Try again.", status: "FAILED" })
      }
    }

    // Upsert the submission
    const submission = await prisma.certStepSubmission.upsert({
      where: { enrollmentId_stepId: { enrollmentId: enrollment.id, stepId } },
      create: {
        enrollmentId: enrollment.id,
        stepId,
        status: (step.type === "QUIZ" || step.type === "COURSE_COMPLETION") ? status : "PENDING",
        data,
        submittedAt: new Date(),
      },
      update: {
        status: (step.type === "QUIZ" || step.type === "COURSE_COMPLETION") ? status : "PENDING",
        data,
        submittedAt: new Date(),
        reviewerId: null,
        reviewNote: null,
        reviewedAt: null,
      },
    })

    // A quiz or course-completion step can pass on its own; if it was the
    // last one, the certificate is issued now rather than waiting on a review.
    if (submission.status === "PASSED") await issueCertificateIfComplete(enrollment.id)

    // Notify admins only about submissions a person has to review (video,
    // live assessment) — the automatic steps need nobody.
    if (step.type === "VIDEO_SUBMISSION" || step.type === "LIVE_ASSESSMENT") {
      const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true },
      })
      for (const admin of admins) {
        void createNotification(
          admin.id,
          "CERT_SUBMISSION_RECEIVED",
          "New certification submission",
          `${session.name} submitted "${step.title}" for "${step.program.title}" — review required.`,
          `/admin/certifications/${programId}`,
        )
      }
    }

    return NextResponse.json({ submission, status: submission.status }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/student/certifications/[id]/submit]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
