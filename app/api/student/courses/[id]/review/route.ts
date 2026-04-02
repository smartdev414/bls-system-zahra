import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: courseId } = await params
    const { rating, comment } = await req.json() as { rating: number; comment?: string }

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ message: "Rating must be between 1 and 5" }, { status: 400 })
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId },
    })
    if (!enrollment) return NextResponse.json({ message: "Not enrolled in this course" }, { status: 403 })

    const review = await prisma.review.upsert({
      where: { studentId_courseId: { studentId: session.sub, courseId } },
      create: { studentId: session.sub, courseId, rating, comment: comment?.trim() ?? null },
      update: { rating, comment: comment?.trim() ?? null },
    })

    return NextResponse.json({ review }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/student/courses/[id]/review]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
