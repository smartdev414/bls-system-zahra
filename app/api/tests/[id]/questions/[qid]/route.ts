import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { requireCapability } from "@/lib/permissions"
import { isSelfMarked, isSignTest } from "@/lib/quiz"
import { testEditScope } from "@/lib/tests"
import { validateQuestion, type QuestionBody } from "../validate"

/** The question, if it belongs to this test and the caller may change it. */
async function findQuestion(testId: string, qid: string, session: { role: string; sub: string }) {
  return prisma.quizQuestion.findFirst({
    where: { id: qid, testId, test: testEditScope(session) },
    include: { options: { select: { id: true } }, test: { select: { testKind: true } } },
  })
}

// PUT /api/tests/[id]/questions/[qid]
async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id, qid } = await params
    const existing = await findQuestion(id, qid, session!)
    if (!existing) return NextResponse.json({ message: "Question not found" }, { status: 404 })

    const body = await req.json() as QuestionBody
    const invalid = validateQuestion(body, existing.test.testKind)
    if (invalid) return NextResponse.json({ message: invalid }, { status: 400 })
    if (isSignTest(existing.test.testKind) || isSelfMarked(body.type)) body.options = []

    // Options are updated in place. Replacing them wholesale (as this used to)
    // blanks the answer every student gave to this question, because their
    // attempt points at the option they chose. Only an option that was actually
    // removed is deleted.
    const existingIds = new Set(existing.options.map((o) => o.id))
    const kept = new Set(body.options.map((o) => o.id).filter((oid): oid is string => !!oid && existingIds.has(oid)))
    const optionData = (opt: QuestionBody["options"][number], order: number) => ({
      text: opt.text?.trim() ?? "",
      imageUrl: opt.imageUrl ?? null,
      mediaType: opt.imageUrl ? opt.mediaType ?? null : null,
      isCorrect: opt.isCorrect,
      order,
    })

    const [, updated] = await prisma.$transaction([
      prisma.quizOption.deleteMany({ where: { questionId: qid, id: { notIn: [...kept] } } }),
      prisma.quizQuestion.update({
        where: { id: qid },
        data: {
          question: body.question.trim(),
          imageUrl: body.imageUrl ?? null,
          mediaType: body.imageUrl ? body.mediaType ?? null : null,
          videoControls: body.videoControls === true,
          questionAfterVideo: body.questionAfterVideo === true && !!body.imageUrl,
          type: body.type,
          modelAnswer: body.type === "WRITTEN" ? body.modelAnswer?.trim() ?? null : null,
          maxMarks: body.type === "WRITTEN" ? body.maxMarks ?? null : null,
          answerVideoUrl: body.type === "SIGN" ? body.answerVideoUrl ?? null : null,
          options: {
            update: body.options.flatMap((opt, i) =>
              opt.id && kept.has(opt.id) ? [{ where: { id: opt.id }, data: optionData(opt, i) }] : []
            ),
            create: body.options.flatMap((opt, i) =>
              opt.id && kept.has(opt.id) ? [] : [optionData(opt, i)]
            ),
          },
        },
        include: { options: { orderBy: { order: "asc" } } },
      }),
    ])

    return NextResponse.json({ question: updated })
  } catch (err) {
    console.error("[PUT /api/tests/[id]/questions/[qid]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/tests/[id]/questions/[qid]
async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id, qid } = await params
    const existing = await findQuestion(id, qid, session!)
    if (!existing) return NextResponse.json({ message: "Question not found" }, { status: 404 })

    await prisma.quizQuestion.delete({ where: { id: qid } })
    return NextResponse.json({ message: "Question deleted" })
  } catch (err) {
    console.error("[DELETE /api/tests/[id]/questions/[qid]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PUT = withAudit(handlePUT)
export const DELETE = withAudit(handleDELETE)
