import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

async function verifyOwnership(lessonId: string, tutorId: string) {
  return prisma.lesson.findFirst({
    where: { id: lessonId, section: { course: { tutorId } } },
  })
}

// GET /api/tutor/lessons/[id]/questions
async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const lesson = await verifyOwnership(id, session.sub)
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    const questions = await prisma.quizQuestion.findMany({
      where: { lessonId: id },
      orderBy: { order: "asc" },
      include: { options: { orderBy: { order: "asc" } } },
    })

    return NextResponse.json({ questions })
  } catch (err) {
    console.error("[GET /api/tutor/lessons/[id]/questions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// POST /api/tutor/lessons/[id]/questions
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const lesson = await verifyOwnership(id, session.sub)
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    const body = await req.json() as {
      question: string
      imageUrl?: string
      type: "MULTIPLE_CHOICE" | "TRUE_FALSE"
      options: Array<{ text: string; imageUrl?: string; mediaType?: string; isCorrect: boolean }>
    }

    if (!body.question?.trim()) {
      return NextResponse.json({ message: "Question text is required" }, { status: 400 })
    }
    if (!body.options?.length || !body.options.some((o) => o.isCorrect)) {
      return NextResponse.json({ message: "At least one correct option is required" }, { status: 400 })
    }
    // Each option must have text OR an image
    if (body.options.some((o) => !o.text?.trim() && !o.imageUrl)) {
      return NextResponse.json({ message: "Each option needs text or an image" }, { status: 400 })
    }

    const count = await prisma.quizQuestion.count({ where: { lessonId: id } })

    const question = await prisma.quizQuestion.create({
      data: {
        lessonId: id,
        question: body.question.trim(),
        imageUrl: body.imageUrl ?? null,
        type: body.type ?? "MULTIPLE_CHOICE",
        order: count + 1,
        options: {
          create: body.options.map((opt, i) => ({
            text: opt.text.trim(),
            imageUrl: opt.imageUrl ?? null,
            mediaType: opt.mediaType ?? null,
            isCorrect: opt.isCorrect,
            order: i,
          })),
        },
      },
      include: { options: { orderBy: { order: "asc" } } },
    })

    return NextResponse.json({ question }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tutor/lessons/[id]/questions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
