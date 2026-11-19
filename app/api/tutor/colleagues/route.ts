import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { withAudit } from "@/lib/audit"

// Lists other tutors on the platform so a tutor can pick a co-teacher to invite
// to a live session. Excludes the requesting tutor. Optional `?q=` filters by
// name or email.

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "sessions.invite")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    const nameEmailFilter = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}

    const tutors = await prisma.user.findMany({
      // Support staff are listed too: they join a class as its interpreter.
      where: {
        role: { in: ["TUTOR", "SUPPORT"] },
        status: "ACTIVE",
        id: { not: session.sub },
        ...nameEmailFilter,
      },
      select: { id: true, name: true, email: true, avatarUrl: true, role: true },
      orderBy: [{ role: "desc" }, { name: "asc" }],
    })

    return NextResponse.json({ tutors, total: tutors.length })
  } catch (err) {
    console.error("[GET /api/tutor/colleagues]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
