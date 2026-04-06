import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getSession()
    if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const session = await prisma.liveSession.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        tutorId: true,
        durationMins: true,
        scheduledAt: true,
        tutor: { select: { name: true } },
        course: { select: { id: true, title: true } },
        resources: {
          select: { id: true, title: true, fileUrl: true, fileName: true, fileSize: true, mimeType: true },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { attendances: true } },
      },
    })

    if (!session) return NextResponse.json({ message: "Not found" }, { status: 404 })

    return NextResponse.json({ session })
  } catch (err) {
    console.error("[GET /api/sessions/[id]/info]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
