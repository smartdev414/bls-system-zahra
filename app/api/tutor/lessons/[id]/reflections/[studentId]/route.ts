import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import {
  cleanNotes, criteriaOf, isFeedbackVideo, notifyReflectionReviewed, recordReflectionComplete, textMap,
} from "@/lib/reflections"
import { teachableReflection } from "../access"

/**
 * One student's self-reflection, as their teacher reads it.
 *
 *   GET  — the criteria, what the student wrote, and the feedback so far
 *   POST { outcome: "RETURNED" | "COMPLETE", text?, videoUrl?, notes? }
 *        — sends it back with feedback (some feedback is needed), or marks it
 *          complete (feedback optional). Only once the student has sent it.
 */
async function handleGET(_req: Request, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    const { id, studentId } = await params
    const lesson = await teachableReflection(session, id)
    if (!lesson) return NextResponse.json({ message: "Not found" }, { status: 404 })

    const [student, criteria, submission] = await Promise.all([
      prisma.user.findFirst({
        where: { id: studentId, enrollments: { some: { courseId: lesson.section.courseId } } },
        select: { id: true, name: true, email: true, avatarUrl: true },
      }),
      criteriaOf(lesson.testId),
      prisma.reflectionSubmission.findUnique({
        where: { lessonId_userId: { lessonId: id, userId: studentId } },
        select: {
          id: true, status: true, answers: true, submittedAt: true, updatedAt: true,
          feedback: {
            orderBy: { createdAt: "desc" },
            select: { id: true, outcome: true, text: true, videoUrl: true, notes: true, createdAt: true, author: { select: { name: true } } },
          },
        },
      }),
    ])
    if (!student) return NextResponse.json({ message: "Student is not on this course" }, { status: 404 })

    return NextResponse.json({
      student,
      criteria,
      submission: submission && {
        status: submission.status,
        // A draft is the student's own until they send it.
        answers: submission.status === "DRAFT" ? {} : textMap(submission.answers),
        submittedAt: submission.submittedAt,
        updatedAt: submission.updatedAt,
        feedback: submission.feedback.map((f) => ({
          id: f.id, outcome: f.outcome, text: f.text, videoUrl: f.videoUrl, notes: textMap(f.notes),
          createdAt: f.createdAt, authorName: f.author?.name ?? null,
        })),
      },
    })
  } catch (err) {
    console.error("[GET /api/tutor/lessons/[id]/reflections/[studentId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    const { id, studentId } = await params
    const lesson = await teachableReflection(session, id)
    if (!lesson) return NextResponse.json({ message: "Not found" }, { status: 404 })

    const body = await req.json().catch(() => ({})) as { outcome?: unknown; text?: unknown; videoUrl?: unknown; notes?: unknown }
    if (body.outcome !== "RETURNED" && body.outcome !== "COMPLETE") {
      return NextResponse.json({ message: "Send it back or mark it complete" }, { status: 400 })
    }
    const outcome = body.outcome
    const text = typeof body.text === "string" && body.text.trim() ? body.text.trim().slice(0, 10_000) : null
    if (body.videoUrl != null && !isFeedbackVideo(body.videoUrl, id, studentId)) {
      return NextResponse.json({ message: "That feedback video could not be used. Record it again." }, { status: 400 })
    }
    const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : null
    const notes = cleanNotes(body.notes, await criteriaOf(lesson.testId))
    if (outcome === "RETURNED" && !text && !videoUrl && Object.keys(notes).length === 0) {
      return NextResponse.json({ message: "Add some feedback, so the student knows what to change." }, { status: 400 })
    }

    const submission = await prisma.reflectionSubmission.findUnique({
      where: { lessonId_userId: { lessonId: id, userId: studentId } },
      select: { id: true, status: true },
    })
    if (!submission || submission.status !== "SUBMITTED") {
      return NextResponse.json({ message: "The student hasn't sent this to you yet." }, { status: 409 })
    }

    // Only if it is still waiting: two teachers on the same document don't both act on it.
    const moved = await prisma.$transaction(async (tx) => {
      const { count } = await tx.reflectionSubmission.updateMany({ where: { id: submission.id, status: "SUBMITTED" }, data: { status: outcome } })
      if (count === 0) return false
      await tx.reflectionFeedback.create({
        data: { submissionId: submission.id, authorId: session.sub, outcome, text, videoUrl, notes },
      })
      return true
    })
    if (!moved) {
      return NextResponse.json({ message: "Someone else has just dealt with this." }, { status: 409 })
    }

    if (outcome === "COMPLETE") await recordReflectionComplete(id, studentId)
    void notifyReflectionReviewed(id, studentId, outcome)
    return NextResponse.json({ status: outcome })
  } catch (err) {
    console.error("[POST /api/tutor/lessons/[id]/reflections/[studentId]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
export const POST = withAudit(handlePOST)
