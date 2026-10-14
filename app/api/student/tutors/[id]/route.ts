import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { studentVisibleCourses } from "@/lib/course-visibility"

async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params

    const tutor = await prisma.user.findUnique({
      where: { id, role: "TUTOR" },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        tutorProfile: { select: { bio: true, qualifications: true, isVerified: true } },
      },
    })

    if (!tutor) return NextResponse.json({ message: "Tutor not found" }, { status: 404 })

    // Published courses with stats
    const courses = await prisma.course.findMany({
      // The courses this tutor leads, and the ones the school has put them on.
      where: {
        AND: [
          studentVisibleCourses(session.sub),
          { OR: [{ tutorId: id }, { teachers: { some: { tutorId: id } } }] },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        category: { select: { id: true, name: true } },
        reviews: { select: { rating: true } },
        _count: { select: { enrollments: true, sections: true } },
        sections: { include: { _count: { select: { lessons: true } } } },
      },
    })

    // Check which courses this student is enrolled in
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: session.sub, courseId: { in: courses.map((c) => c.id) } },
      select: {
        courseId: true,
        completedAt: true,
        progress: { where: { isCompleted: true }, select: { lessonId: true } },
      },
    })
    const enrollmentMap = new Map(
      enrollments.map((e) => [e.courseId, { completedAt: e.completedAt, completedLessons: e.progress.length }])
    )

    const allReviews = courses.flatMap((c) => c.reviews)
    const avgRating =
      allReviews.length > 0
        ? Math.round((allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length) * 10) / 10
        : null
    const studentCount = courses.reduce((s, c) => s + c._count.enrollments, 0)

    const [sessionCount, tutorReviews, myReview] = await Promise.all([
      prisma.liveSession.count({ where: { tutorId: id } }),
      prisma.tutorReview.findMany({
        where: { tutorId: id },
        include: { student: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.tutorReview.findUnique({
        where: { studentId_tutorId: { studentId: session.sub, tutorId: id } },
        select: { id: true, rating: true, comment: true },
      }),
    ])

    const tutorAvgRating = tutorReviews.length > 0
      ? Math.round((tutorReviews.reduce((s, r) => s + r.rating, 0) / tutorReviews.length) * 10) / 10
      : null

    const shapedCourses = courses.map((c) => {
      const lessonCount = c.sections.reduce((sum, s) => sum + s._count.lessons, 0)
      const courseAvg = c.reviews.length > 0
        ? Math.round((c.reviews.reduce((s, r) => s + r.rating, 0) / c.reviews.length) * 10) / 10
        : null
      const enrollment = enrollmentMap.get(c.id)
      const completedLessons = enrollment?.completedLessons ?? 0
      const completion = lessonCount > 0 ? Math.round((completedLessons / lessonCount) * 100) : 0

      return {
        id: c.id,
        title: c.title,
        description: c.description,
        thumbnailUrl: c.thumbnailUrl,
        level: c.level,
        category: c.category,
        enrollmentCount: c._count.enrollments,
        sectionCount: c._count.sections,
        lessonCount,
        avgRating: courseAvg,
        reviewCount: c.reviews.length,
        isEnrolled: enrollmentMap.has(c.id),
        progress: enrollment
          ? { completedLessons, totalLessons: lessonCount, completion, isCompleted: enrollment.completedAt !== null || completion >= 100 }
          : null,
      }
    })

    return NextResponse.json({
      tutor: {
        id: tutor.id,
        name: tutor.name,
        avatarUrl: tutor.avatarUrl,
        bio: tutor.tutorProfile?.bio ?? null,
        qualifications: tutor.tutorProfile?.qualifications ?? [],
        isVerified: tutor.tutorProfile?.isVerified ?? false,
        joinedAt: tutor.createdAt.toISOString(),
        stats: {
          courseCount: courses.length,
          studentCount,
          avgRating,
          reviewCount: allReviews.length,
          sessionCount,
          tutorAvgRating,
          tutorReviewCount: tutorReviews.length,
        },
      },
      courses: shapedCourses,
      myReview: myReview ? { id: myReview.id, rating: myReview.rating, comment: myReview.comment } : null,
      reviews: tutorReviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        student: r.student,
      })),
    })
  } catch (err) {
    console.error("[GET /api/student/tutors/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
