import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { courseContentScope } from "@/lib/permissions"

async function verifyOwnership(lessonId: string, session: { role: string; sub: string }) {
  return prisma.lesson.findFirst({
    where: { id: lessonId, section: { course: courseContentScope(session) } },
  })
}

// PUT /api/tutor/lessons/[id]/questions/[qid]
async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, qid } = await params
    const lesson = await verifyOwnership(id, session)
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
    if (body.options.some((o) => !o.text?.trim() && !o.imageUrl)) {
      return NextResponse.json({ message: "Each option needs text or an image" }, { status: 400 })
    }

    // Replace options: delete all existing then re-create
    await prisma.quizOption.deleteMany({ where: { questionId: qid } })

    const updated = await prisma.quizQuestion.update({
      where: { id: qid },
      data: {
        question: body.question.trim(),
        imageUrl: body.imageUrl ?? null,
        type: body.type,
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

    return NextResponse.json({ question: updated })
  } catch (err) {
    console.error("[PUT /api/tutor/lessons/[id]/questions/[qid]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/tutor/lessons/[id]/questions/[qid]
async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, qid } = await params
    const lesson = await verifyOwnership(id, session)
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    await prisma.quizQuestion.delete({ where: { id: qid } })
    return NextResponse.json({ message: "Question deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/lessons/[id]/questions/[qid]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PUT = withAudit(handlePUT)
export const DELETE = withAudit(handleDELETE)
