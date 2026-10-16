import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { courseTeachScope, requireCapability } from "@/lib/permissions"
import { parseLevel } from "@/lib/levels"
import { DEFAULT_ANSWER_SECONDS, isSignTest, parseTestKind, parseTestSettings } from "@/lib/quiz"
import { canEditTest, syncTestLessons, testEditScope } from "@/lib/tests"

// GET /api/tests/[id] — the test with its questions (correct answers marked),
// and the courses it is in with how the students there are doing.
async function handleGET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id } = await params
    const test = await prisma.test.findUnique({
      where: { id },
      include: {
        createdBy: { select: { name: true } },
        questions: {
          orderBy: { order: "asc" },
          include: { options: { orderBy: { order: "asc" } } },
        },
        lessons: {
          orderBy: { section: { course: { title: "asc" } } },
          select: {
            id: true,
            releaseAt: true,
            section: { select: { title: true, course: { select: { id: true, title: true, level: true, status: true } } } },
            attempts: { select: { userId: true, passed: true } },
          },
        },
      },
    })
    if (!test) return NextResponse.json({ message: "Test not found" }, { status: 404 })

    // The courses the caller teaches: they may open its results and take the test out of it.
    const teaching = new Set(
      (await prisma.course.findMany({
        where: { id: { in: test.lessons.map((l) => l.section.course.id) }, ...courseTeachScope(session!) },
        select: { id: true },
      })).map((c) => c.id)
    )

    const { lessons, createdBy, ...rest } = test
    return NextResponse.json({
      test: {
        ...rest,
        createdByName: createdBy?.name ?? null,
        placements: lessons.map((l) => {
          const students = new Set(l.attempts.map((a) => a.userId))
          const passed = new Set(l.attempts.filter((a) => a.passed).map((a) => a.userId))
          return {
            lessonId: l.id,
            releaseAt: l.releaseAt,
            sectionTitle: l.section.title,
            course: l.section.course,
            studentsTaken: students.size,
            studentsPassed: passed.size,
            canManage: teaching.has(l.section.course.id),
          }
        }),
      },
      canEdit: canEditTest(session!, test),
    })
  } catch (err) {
    console.error("[GET /api/tests/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// PUT /api/tests/[id] — changes what it was sent. The kind can only change
// while the test has no questions: they are stored differently per kind.
async function handlePUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id } = await params
    const test = await prisma.test.findFirst({
      where: { id, ...testEditScope(session!) },
      include: { _count: { select: { questions: true } } },
    })
    if (!test) return NextResponse.json({ message: "Test not found" }, { status: 404 })

    const body = await req.json() as {
      title?: string
      description?: string | null
      level?: string | null
      testKind?: string
      passMark?: number
      maxAttempts?: number | null
      answerSeconds?: number
      storyUrl?: string | null
    }

    if (body.title !== undefined && !body.title.trim()) {
      return NextResponse.json({ message: "Give the test a title" }, { status: 400 })
    }

    const level = body.level === undefined ? undefined : parseLevel(body.level)
    if (body.level !== undefined && level === undefined) {
      return NextResponse.json({ message: "Unknown level" }, { status: 400 })
    }

    let testKind = test.testKind
    if (body.testKind !== undefined && body.testKind !== test.testKind) {
      const kind = parseTestKind(body.testKind)
      if (!kind) return NextResponse.json({ message: "Unknown kind of test" }, { status: 400 })
      if (test._count.questions > 0) {
        return NextResponse.json({ message: "Delete the questions first to change the kind of test" }, { status: 409 })
      }
      testKind = kind
    }

    const settings = parseTestSettings(body)
    if (typeof settings === "string") return NextResponse.json({ message: settings }, { status: 400 })

    const title = body.title?.trim()
    const description = body.description === undefined ? undefined : body.description?.trim() || null

    const updated = await prisma.test.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(level !== undefined && { level }),
        testKind,
        ...settings,
        ...(isSignTest(testKind) && !settings.answerSeconds && !test.answerSeconds && { answerSeconds: DEFAULT_ANSWER_SECONDS }),
        ...(testKind !== "STORY" && { storyUrl: null }),
      },
    })
    await syncTestLessons(id, { title, description })

    return NextResponse.json({ test: updated })
  } catch (err) {
    console.error("[PUT /api/tests/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// DELETE /api/tests/[id] — the test leaves every course it is in, and the
// results there go with it.
async function handleDELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const { id } = await params
    const test = await prisma.test.findFirst({ where: { id, ...testEditScope(session!) }, select: { id: true } })
    if (!test) return NextResponse.json({ message: "Test not found" }, { status: 404 })

    await prisma.test.delete({ where: { id } })
    return NextResponse.json({ message: "Test deleted" })
  } catch (err) {
    console.error("[DELETE /api/tests/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
export const DELETE = withAudit(handleDELETE)
