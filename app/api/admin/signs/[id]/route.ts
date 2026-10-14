import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const body = await req.json() as {
      word?: string
      category?: string
      level?: import("@/app/generated/prisma/client").CourseLevel
      description?: string
      handshape?: string
      usage?: string
      showLevel?: boolean
      showHandshape?: boolean
      showUsage?: boolean
      videoUrl?: string | null
      imageUrl?: string | null
    }

    const sign = await prisma.sign.update({
      where: { id },
      data: {
        ...(body.word !== undefined && { word: body.word.trim() }),
        ...(body.category !== undefined && { category: body.category.trim() }),
        ...(body.level !== undefined && { level: body.level }),
        ...(body.description !== undefined && { description: body.description.trim() }),
        ...(body.handshape !== undefined && { handshape: body.handshape.trim() }),
        ...(body.usage !== undefined && { usage: body.usage.trim() }),
        ...(typeof body.showLevel === "boolean" && { showLevel: body.showLevel }),
        ...(typeof body.showHandshape === "boolean" && { showHandshape: body.showHandshape }),
        ...(typeof body.showUsage === "boolean" && { showUsage: body.showUsage }),
        ...(body.videoUrl !== undefined && { videoUrl: body.videoUrl?.trim() || null }),
        ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl?.trim() || null }),
      },
    })

    return NextResponse.json({ sign })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ message: "A sign with this word already exists" }, { status: 409 })
    }
    console.error("[PATCH /api/admin/signs/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    await prisma.sign.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/admin/signs/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
