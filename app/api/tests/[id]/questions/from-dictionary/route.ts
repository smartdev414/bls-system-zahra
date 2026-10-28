import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { tutorWrite } from "@/lib/tutor-access"
import { requireCapability } from "@/lib/permissions"
import { isSignTest, sameWord } from "@/lib/quiz"
import { questionsFromSigns, signMedia, testEditScope } from "@/lib/tests"

/** Signs taken in one go — a page of the picker is far fewer. */
const MAX_SIGNS = 100

const signSelect = { id: true, word: true, category: true, level: true, videoUrl: true, imageUrl: true } as const

// POST /api/tests/[id]/questions/from-dictionary — { signIds: [...] }
// Turns dictionary signs into questions at the end of the test (see
// questionsFromSigns). A sign the test already has is left out.
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage", "dictionary.view")
    if (denied) return denied

    const { id } = await params
    const test = await prisma.test.findFirst({
      where: { id, ...testEditScope(session!) },
      select: {
        testKind: true,
        questions: { select: { question: true, imageUrl: true, order: true } },
      },
    })
    if (!test) return NextResponse.json({ message: "Test not found" }, { status: 404 })

    const { signIds } = await req.json() as { signIds?: unknown }
    if (!Array.isArray(signIds) || signIds.length === 0 || signIds.some((s) => typeof s !== "string")) {
      return NextResponse.json({ message: "Choose at least one sign" }, { status: 400 })
    }
    if (signIds.length > MAX_SIGNS) {
      return NextResponse.json({ message: `Add up to ${MAX_SIGNS} signs at a time` }, { status: 400 })
    }

    const [picked, pool] = await Promise.all([
      prisma.sign.findMany({ where: { id: { in: signIds as string[] } }, select: signSelect }),
      // The whole dictionary is small; the wrong answers are drawn from it.
      prisma.sign.findMany({ select: signSelect }),
    ])
    // In the order they were picked.
    const byId = new Map(picked.map((s) => [s.id, s]))
    const ordered = (signIds as string[]).flatMap((sid) => byId.get(sid) ?? [])

    const usedMedia = new Set(test.questions.flatMap((q) => (q.imageUrl ? [q.imageUrl] : [])))
    const signTest = isSignTest(test.testKind)
    const fresh = ordered.filter((sign) => {
      const media = signMedia(sign)
      if (!media || usedMedia.has(media.url)) return false
      // A word to spell or name only once.
      if (signTest && test.questions.some((q) => sameWord(q.question, sign.word))) return false
      usedMedia.add(media.url)
      return true
    })

    const generated = questionsFromSigns(test.testKind, fresh, pool)
    const start = Math.max(0, ...test.questions.map((q) => q.order))

    const questions = await prisma.$transaction(
      generated.map(({ options, ...question }, i) =>
        prisma.quizQuestion.create({
          data: { ...question, testId: id, order: start + i + 1, options: { create: options } },
          include: { options: { orderBy: { order: "asc" } } },
        })
      )
    )

    return NextResponse.json(
      { questions, added: questions.length, skipped: ordered.length - questions.length },
      { status: 201 },
    )
  } catch (err) {
    console.error("[POST /api/tests/[id]/questions/from-dictionary]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(tutorWrite("tests", handlePOST))
