import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"

// GET — public certificate verification (no auth required)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    const cert = await prisma.certificate.findUnique({
      where: { token },
      include: {
        enrollment: {
          include: {
            student: { select: { avatarUrl: true } },
            program: {
              include: {
                steps: { orderBy: { sortOrder: "asc" }, select: { title: true, type: true } },
              },
            },
          },
        },
      },
    })

    if (!cert) {
      return NextResponse.json({ message: "Certificate not found" }, { status: 404 })
    }

    const isExpired = cert.expiresAt ? cert.expiresAt < new Date() : false

    return NextResponse.json({
      certificate: {
        studentName: cert.studentName,
        studentAvatar: cert.enrollment.student.avatarUrl,
        programTitle: cert.programTitle,
        level: cert.level,
        issuedAt: cert.issuedAt.toISOString(),
        expiresAt: cert.expiresAt?.toISOString() ?? null,
        isExpired,
        isValid: !isExpired,
        steps: cert.enrollment.program.steps.map((s) => ({
          title: s.title,
          type: s.type,
        })),
      },
    })
  } catch (err) {
    console.error("[GET /api/verify/[token]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
