import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

// GET — single program with steps and enrollment stats
async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    const program = await prisma.certProgram.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { sortOrder: "asc" } },
        _count: { select: { enrollments: true } },
        enrollments: {
          include: {
            student: { select: { id: true, name: true, email: true, avatarUrl: true } },
            submissions: {
              include: { step: { select: { id: true, title: true, type: true } } },
            },
            certificate: { select: { id: true, token: true, issuedAt: true } },
          },
          orderBy: { enrolledAt: "desc" },
        },
      },
    })

    if (!program) return NextResponse.json({ message: "Not found" }, { status: 404 })

    return NextResponse.json({ program })
  } catch (err) {
    console.error("[GET /api/admin/certifications/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// PUT — update program details
async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json() as {
      title?: string
      description?: string | null
      level?: string
      status?: string
      price?: number
      imageUrl?: string | null
      validityMonths?: number | null
    }

    const program = await prisma.certProgram.update({
      where: { id },
      data: {
        ...(body.title?.trim() && { title: body.title.trim() }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.level && { level: body.level as import("@/app/generated/prisma/client").CourseLevel }),
        ...(body.status && { status: body.status as "DRAFT" | "PUBLISHED" | "ARCHIVED" }),
        ...(body.price !== undefined && { price: body.price }),
        ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
        ...(body.validityMonths !== undefined && { validityMonths: body.validityMonths }),
      },
    })

    return NextResponse.json({ program })
  } catch (err) {
    console.error("[PUT /api/admin/certifications/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE — delete program (only if no enrollments)
async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    const enrollmentCount = await prisma.certEnrollment.count({ where: { programId: id } })
    if (enrollmentCount > 0) {
      return NextResponse.json({ message: "Cannot delete a program with enrollments. Archive it instead." }, { status: 409 })
    }

    await prisma.certProgram.delete({ where: { id } })
    return NextResponse.json({ message: "Deleted" })
  } catch (err) {
    console.error("[DELETE /api/admin/certifications/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
export const DELETE = withAudit(handleDELETE)
