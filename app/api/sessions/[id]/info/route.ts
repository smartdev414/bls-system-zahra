import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET(
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
        status: true,
        tutorId: true,
        tutor: { select: { name: true } },
        course: { select: { id: true, title: true } },
      },
    })

    if (!session) return NextResponse.json({ message: "Not found" }, { status: 404 })

    return NextResponse.json({ session })
  } catch (err) {
    console.error("[GET /api/sessions/[id]/info]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
