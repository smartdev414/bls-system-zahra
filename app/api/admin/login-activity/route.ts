import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import type { Prisma } from "@/app/generated/prisma/client"
import type { Role } from "@/app/generated/prisma/enums"

// GET /api/admin/login-activity — every sign-in attempt on the platform, newest
// first, with headline numbers. Admins only.
//   ?result=success|failed  ?role=STUDENT|TUTOR|SUPPORT|ADMIN  ?q=name/email  ?page=

const ROLES: Role[] = ["STUDENT", "TUTOR", "SUPPORT", "ADMIN"]
const HOUR = 60 * 60 * 1000

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const sp = req.nextUrl.searchParams
    const page = Math.max(1, parseInt(sp.get("page") ?? "1") || 1)
    const limit = 50
    const result = sp.get("result")
    const role = ROLES.find((r) => r === sp.get("role"))
    const q = sp.get("q")?.trim()

    const where: Prisma.LoginEventWhereInput = {
      ...(result === "success" ? { success: true } : result === "failed" ? { success: false } : {}),
      ...(role ? { user: { role } } : {}),
      ...(q
        ? { OR: [
            { email: { contains: q, mode: "insensitive" } },
            { user: { name: { contains: q, mode: "insensitive" } } },
          ] }
        : {}),
    }

    const now = Date.now()
    const dayAgo = new Date(now - 24 * HOUR)
    const weekAgo = new Date(now - 7 * 24 * HOUR)

    const [total, events, loginsToday, failedToday, studentsWeek, studentsTotal, signedInWeek] = await Promise.all([
      prisma.loginEvent.count({ where }),
      prisma.loginEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, createdAt: true, email: true, success: true, method: true, failureReason: true,
          client: true, ip: true, userAgent: true,
          user: { select: { id: true, name: true, role: true } },
        },
      }),
      prisma.loginEvent.count({ where: { success: true, createdAt: { gte: dayAgo } } }),
      prisma.loginEvent.count({ where: { success: false, createdAt: { gte: dayAgo } } }),
      // Students on the platform this week, by page loads as well as sign-ins
      // (a 7-day cookie means many never sign in again within the week).
      prisma.user.count({ where: { role: "STUDENT", status: "ACTIVE", lastActiveAt: { gte: weekAgo } } }),
      prisma.user.count({ where: { role: "STUDENT", status: "ACTIVE" } }),
      prisma.loginEvent.findMany({
        where: { success: true, createdAt: { gte: weekAgo } },
        distinct: ["userId"],
        select: { userId: true },
      }),
    ])

    return NextResponse.json({
      events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      stats: {
        loginsToday,
        failedToday,
        peopleSignedInWeek: signedInWeek.length,
        studentsActiveWeek: studentsWeek,
        studentsTotal,
      },
    })
  } catch (err) {
    console.error("[GET /api/admin/login-activity]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
