import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const role = req.nextUrl.searchParams.get("role")?.toUpperCase()
    const q = req.nextUrl.searchParams.get("q")?.trim()
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1"))
    const limit = 20
    const skip = (page - 1) * limit

    const where = {
      ...(role ? { role: role as "STUDENT" | "TUTOR" | "ADMIN" } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          bslLevel: true,
          createdAt: true,
          tutorProfile: { select: { isVerified: true } },
          _count: { select: { enrollments: true, courses: true } },
        },
      }),
    ])

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        bslLevel: u.bslLevel,
        createdAt: u.createdAt.toISOString(),
        isVerified: u.tutorProfile?.isVerified ?? null,
        enrollmentCount: u._count.enrollments,
        courseCount: u._count.courses,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    console.error("[GET /api/admin/users]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
