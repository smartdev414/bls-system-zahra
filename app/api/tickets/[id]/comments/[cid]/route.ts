import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleDELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { cid } = await params
    const comment = await prisma.ticketComment.findUnique({
      where: { id: cid },
      select: { authorId: true },
    })
    if (!comment) return NextResponse.json({ message: "Comment not found" }, { status: 404 })

    if (session.role !== "ADMIN" && comment.authorId !== session.sub) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    await prisma.ticketComment.delete({ where: { id: cid } })
    return NextResponse.json({ message: "Comment deleted" })
  } catch (err) {
    console.error("[DELETE /api/tickets/[id]/comments/[cid]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const DELETE = withAudit(handleDELETE)
