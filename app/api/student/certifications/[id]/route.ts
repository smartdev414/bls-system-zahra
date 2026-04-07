import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

// GET — student's detailed view of a certification program
async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: programId } = await params

    const program = await prisma.certProgram.findUnique({
      where: { id: programId, status: "PUBLISHED" },
      include: {
        steps: { orderBy: { sortOrder: "asc" } },
        _count: { select: { enrollments: true } },
      },
    })

    if (!program) return NextResponse.json({ message: "Not found" }, { status: 404 })

    const enrollment = await prisma.certEnrollment.findUnique({
      where: { studentId_programId: { studentId: session.sub, programId } },
      include: {
        submissions: {
          include: { step: { select: { id: true, title: true } } },
          orderBy: { createdAt: "desc" },
        },
        certificate: true,
      },
    })

    const submissionMap = new Map(
      (enrollment?.submissions ?? []).map((s) => [s.stepId, s])
    )

    return NextResponse.json({
      program: {
        id: program.id,
        title: program.title,
        description: program.description,
        level: program.level,
        price: program.price,
        imageUrl: program.imageUrl,
        validityMonths: program.validityMonths,
        enrollmentCount: program._count.enrollments,
        steps: program.steps.map((step) => {
          const sub = submissionMap.get(step.id)
          return {
            id: step.id,
            title: step.title,
            description: step.description,
            type: step.type,
            sortOrder: step.sortOrder,
            config: step.config,
            submission: sub
              ? {
                  id: sub.id,
                  status: sub.status,
                  data: sub.data,
                  reviewNote: sub.reviewNote,
                  submittedAt: sub.submittedAt?.toISOString() ?? null,
                  reviewedAt: sub.reviewedAt?.toISOString() ?? null,
                }
              : null,
          }
        }),
      },
      enrollment: enrollment
        ? {
            id: enrollment.id,
            status: enrollment.status,
            enrolledAt: enrollment.enrolledAt.toISOString(),
            completedAt: enrollment.completedAt?.toISOString() ?? null,
            certificate: enrollment.certificate
              ? {
                  token: enrollment.certificate.token,
                  issuedAt: enrollment.certificate.issuedAt.toISOString(),
                  expiresAt: enrollment.certificate.expiresAt?.toISOString() ?? null,
                }
              : null,
          }
        : null,
    })
  } catch (err) {
    console.error("[GET /api/student/certifications/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// POST — enroll in a certification program
async function handlePOST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: programId } = await params

    const program = await prisma.certProgram.findUnique({
      where: { id: programId, status: "PUBLISHED" },
      include: { steps: { orderBy: { sortOrder: "asc" } } },
    })

    if (!program) return NextResponse.json({ message: "Program not found" }, { status: 404 })

    // Check if already enrolled
    const existing = await prisma.certEnrollment.findUnique({
      where: { studentId_programId: { studentId: session.sub, programId } },
    })
    if (existing) {
      return NextResponse.json({ message: "Already enrolled" }, { status: 409 })
    }

    // Create enrollment + stub submissions for each step
    const enrollment = await prisma.certEnrollment.create({
      data: {
        studentId: session.sub,
        programId,
        submissions: {
          create: program.steps.map((step) => ({
            stepId: step.id,
            status: "NOT_STARTED",
          })),
        },
      },
    })

    return NextResponse.json({ enrollment }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/student/certifications/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
