import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const sp = req.nextUrl.searchParams
    const page     = Math.max(1, parseInt(sp.get("page") ?? "1"))
    const limit    = Math.min(100, Math.max(1, parseInt(sp.get("limit") ?? "50")))
    const skip     = (page - 1) * limit
    const method   = sp.get("method")?.toUpperCase() || undefined
    const path     = sp.get("path") || undefined
    const status   = sp.get("status") || undefined   // "2xx" | "4xx" | "5xx" | exact number
    const userId   = sp.get("userId") || undefined
    const from     = sp.get("from") || undefined
    const to       = sp.get("to") || undefined

    // Build status filter
    let statusFilter: object | undefined
    if (status) {
      if (status === "2xx") statusFilter = { gte: 200, lt: 300 }
      else if (status === "3xx") statusFilter = { gte: 300, lt: 400 }
      else if (status === "4xx") statusFilter = { gte: 400, lt: 500 }
      else if (status === "5xx") statusFilter = { gte: 500, lt: 600 }
      else {
        const n = parseInt(status)
        if (!isNaN(n)) statusFilter = { equals: n }
      }
    }

    const where = {
      ...(method   ? { method }                                          : {}),
      ...(path     ? { path: { contains: path, mode: "insensitive" as const } } : {}),
      ...(userId   ? { userId }                                          : {}),
      ...(statusFilter ? { statusCode: statusFilter }                    : {}),
      ...((from || to) ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to)   } : {}),
        },
      } : {}),
    }

    const [total, logs] = await Promise.all([
      prisma.apiLog.count({ where }),
      prisma.apiLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id:           true,
          method:       true,
          path:         true,
          statusCode:   true,
          userId:       true,
          userRole:     true,
          userEmail:    true,
          ip:           true,
          userAgent:    true,
          durationMs:   true,
          errorMessage: true,
          createdAt:    true,
        },
      }),
    ])

    return NextResponse.json({
      logs: logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    console.error("[GET /api/admin/audit-logs]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
