import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hostedBy } from "@/lib/session-access"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { getTutorAccess, tutorWrite, VIEW_ONLY_MESSAGE } from "@/lib/tutor-access"

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
      where: { id, ...hostedBy(session.sub) },
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
      where: { id, ...hostedBy(session.sub) },
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

    // The school's files (its library and its lessons) are view only for a
    // teacher an admin hasn't given the library to; their own uploads are fine.
    if (session.role === "TUTOR" && !(await getTutorAccess(session)).library) {
      const [schoolFile, lessonFile] = await Promise.all([
        prisma.libraryFile.findFirst({ where: { fileUrl: body.fileUrl, tutorId: { not: session.sub } }, select: { id: true } }),
        prisma.lessonAsset.findFirst({ where: { fileUrl: body.fileUrl }, select: { id: true } }),
      ])
      if (schoolFile || lessonFile) {
        return NextResponse.json({ message: VIEW_ONLY_MESSAGE.library }, { status: 403 })
      }
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
export const POST = withAudit(tutorWrite("calendar", handlePOST))
