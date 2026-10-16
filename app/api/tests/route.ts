import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { requireCapability } from "@/lib/permissions"
import { parseLevel } from "@/lib/levels"
import { DEFAULT_ANSWER_SECONDS, isSignTest, parseTestKind, parseTestSettings } from "@/lib/quiz"
import { canEditTest } from "@/lib/tests"

// GET /api/tests?q=&level=&kind=&mine=1 — the test bank, newest change first.
async function handleGET(req: NextRequest) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

    const sp = req.nextUrl.searchParams
    const q = sp.get("q")?.trim() ?? ""
    const level = parseLevel(sp.get("level") ?? "")
    const kind = parseTestKind(sp.get("kind"))
    const mine = sp.get("mine") === "1"

    const tests = await prisma.test.findMany({
      where: {
        ...(q && {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }),
        ...(level && { level }),
        ...(kind && { testKind: kind }),
        ...(mine && { createdById: session!.sub }),
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
      select: {
        id: true,
        title: true,
        description: true,
        level: true,
        testKind: true,
        passMark: true,
        maxAttempts: true,
        createdById: true,
        updatedAt: true,
        createdBy: { select: { name: true } },
        _count: { select: { questions: true } },
        lessons: { select: { section: { select: { course: { select: { id: true, title: true } } } } } },
      },
    })

    return NextResponse.json({
      tests: tests.map(({ lessons, _count, createdBy, ...test }) => {
        const courses = new Map(lessons.map((l) => [l.section.course.id, l.section.course.title]))
        return {
          ...test,
          questionCount: _count.questions,
          courses: [...courses].map(([id, title]) => ({ id, title })),
          createdByName: createdBy?.name ?? null,
          canEdit: canEditTest(session!, test),
        }
      }),
    })
  } catch (err) {
    console.error("[GET /api/tests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

// POST /api/tests — a new test, made by the caller. Questions are added after.
async function handlePOST(req: NextRequest) {
  try {
    const session = await getSession()
    const denied = requireCapability(session, "tests.manage")
    if (denied) return denied

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

    const title = body.title?.trim()
    if (!title) return NextResponse.json({ message: "Give the test a title" }, { status: 400 })

    const level = parseLevel(body.level)
    if (level === undefined) return NextResponse.json({ message: "Unknown level" }, { status: 400 })

    const testKind = parseTestKind(body.testKind ?? "STANDARD")
    if (!testKind) return NextResponse.json({ message: "Unknown kind of test" }, { status: 400 })

    const settings = parseTestSettings(body)
    if (typeof settings === "string") return NextResponse.json({ message: settings }, { status: 400 })

    const test = await prisma.test.create({
      data: {
        title,
        description: body.description?.trim() || null,
        level,
        testKind,
        ...settings,
        ...(isSignTest(testKind) && { answerSeconds: settings.answerSeconds ?? DEFAULT_ANSWER_SECONDS }),
        ...(testKind !== "STORY" && { storyUrl: null }),
        createdById: session!.sub,
      },
    })

    return NextResponse.json({ test }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/tests]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
