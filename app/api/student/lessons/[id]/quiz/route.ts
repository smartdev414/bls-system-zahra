import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

// GET /api/student/lessons/[id]/quiz  — returns questions WITHOUT isCorrect
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: { section: { select: { courseId: true } } },
    })
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    // Verify access
    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: session.sub, courseId: lesson.section.courseId },
    })
    if (!enrollment && !lesson.isFree) {
      return NextResponse.json({ message: "Not enrolled" }, { status: 403 })
    }

    const questions = await prisma.quizQuestion.findMany({
      where: { lessonId: id },
      orderBy: { order: "asc" },
      include: {
        options: {
          orderBy: { order: "asc" },
          select: { id: true, text: true, imageUrl: true, mediaType: true, order: true }, // omit isCorrect
        },
      },
    })

    // Best attempt so far
    const bestAttempt = await prisma.quizAttempt.findFirst({
      where: { lessonId: id, userId: session.sub },
      orderBy: { score: "desc" },
      include: {
        answers: { select: { questionId: true, optionId: true, isCorrect: true } },
      },
    })

    return NextResponse.json({ questions, bestAttempt })
  } catch (err) {
    console.error("[GET /api/student/lessons/[id]/quiz]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
