import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { can, courseContentScope } from "@/lib/permissions"

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    const lesson = await prisma.lesson.findFirst({
      where: { id, section: { course: courseContentScope(session) } },
    })
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    const body = await req.json() as {
      type: string
      title: string
      fileUrl: string
      fileName: string
      fileSize?: number
      mimeType?: string
    }

    const count = await prisma.lessonAsset.count({ where: { lessonId: id } })

    const asset = await prisma.lessonAsset.create({
      data: {
        lessonId: id,
        type: body.type as "VIDEO" | "PDF" | "IMAGE" | "AUDIO" | "SUBTITLE" | "DOCUMENT",
        title: body.title,
        fileUrl: body.fileUrl,
        fileName: body.fileName,
        fileSize: body.fileSize ?? null,
        mimeType: body.mimeType ?? null,
        order: count + 1,
      },
    })

    return NextResponse.json({ asset }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/lessons/[id]/assets]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
