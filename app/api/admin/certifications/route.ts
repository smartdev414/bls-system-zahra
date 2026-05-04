import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

// GET — list all certification programs (admin)
async function handleGET() {
  try {
    const session = await getSession()
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const programs = await prisma.certProgram.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { steps: true, enrollments: true } },
        enrollments: {
          where: { status: "COMPLETED" },
          select: { id: true },
        },
      },
    })

    return NextResponse.json({
      programs: programs.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        level: p.level,
        status: p.status,
        price: p.price,
        imageUrl: p.imageUrl,
        validityMonths: p.validityMonths,
        stepCount: p._count.steps,
        enrollmentCount: p._count.enrollments,
        completedCount: p.enrollments.length,
        createdAt: p.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error("[GET /api/admin/certifications]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// POST — create a new certification program
async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { title, description, level, price, imageUrl, validityMonths } = await req.json() as {
      title: string
      description?: string
      level?: string
      price?: number
      imageUrl?: string
      validityMonths?: number | null
    }

    if (!title?.trim()) {
      return NextResponse.json({ message: "Title is required" }, { status: 400 })
    }

    const program = await prisma.certProgram.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        level: (level as import("@/app/generated/prisma/client").CourseLevel) || "L1",
        price: price ?? 0,
        imageUrl: imageUrl || null,
        validityMonths: validityMonths ?? null,
      },
    })

    return NextResponse.json({ program }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/admin/certifications]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
