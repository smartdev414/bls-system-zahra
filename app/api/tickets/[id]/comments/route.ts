import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true, submitterId: true } })
    if (!ticket) return NextResponse.json({ message: "Ticket not found" }, { status: 404 })

    // Only admin or the submitter can comment
    if (session.role !== "ADMIN" && ticket.submitterId !== session.sub) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { content } = await req.json() as { content: string }
    if (!content?.trim()) return NextResponse.json({ message: "Content is required" }, { status: 400 })

    const comment = await prisma.ticketComment.create({
      data: { ticketId: id, authorId: session.sub, content: content.trim() },
      include: { author: { select: { id: true, name: true, role: true, avatarUrl: true } } },
    })

    return NextResponse.json({ comment }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tickets/[id]/comments]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
