import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { createNotification } from "@/lib/notifications"

// PATCH — review a student's step submission (pass/fail)
async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session || (session.role !== "ADMIN" && session.role !== "TUTOR")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: programId } = await params
    const { submissionId, status, reviewNote } = await req.json() as {
      submissionId: string
      status: "PASSED" | "FAILED"
      reviewNote?: string
    }

    if (!submissionId || !["PASSED", "FAILED"].includes(status)) {
      return NextResponse.json({ message: "submissionId and status (PASSED/FAILED) required" }, { status: 400 })
    }

    const submission = await prisma.certStepSubmission.findUnique({
      where: { id: submissionId },
      include: {
        enrollment: { select: { id: true, studentId: true, programId: true } },
        step: { select: { title: true } },
      },
    })

    if (!submission || submission.enrollment.programId !== programId) {
      return NextResponse.json({ message: "Submission not found" }, { status: 404 })
    }

    await prisma.certStepSubmission.update({
      where: { id: submissionId },
      data: {
        status,
        reviewerId: session.sub,
        reviewNote: reviewNote?.trim() || null,
        reviewedAt: new Date(),
      },
    })

    // Notify student
    void createNotification(
      submission.enrollment.studentId,
      "CERT_STEP_REVIEWED",
      status === "PASSED" ? "Step passed!" : "Step needs improvement",
      `Your submission for "${submission.step.title}" has been ${status === "PASSED" ? "approved" : "marked for revision"}${reviewNote ? `. Feedback: "${reviewNote.trim().slice(0, 100)}"` : ""}`,
      `/student/certifications/${submission.enrollment.programId}`,
    )

    // Check if all steps are now passed → issue certificate
    if (status === "PASSED") {
      const enrollment = await prisma.certEnrollment.findUnique({
        where: { id: submission.enrollment.id },
        include: {
          program: { include: { steps: true } },
          submissions: true,
        },
      })

      if (enrollment) {
        const allStepIds = new Set(enrollment.program.steps.map((s) => s.id))
        const passedStepIds = new Set(
          enrollment.submissions.filter((s) => s.status === "PASSED").map((s) => s.stepId)
        )
        // Include the just-passed one
        passedStepIds.add(submission.step.title) // Wait, need stepId not title
        // Re-check with the updated submission
        const updatedSubs = await prisma.certStepSubmission.findMany({
          where: { enrollmentId: enrollment.id, status: "PASSED" },
          select: { stepId: true },
        })
        const passedIds = new Set(updatedSubs.map((s) => s.stepId))

        const allPassed = [...allStepIds].every((id) => passedIds.has(id))

        if (allPassed && allStepIds.size > 0) {
          // Mark enrollment complete
          await prisma.certEnrollment.update({
            where: { id: enrollment.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          })

          // Issue certificate
          const student = await prisma.user.findUnique({
            where: { id: enrollment.studentId },
            select: { name: true },
          })

          const expiresAt = enrollment.program.validityMonths
            ? new Date(Date.now() + enrollment.program.validityMonths * 30 * 24 * 60 * 60 * 1000)
            : null

          const cert = await prisma.certificate.create({
            data: {
              enrollmentId: enrollment.id,
              studentName: student?.name ?? "Student",
              programTitle: enrollment.program.title,
              level: enrollment.program.level,
              expiresAt,
            },
          })

          void createNotification(
            enrollment.studentId,
            "CERT_COMPLETED",
            "Certification complete!",
            `Congratulations! You've earned your "${enrollment.program.title}" certification. Share your certificate with employers.`,
            `/student/certifications/${enrollment.programId}`,
          )
        }
      }
    }

    return NextResponse.json({ message: `Submission ${status.toLowerCase()}` })
  } catch (err) {
    console.error("[PATCH /api/admin/certifications/[id]/review]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
