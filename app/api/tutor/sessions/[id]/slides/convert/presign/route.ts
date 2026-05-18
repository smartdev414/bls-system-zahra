import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { createPptxToPdfUpload } from "@/lib/cloudconvert"
import { withAudit } from "@/lib/audit"

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

    const body = (await req.json()) as { sourceFileName?: string }
    if (!body.sourceFileName) {
      return NextResponse.json({ message: "sourceFileName is required" }, { status: 400 })
    }

    const upload = await createPptxToPdfUpload(body.sourceFileName)

    return NextResponse.json(upload)
  } catch (err) {
    console.error("[POST /api/tutor/sessions/[id]/slides/convert/presign]", err)
    const message = err instanceof Error ? err.message : "Could not start conversion"
    return NextResponse.json({ message }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
