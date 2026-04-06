import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { createNotifications } from "@/lib/notifications"
import { TicketType, TicketPriority } from "@/app/generated/prisma/enums"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const isAdmin = session.role === "ADMIN"
    const status = req.nextUrl.searchParams.get("status") ?? ""
    const type = req.nextUrl.searchParams.get("type") ?? ""
    const priority = req.nextUrl.searchParams.get("priority") ?? ""
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1"))
    const limit = 20
    const skip = (page - 1) * limit

    const where = {
      // Non-admins can only see their own tickets
      ...(!isAdmin ? { submitterId: session.sub } : {}),
      ...(status ? { status: status as "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" } : {}),
      ...(type ? { type: type as TicketType } : {}),
      ...(priority ? { priority: priority as TicketPriority } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    }

    const [total, tickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
        select: {
          id: true,
          title: true,
          type: true,
          priority: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
          submitter: { select: { id: true, name: true, email: true, role: true } },
          assignedTo: { select: { id: true, name: true } },
          _count: { select: { comments: true, attachments: true } },
        },
      }),
    ])

    return NextResponse.json({
      tickets: tickets.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        resolvedAt: t.resolvedAt?.toISOString() ?? null,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    console.error("[GET /api/tickets]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const body = await req.json() as {
      title: string
      description: string
      type: string
      attachments?: Array<{ fileUrl: string; fileName: string; fileSize?: number; mimeType?: string }>
    }

    if (!body.title?.trim()) return NextResponse.json({ message: "Title is required" }, { status: 400 })
    if (!body.description?.trim()) return NextResponse.json({ message: "Description is required" }, { status: 400 })

    const validTypes: TicketType[] = ["BUG", "FEATURE", "SUGGESTION", "OTHER"]
    const ticketType: TicketType = validTypes.includes(body.type as TicketType)
      ? (body.type as TicketType)
      : "OTHER"

    const ticket = await prisma.ticket.create({
      data: {
        submitterId: session.sub,
        title: body.title.trim(),
        description: body.description.trim(),
        type: ticketType,
        attachments: body.attachments?.length
          ? {
              createMany: {
                data: body.attachments.map((a) => ({
                  fileUrl: a.fileUrl,
                  fileName: a.fileName,
                  fileSize: a.fileSize ?? null,
                  mimeType: a.mimeType ?? null,
                })),
              },
            }
          : undefined,
      },
      include: {
        submitter: { select: { name: true, email: true } },
      },
    })

    // Notify all admins
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    })
    if (admins.length > 0) {
      void createNotifications(
        admins.map((a) => a.id),
        "TICKET_CREATED",
        `New ${ticketType.toLowerCase()} ticket`,
        `${ticket.submitter.name} submitted: "${ticket.title}"`,
        `/admin/tickets/${ticket.id}`,
      )
    }

    return NextResponse.json({ ticket }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tickets]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
