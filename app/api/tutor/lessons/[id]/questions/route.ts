import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { can, courseContentScope, courseTeachScope } from "@/lib/permissions"
import { validateQuestion, type QuestionBody } from "./validate"

async function verifyOwnership(lessonId: string, session: { role: string; sub: string }) {
  return prisma.lesson.findFirst({
    where: { id: lessonId, section: { course: courseContentScope(session) } },
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
    const lesson = await prisma.lesson.findFirst({
      where: { id, section: { course: courseTeachScope(session) } },
      select: { id: true },
    })
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
    if (!can(session.role, "lessons.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const lesson = await verifyOwnership(id, session)
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    const body = await req.json() as QuestionBody
    const invalid = validateQuestion(body)
    if (invalid) return NextResponse.json({ message: invalid }, { status: 400 })

    // After the last question — not `count + 1`, which repeats a number once a
    // question in the middle has been deleted.
    const last = await prisma.quizQuestion.aggregate({ where: { lessonId: id }, _max: { order: true } })

    const question = await prisma.quizQuestion.create({
      data: {
        lessonId: id,
        question: body.question.trim(),
        imageUrl: body.imageUrl ?? null,
        mediaType: body.imageUrl ? body.mediaType ?? null : null,
        type: body.type ?? "MULTIPLE_CHOICE",
        order: (last._max.order ?? 0) + 1,
        options: {
          create: body.options.map((opt, i) => ({
            text: opt.text?.trim() ?? "",
            imageUrl: opt.imageUrl ?? null,
            mediaType: opt.imageUrl ? opt.mediaType ?? null : null,
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

// PATCH /api/tutor/lessons/[id]/questions — { orderedIds: [...] } puts the
// questions in that order.
async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (!can(session.role, "lessons.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const lesson = await verifyOwnership(id, session)
    if (!lesson) return NextResponse.json({ message: "Lesson not found" }, { status: 404 })

    const { orderedIds } = await req.json() as { orderedIds?: string[] }
    const existing = await prisma.quizQuestion.findMany({ where: { lessonId: id }, select: { id: true } })
    const known = new Set(existing.map((q) => q.id))
    if (
      !Array.isArray(orderedIds) ||
      orderedIds.length !== known.size ||
      new Set(orderedIds).size !== known.size ||
      orderedIds.some((qid) => !known.has(qid))
    ) {
      return NextResponse.json({ message: "orderedIds must list every question of this test once" }, { status: 400 })
    }

    await prisma.$transaction(
      orderedIds.map((qid, i) => prisma.quizQuestion.update({ where: { id: qid }, data: { order: i + 1 } }))
    )

    return NextResponse.json({ message: "Questions reordered" })
  } catch (err) {
    console.error("[PATCH /api/tutor/lessons/[id]/questions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
export const PATCH = withAudit(handlePATCH)
