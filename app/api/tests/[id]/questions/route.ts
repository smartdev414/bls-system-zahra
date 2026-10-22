import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { requireCapability } from "@/lib/permissions"
import { isSelfMarked, isSignTest } from "@/lib/quiz"
import { testEditScope } from "@/lib/tests"
import { validateQuestion, type QuestionBody } from "./validate"

/** The test, if the caller may change it. */
function findEditableTest(id: string, session: { role: string; sub: string }) {
  return prisma.test.findFirst({ where: { id, ...testEditScope(session) } })
}

// POST /api/tests/[id]/questions — adds a question after the others.
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id } = await params
    const test = await findEditableTest(id, session!)
    if (!test) return NextResponse.json({ message: "Test not found" }, { status: 404 })

    const body = await req.json() as QuestionBody
    const invalid = validateQuestion(body, test.testKind)
    if (invalid) return NextResponse.json({ message: invalid }, { status: 400 })
    const options = isSignTest(test.testKind) || isSelfMarked(body.type) ? [] : body.options

    // After the last question — not `count + 1`, which repeats a number once a
    // question in the middle has been deleted.
    const last = await prisma.quizQuestion.aggregate({ where: { testId: id }, _max: { order: true } })

    const question = await prisma.quizQuestion.create({
      data: {
        testId: id,
        question: body.question.trim(),
        imageUrl: body.imageUrl ?? null,
        mediaType: body.imageUrl ? body.mediaType ?? null : null,
        videoControls: body.videoControls === true,
        questionAfterVideo: body.questionAfterVideo === true && !!body.imageUrl,
        type: body.type ?? "MULTIPLE_CHOICE",
        modelAnswer: body.type === "WRITTEN" ? body.modelAnswer?.trim() ?? null : null,
        answerVideoUrl: body.type === "SIGN" ? body.answerVideoUrl ?? null : null,
        order: (last._max.order ?? 0) + 1,
        options: {
          create: options.map((opt, i) => ({
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
    console.error("[POST /api/tests/[id]/questions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// PATCH /api/tests/[id]/questions — { orderedIds: [...] } puts the questions
// in that order.
async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id } = await params
    const test = await findEditableTest(id, session!)
    if (!test) return NextResponse.json({ message: "Test not found" }, { status: 404 })

    const { orderedIds } = await req.json() as { orderedIds?: string[] }
    const existing = await prisma.quizQuestion.findMany({ where: { testId: id }, select: { id: true } })
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
    console.error("[PATCH /api/tests/[id]/questions]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
export const PATCH = withAudit(handlePATCH)
