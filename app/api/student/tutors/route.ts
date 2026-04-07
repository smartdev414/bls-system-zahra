import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""

    const tutors = await prisma.user.findMany({
      where: {
        role: "TUTOR",
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { tutorProfile: { bio: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        tutorProfile: { select: { bio: true, qualifications: true, isVerified: true } },
        courses: {
          where: { status: "PUBLISHED" },
          select: {
            id: true,
            _count: { select: { enrollments: true } },
            reviews: { select: { rating: true } },
          },
        },
        _count: {
          select: {
            courses: { where: { status: "PUBLISHED" } },
            hostedSessions: true,
          },
        },
        receivedTutorReviews: {
          select: { rating: true },
        },
      },
      orderBy: { name: "asc" },
    })

    const shaped = tutors.map((t) => {
      const courseReviews = t.courses.flatMap((c) => c.reviews)
      const courseAvgRating =
        courseReviews.length > 0
          ? Math.round((courseReviews.reduce((s, r) => s + r.rating, 0) / courseReviews.length) * 10) / 10
          : null
      const studentCount = t.courses.reduce((s, c) => s + c._count.enrollments, 0)

      const tutorReviews = t.receivedTutorReviews
      const tutorAvgRating =
        tutorReviews.length > 0
          ? Math.round((tutorReviews.reduce((s, r) => s + r.rating, 0) / tutorReviews.length) * 10) / 10
          : null

      return {
        id: t.id,
        name: t.name,
        avatarUrl: t.avatarUrl,
        bio: t.tutorProfile?.bio ?? null,
        qualifications: t.tutorProfile?.qualifications ?? [],
        isVerified: t.tutorProfile?.isVerified ?? false,
        courseCount: t._count.courses,
        sessionCount: t._count.hostedSessions,
        studentCount,
        avgRating: tutorAvgRating ?? courseAvgRating,
        reviewCount: tutorReviews.length || courseReviews.length,
        joinedAt: t.createdAt.toISOString(),
      }
    })

    return NextResponse.json({ tutors: shaped, total: shaped.length })
  } catch (err) {
    console.error("[GET /api/student/tutors]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
