import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { createNotification } from "@/lib/notifications"

async function handlePOST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: tutorId } = await params
    const { rating, comment } = await req.json() as { rating: number; comment?: string }

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ message: "Rating must be between 1 and 5" }, { status: 400 })
    }

    // Verify tutor exists
    const tutor = await prisma.user.findUnique({ where: { id: tutorId, role: "TUTOR" }, select: { id: true, name: true } })
    if (!tutor) return NextResponse.json({ message: "Tutor not found" }, { status: 404 })

    // Student must be enrolled in at least one of this tutor's courses
    const enrollmentCount = await prisma.enrollment.count({
      where: { studentId: session.sub, course: { tutorId } },
    })
    if (enrollmentCount === 0) {
      return NextResponse.json({ message: "You must be enrolled in one of this tutor's courses to leave a review" }, { status: 403 })
    }

    // Upsert review (one per student per tutor)
    const review = await prisma.tutorReview.upsert({
      where: { studentId_tutorId: { studentId: session.sub, tutorId } },
      create: {
        studentId: session.sub,
        tutorId,
        rating,
        comment: comment?.trim() || null,
      },
      update: {
        rating,
        comment: comment?.trim() || null,
      },
    })

    // Notify tutor
    const stars = "★".repeat(rating) + "☆".repeat(5 - rating)
    void createNotification(
      tutorId,
      "NEW_TUTOR_REVIEW",
      "New review from a student",
      `${session.name} rated you ${stars}${comment ? `: "${comment.trim().slice(0, 80)}"` : ""}`,
      "/tutor/reviews",
    )

    return NextResponse.json({ review }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/student/tutors/[id]/review]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// GET — fetch existing review by this student for this tutor
async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: tutorId } = await params

    const review = await prisma.tutorReview.findUnique({
      where: { studentId_tutorId: { studentId: session.sub, tutorId } },
    })

    return NextResponse.json({ review })
  } catch (err) {
    console.error("[GET /api/student/tutors/[id]/review]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
export const GET = withAudit(handleGET)
