import prisma from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

/**
 * Once every step of a certification is passed, finish the enrolment and issue
 * the certificate. Called wherever a step can become PASSED — a reviewer
 * approving it, or a quiz / course-completion step passing on its own — and
 * safe to call more than once: a certificate is only ever issued once.
 *
 * Returns true when this call issued the certificate.
 */
export async function issueCertificateIfComplete(enrollmentId: string): Promise<boolean> {
  const enrollment = await prisma.certEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      program: { include: { steps: { select: { id: true } } } },
      submissions: { where: { status: "PASSED" }, select: { stepId: true } },
      certificate: { select: { id: true } },
    },
  })
  if (!enrollment || enrollment.certificate) return false

  const stepIds = enrollment.program.steps.map((s) => s.id)
  const passed = new Set(enrollment.submissions.map((s) => s.stepId))
  if (stepIds.length === 0 || !stepIds.every((id) => passed.has(id))) return false

  const student = await prisma.user.findUnique({
    where: { id: enrollment.studentId },
    select: { name: true },
  })

  let expiresAt: Date | null = null
  if (enrollment.program.validityMonths) {
    expiresAt = new Date()
    expiresAt.setMonth(expiresAt.getMonth() + enrollment.program.validityMonths)
  }

  // Two requests finishing at once must not both issue one: the certificate is
  // unique per enrolment, so the loser of that race simply stops here.
  try {
    await prisma.$transaction([
      prisma.certEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      }),
      prisma.certificate.create({
        data: {
          enrollmentId: enrollment.id,
          studentName: student?.name ?? "Student",
          programTitle: enrollment.program.title,
          level: enrollment.program.level,
          expiresAt,
        },
      }),
    ])
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return false
    throw err
  }

  void createNotification(
    enrollment.studentId,
    "CERT_COMPLETED",
    "Certification complete!",
    `Congratulations! You've earned your "${enrollment.program.title}" certification. Share your certificate with employers.`,
    `/student/certifications/${enrollment.programId}`,
  )
  return true
}
