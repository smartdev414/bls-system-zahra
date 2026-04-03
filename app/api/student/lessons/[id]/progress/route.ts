import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "STUDENT") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id: lessonId } = await params
    const body = await req.json() as { watchedSecs?: number; isCompleted?: boolean; enrollmentId: string }

    const { enrollmentId, watchedSecs, isCompleted } = body
    if (!enrollmentId) {
      return NextResponse.json({ message: "enrollmentId is required" }, { status: 400 })
    }

    // Verify enrollment belongs to this student
    const enrollment = await prisma.enrollment.findFirst({
      where: { id: enrollmentId, studentId: session.sub },
    })
    if (!enrollment) return NextResponse.json({ message: "Enrollment not found" }, { status: 404 })

    const data: Record<string, unknown> = { updatedAt: new Date() }
    if (typeof watchedSecs === "number") data.watchedSecs = watchedSecs
    if (typeof isCompleted === "boolean") {
      data.isCompleted = isCompleted
      if (isCompleted) data.completedAt = new Date()
    }

    const progress = await prisma.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
      create: {
        enrollmentId,
        lessonId,
        watchedSecs: watchedSecs ?? 0,
        isCompleted: isCompleted ?? false,
        completedAt: isCompleted ? new Date() : null,
      },
      update: data,
    })

    return NextResponse.json({ progress })
  } catch (err) {
    console.error("[PATCH /api/student/lessons/[id]/progress]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
