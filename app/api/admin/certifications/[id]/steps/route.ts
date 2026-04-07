import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

// POST — add a step to a certification program
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: programId } = await params
    const { title, description, type, config } = await req.json() as {
      title: string
      description?: string
      type: "QUIZ" | "VIDEO_SUBMISSION" | "LIVE_ASSESSMENT"
      config?: object
    }

    if (!title?.trim() || !type) {
      return NextResponse.json({ message: "Title and type are required" }, { status: 400 })
    }

    // Auto-assign next sort order
    const maxOrder = await prisma.certStep.aggregate({
      where: { programId },
      _max: { sortOrder: true },
    })

    const step = await prisma.certStep.create({
      data: {
        programId,
        title: title.trim(),
        description: description?.trim() || null,
        type,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        config: config ?? {},
      },
    })

    return NextResponse.json({ step }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/admin/certifications/[id]/steps]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// PUT — reorder steps or update a step
async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: programId } = await params
    const body = await req.json() as {
      // Single step update
      stepId?: string
      title?: string
      description?: string | null
      type?: string
      config?: object
      // Bulk reorder
      order?: string[] // step IDs in desired order
    }

    if (body.order) {
      // Reorder all steps
      await Promise.all(
        body.order.map((stepId, idx) =>
          prisma.certStep.update({ where: { id: stepId }, data: { sortOrder: idx } })
        )
      )
      return NextResponse.json({ message: "Reordered" })
    }

    if (body.stepId) {
      const step = await prisma.certStep.update({
        where: { id: body.stepId, programId },
        data: {
          ...(body.title?.trim() && { title: body.title.trim() }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.type && { type: body.type as "QUIZ" | "VIDEO_SUBMISSION" | "LIVE_ASSESSMENT" }),
          ...(body.config && { config: body.config }),
        },
      })
      return NextResponse.json({ step })
    }

    return NextResponse.json({ message: "stepId or order required" }, { status: 400 })
  } catch (err) {
    console.error("[PUT /api/admin/certifications/[id]/steps]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE — remove a step
async function handleDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session || session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id: programId } = await params
    const { stepId } = await req.json() as { stepId: string }

    if (!stepId) return NextResponse.json({ message: "stepId required" }, { status: 400 })

    await prisma.certStep.delete({ where: { id: stepId, programId } })
    return NextResponse.json({ message: "Deleted" })
  } catch (err) {
    console.error("[DELETE /api/admin/certifications/[id]/steps]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
export const PUT = withAudit(handlePUT)
export const DELETE = withAudit(handleDELETE)
