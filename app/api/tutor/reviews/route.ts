import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const reviews = await prisma.tutorReview.findMany({
      where: { tutorId: session.sub },
      include: {
        student: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })

    const totalReviews = reviews.length
    const avgRating =
      totalReviews > 0
        ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / totalReviews) * 10) / 10
        : null

    const distribution = [0, 0, 0, 0, 0]
    for (const r of reviews) distribution[r.rating - 1]++

    return NextResponse.json({
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        student: r.student,
      })),
      stats: {
        totalReviews,
        avgRating,
        distribution,
      },
    })
  } catch (err) {
    console.error("[GET /api/tutor/reviews]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
