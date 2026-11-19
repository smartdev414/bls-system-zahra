import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"

const MAX_PAGE_SIZE = 50

/**
 * Every approved student on the platform, a page at a time, for the pickers
 * that invite students to a class or put them on a course. With no `q` it
 * lists everyone (A–Z); `q` narrows by name or email. Pending and rejected
 * sign-ups are left out until they are approved.
 */
async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "students.view")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const params = req.nextUrl.searchParams
    const q = params.get("q")?.trim() ?? ""
    const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1)
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(params.get("pageSize") ?? "25", 10) || 25))

    const where = {
      role: "STUDENT" as const,
      status: "ACTIVE" as const,
      ...(q.length > 0 && {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }),
    }

    const [students, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, avatarUrl: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ])

    return NextResponse.json({ students, total, page, pageSize, hasMore: page * pageSize < total })
  } catch (err) {
    console.error("[GET /api/tutor/students/search]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
