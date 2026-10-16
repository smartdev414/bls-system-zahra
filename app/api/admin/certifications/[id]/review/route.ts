import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { createNotification } from "@/lib/notifications"
import { issueCertificateIfComplete } from "@/lib/certification-complete"

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

    // Passing the last outstanding step finishes the certification.
    if (status === "PASSED") await issueCertificateIfComplete(submission.enrollment.id)

    return NextResponse.json({ message: `Submission ${status.toLowerCase()}` })
  } catch (err) {
    console.error("[PATCH /api/admin/certifications/[id]/review]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
