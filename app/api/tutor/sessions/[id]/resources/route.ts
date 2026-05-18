import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    const liveSession = await prisma.liveSession.findFirst({
      where: { id, tutorId: session.sub },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const resources = await prisma.liveSessionResource.findMany({
      where: { sessionId: id, title: { not: "__presentation__" } },
      orderBy: { createdAt: "asc" },
    })

    return NextResponse.json({ resources })
  } catch (err) {
    console.error("[GET /api/tutor/sessions/[id]/resources]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params

    const liveSession = await prisma.liveSession.findFirst({
      where: { id, tutorId: session.sub },
    })
    if (!liveSession) return NextResponse.json({ message: "Session not found" }, { status: 404 })

    const body = await req.json() as {
      title: string
      fileUrl: string
      fileName: string
      fileSize?: number
      mimeType?: string
      presentationUrl?: string
      presentationMimeType?: string
    }

    if (!body.fileUrl || !body.fileName) {
      return NextResponse.json({ message: "fileUrl and fileName are required" }, { status: 400 })
    }

    const resource = await prisma.liveSessionResource.create({
      data: {
        sessionId: id,
        title: body.title || body.fileName,
        fileUrl: body.fileUrl,
        fileName: body.fileName,
        fileSize: body.fileSize ?? null,
        mimeType: body.mimeType ?? null,
        presentationUrl: body.presentationUrl ?? null,
        presentationMimeType: body.presentationMimeType ?? null,
      },
    })

    return NextResponse.json({ resource }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/sessions/[id]/resources]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
