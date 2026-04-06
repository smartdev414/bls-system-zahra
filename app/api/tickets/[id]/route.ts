import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { createNotification } from "@/lib/notifications"
import { TicketStatus, TicketPriority } from "@/app/generated/prisma/enums"

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        submitter: { select: { id: true, name: true, email: true, role: true, avatarUrl: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        attachments: { orderBy: { createdAt: "asc" } },
        comments: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, name: true, role: true, avatarUrl: true } } },
        },
      },
    })

    if (!ticket) return NextResponse.json({ message: "Ticket not found" }, { status: 404 })

    // Non-admins can only see their own tickets
    if (session.role !== "ADMIN" && ticket.submitterId !== session.sub) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json({ ticket })
  } catch (err) {
    console.error("[GET /api/tickets/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const body = await req.json() as {
      status?: string
      priority?: string
      assignedToId?: string | null
    }

    const existing = await prisma.ticket.findUnique({ where: { id }, select: { id: true, submitterId: true, status: true } })
    if (!existing) return NextResponse.json({ message: "Ticket not found" }, { status: 404 })

    const validStatuses: TicketStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]
    const validPriorities: TicketPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"]

    const data: Record<string, unknown> = {}
    if (body.status && validStatuses.includes(body.status as TicketStatus)) {
      data.status = body.status
      if (body.status === "RESOLVED" || body.status === "CLOSED") {
        data.resolvedAt = new Date()
      } else {
        data.resolvedAt = null
      }
    }
    if (body.priority && validPriorities.includes(body.priority as TicketPriority)) {
      data.priority = body.priority
    }
    if ("assignedToId" in body) {
      data.assignedToId = body.assignedToId ?? null
    }

    const ticket = await prisma.ticket.update({ where: { id }, data })

    // Notify submitter when status changes
    if (body.status && body.status !== existing.status) {
      const isResolved = body.status === "RESOLVED" || body.status === "CLOSED"
      void createNotification(
        existing.submitterId,
        isResolved ? "TICKET_RESOLVED" : "TICKET_UPDATED",
        isResolved ? "Your ticket has been resolved" : "Your ticket was updated",
        `Status changed to ${body.status.toLowerCase().replace("_", " ")}`,
        `/student/tickets/${id}`,
      )
    }

    return NextResponse.json({ ticket })
  } catch (err) {
    console.error("[PATCH /api/tickets/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handleDELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const ticket = await prisma.ticket.findUnique({ where: { id }, select: { submitterId: true } })
    if (!ticket) return NextResponse.json({ message: "Ticket not found" }, { status: 404 })

    // Admins can delete any ticket; submitters can delete their own OPEN tickets
    if (session.role !== "ADMIN" && ticket.submitterId !== session.sub) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    await prisma.ticket.delete({ where: { id } })
    return NextResponse.json({ message: "Ticket deleted" })
  } catch (err) {
    console.error("[DELETE /api/tickets/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PATCH = withAudit(handlePATCH)
export const DELETE = withAudit(handleDELETE)
