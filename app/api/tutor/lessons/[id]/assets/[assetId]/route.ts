import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, assetId } = await params

    // Verify ownership via lesson → section → course
    const asset = await prisma.lessonAsset.findFirst({
      where: { id: assetId, lessonId: id, lesson: { section: { course: { tutorId: session.sub } } } },
    })
    if (!asset) return NextResponse.json({ message: "Asset not found" }, { status: 404 })

    await prisma.lessonAsset.delete({ where: { id: assetId } })
    return NextResponse.json({ message: "Asset deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/lessons/[id]/assets/[assetId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const DELETE = withAudit(handleDELETE)
