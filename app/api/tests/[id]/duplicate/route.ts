import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { requireCapability } from "@/lib/permissions"
import { copyTitle } from "@/lib/tests"

// POST /api/tests/[id]/duplicate — a copy of any test, made by the caller, to
// change for another level or class without touching the original.
async function handlePOST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id } = await params
    const source = await prisma.test.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } },
    })
    if (!source) return NextResponse.json({ message: "Test not found" }, { status: 404 })

    const test = await prisma.test.create({
      data: {
        title: copyTitle(source.title),
        description: source.description,
        level: source.level,
        testKind: source.testKind,
        storyUrl: source.storyUrl,
        storyControls: source.storyControls,
        answerSeconds: source.answerSeconds,
        passMark: source.passMark,
        maxAttempts: source.maxAttempts,
        createdById: session!.sub,
        questions: {
          create: source.questions.map((q) => ({
            question: q.question,
            imageUrl: q.imageUrl,
            mediaType: q.mediaType,
            videoControls: q.videoControls,
            questionAfterVideo: q.questionAfterVideo,
            type: q.type,
            order: q.order,
            options: {
              create: q.options.map((o) => ({
                text: o.text, imageUrl: o.imageUrl, mediaType: o.mediaType, isCorrect: o.isCorrect, order: o.order,
              })),
            },
          })),
        },
      },
    })

    return NextResponse.json({ test }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tests/[id]/duplicate]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(handlePOST)
