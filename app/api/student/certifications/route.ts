import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

// GET — browse available certifications + student's own enrollments
async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const [programs, enrollments] = await Promise.all([
      prisma.certProgram.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { steps: true, enrollments: true } },
          steps: { orderBy: { sortOrder: "asc" }, select: { id: true, type: true } },
        },
      }),
      prisma.certEnrollment.findMany({
        where: { studentId: session.sub },
        include: {
          program: { select: { id: true, title: true, level: true, imageUrl: true } },
          submissions: { select: { stepId: true, status: true } },
          certificate: { select: { token: true, issuedAt: true, expiresAt: true } },
        },
      }),
    ])

    const enrollmentMap = new Map(enrollments.map((e) => [e.programId, e]))

    return NextResponse.json({
      programs: programs.map((p) => {
        const enrollment = enrollmentMap.get(p.id)
        const passedCount = enrollment
          ? enrollment.submissions.filter((s) => s.status === "PASSED").length
          : 0
        return {
          id: p.id,
          title: p.title,
          description: p.description,
          level: p.level,
          price: p.price,
          imageUrl: p.imageUrl,
          stepCount: p._count.steps,
          enrollmentCount: p._count.enrollments,
          stepTypes: p.steps.map((s) => s.type),
          isEnrolled: !!enrollment,
          enrollment: enrollment
            ? {
                id: enrollment.id,
                status: enrollment.status,
                passedCount,
                totalSteps: p._count.steps,
                progress: p._count.steps > 0 ? Math.round((passedCount / p._count.steps) * 100) : 0,
                certificate: enrollment.certificate,
              }
            : null,
        }
      }),
    })
  } catch (err) {
    console.error("[GET /api/student/certifications]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
