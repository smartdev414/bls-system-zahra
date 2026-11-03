import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { isReleased } from "@/lib/lesson-release"
import { isReflection } from "@/lib/quiz"
import {
  cleanAnswers, criteriaOf, missingCriteria, notifyReflectionSent, textMap,
} from "@/lib/reflections"

/**
 * A student's self-reflection on one lesson (a REFLECTION test).
 *
 *   GET  — the criteria, what they have written, and their teacher's feedback
 *   PUT  { answers } — keeps what they have written so far
 *   POST { answers } — keeps it and sends it to their teacher; refused while
 *                      an open criterion is empty
 *
 * They can write while it is a draft or has been sent back to them; once sent,
 * it waits for the teacher.
 */
async function load(lessonId: string, userId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true, title: true, type: true, releaseAt: true,
      section: { select: { courseId: true } },
      test: { select: { id: true, testKind: true, description: true } },
    },
  })
  if (!lesson?.test || !isReflection(lesson.test.testKind) || !isReleased(lesson)) return null
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId: userId, courseId: lesson.section.courseId },
    select: { id: true },
  })
  if (!enrollment) return null
  return { lesson, test: lesson.test }
}

async function handleGET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const found = await load(id, session.sub)
    if (!found) return NextResponse.json({ message: "Not found" }, { status: 404 })

    const [criteria, submission, me] = await Promise.all([
      criteriaOf(found.test.id),
      prisma.reflectionSubmission.findUnique({
        where: { lessonId_userId: { lessonId: id, userId: session.sub } },
        select: {
          status: true, answers: true, submittedAt: true, updatedAt: true,
          feedback: {
            orderBy: { createdAt: "desc" },
            select: { id: true, outcome: true, text: true, videoUrl: true, notes: true, createdAt: true, author: { select: { name: true } } },
          },
        },
      }),
      prisma.user.findUnique({ where: { id: session.sub }, select: { name: true } }),
    ])

    return NextResponse.json({
      title: found.lesson.title,
      candidate: me?.name ?? "",
      instructions: found.test.description,
      criteria,
      submission: submission && {
        status: submission.status,
        answers: textMap(submission.answers),
        submittedAt: submission.submittedAt,
        updatedAt: submission.updatedAt,
        feedback: submission.feedback.map((f) => ({
          id: f.id, outcome: f.outcome, text: f.text, videoUrl: f.videoUrl, notes: textMap(f.notes),
          createdAt: f.createdAt, authorName: f.author?.name ?? null,
        })),
      },
    })
  } catch (err) {
    console.error("[GET /api/student/lessons/[id]/reflection]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

/** Saves what was sent; with `send`, also sends it in. */
async function save(req: NextRequest, id: string, send: boolean) {
  const session = await getSession()
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  if (session.role !== "STUDENT") return NextResponse.json({ message: "Only students write self-reflections" }, { status: 403 })
  const found = await load(id, session.sub)
  if (!found) return NextResponse.json({ message: "Not found" }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { answers?: unknown }
  const criteria = await criteriaOf(found.test.id)
  const answers = cleanAnswers(body.answers, criteria)

  const existing = await prisma.reflectionSubmission.findUnique({
    where: { lessonId_userId: { lessonId: id, userId: session.sub } },
    select: { status: true, submittedAt: true },
  })
  if (existing && (existing.status === "SUBMITTED" || existing.status === "COMPLETE")) {
    return NextResponse.json({
      message: existing.status === "COMPLETE"
        ? "Your teacher has marked this complete, so it can't be changed."
        : "This is with your teacher now. You can change it when they send it back.",
    }, { status: 409 })
  }

  if (send) {
    const missing = missingCriteria(criteria, answers)
    if (criteria.every((c) => c.locked)) {
      return NextResponse.json({ message: "There is nothing to fill in yet. Ask your teacher." }, { status: 400 })
    }
    if (missing.length > 0) {
      return NextResponse.json({
        message: `Fill in every section before you send it. ${missing.length} still empty.`,
        missing: missing.map((c) => c.id),
      }, { status: 400 })
    }
  }

  const status = send ? "SUBMITTED" : existing?.status ?? "DRAFT"
  const saved = await prisma.reflectionSubmission.upsert({
    where: { lessonId_userId: { lessonId: id, userId: session.sub } },
    create: { lessonId: id, userId: session.sub, answers, status, ...(send && { submittedAt: new Date() }) },
    update: { answers, status, ...(send && { submittedAt: new Date() }) },
    select: { status: true, updatedAt: true, submittedAt: true },
  })

  if (send) {
    const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { name: true } })
    void notifyReflectionSent(id, me?.name ?? "A student", !!existing?.submittedAt)
  }
  return NextResponse.json(saved)
}

async function handlePUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await save(req, (await params).id, false)
  } catch (err) {
    console.error("[PUT /api/student/lessons/[id]/reflection]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await save(req, (await params).id, true)
  } catch (err) {
    console.error("[POST /api/student/lessons/[id]/reflection]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const PUT = withAudit(handlePUT)
export const POST = withAudit(handlePOST)
