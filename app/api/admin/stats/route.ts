import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const [
      totalUsers,
      totalStudents,
      totalTutors,
      totalCourses,
      publishedCourses,
      totalEnrollments,
      totalSessions,
      liveSessions,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "STUDENT" } }),
      prisma.user.count({ where: { role: "TUTOR" } }),
      prisma.course.count(),
      prisma.course.count({ where: { status: "PUBLISHED" } }),
      prisma.enrollment.count(),
      prisma.liveSession.count(),
      prisma.liveSession.count({ where: { status: "LIVE" } }),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      }),
    ])

    // Enrollments last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const recentEnrollments = await prisma.enrollment.count({
      where: { enrolledAt: { gte: thirtyDaysAgo } },
    })

    return NextResponse.json({
      stats: {
        totalUsers,
        totalStudents,
        totalTutors,
        totalCourses,
        publishedCourses,
        totalEnrollments,
        recentEnrollments,
        totalSessions,
        liveSessions,
      },
      recentUsers: recentUsers.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error("[GET /api/admin/stats]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
