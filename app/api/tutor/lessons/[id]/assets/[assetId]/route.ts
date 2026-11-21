import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { lessonEditScope } from "@/lib/tutor-access"

async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    // Admins, or a teacher with the "Lessons" switch on a course they teach.
    const scope = await lessonEditScope(session)
    if (!scope) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, assetId } = await params

    // Verify ownership via lesson → section → course
    const asset = await prisma.lessonAsset.findFirst({
      where: { id: assetId, lessonId: id, lesson: { section: { course: scope } } },
    })
    if (!asset) return NextResponse.json({ message: "Asset not found" }, { status: 404 })

    await prisma.lessonAsset.delete({ where: { id: assetId } })
    return NextResponse.json({ message: "Asset deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/lessons/[id]/assets/[assetId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

/** Turns "students can download this file" on or off. */
async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    // Admins, or a teacher with the "Lessons" switch on a course they teach.
    const scope = await lessonEditScope(session)
    if (!scope) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, assetId } = await params
    const body = await req.json().catch(() => ({})) as { allowDownload?: unknown }
    if (typeof body.allowDownload !== "boolean") {
      return NextResponse.json({ message: "allowDownload must be true or false" }, { status: 400 })
    }

    const asset = await prisma.lessonAsset.findFirst({
      where: { id: assetId, lessonId: id, lesson: { section: { course: scope } } },
      select: { id: true },
    })
    if (!asset) return NextResponse.json({ message: "Asset not found" }, { status: 404 })

    const updated = await prisma.lessonAsset.update({
      where: { id: assetId },
      data: { allowDownload: body.allowDownload },
    })
    return NextResponse.json({ asset: updated })
  } catch (err) {
    console.error("[PATCH /api/tutor/lessons/[id]/assets/[assetId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const DELETE = withAudit(handleDELETE)
export const PATCH = withAudit(handlePATCH)
