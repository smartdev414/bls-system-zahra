import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { can, courseContentScope } from "@/lib/permissions"
import { validateQuestion, type QuestionBody } from "../validate"

/** The question, if it belongs to this lesson and the caller may change it. */
async function findQuestion(lessonId: string, qid: string, session: { role: string; sub: string }) {
  return prisma.quizQuestion.findFirst({
    where: { id: qid, lessonId, lesson: { section: { course: courseContentScope(session) } } },
    include: { options: { select: { id: true } } },
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
    if (!can(session.role, "lessons.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, qid } = await params
    const existing = await findQuestion(id, qid, session)
    if (!existing) return NextResponse.json({ message: "Question not found" }, { status: 404 })

    const body = await req.json() as QuestionBody
    const invalid = validateQuestion(body)
    if (invalid) return NextResponse.json({ message: invalid }, { status: 400 })

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
          type: body.type,
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
    if (!can(session.role, "lessons.manage")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const { id, qid } = await params
    const existing = await findQuestion(id, qid, session)
    if (!existing) return NextResponse.json({ message: "Question not found" }, { status: 404 })

    await prisma.quizQuestion.delete({ where: { id: qid } })
    return NextResponse.json({ message: "Question deleted" })
  } catch (err) {
    console.error("[DELETE /api/tutor/lessons/[id]/questions/[qid]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const PUT = withAudit(handlePUT)
export const DELETE = withAudit(handleDELETE)
