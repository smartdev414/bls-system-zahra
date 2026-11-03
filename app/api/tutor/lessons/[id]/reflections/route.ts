import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"
import { teachableReflection } from "./access"

// GET /api/tutor/lessons/[id]/reflections — every student on the course and
// where their self-reflection is: not started, being written, waiting for
// the teacher, sent back, or complete. Those waiting come first.
async function handleGET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const lesson = await teachableReflection(session, id)
    if (!lesson) return NextResponse.json({ message: "Not found" }, { status: 404 })

    const [enrolments, submissions] = await Promise.all([
      prisma.enrollment.findMany({
        where: { courseId: lesson.section.courseId },
        select: { student: { select: { id: true, name: true, email: true, avatarUrl: true } } },
        orderBy: { student: { name: "asc" } },
      }),
      prisma.reflectionSubmission.findMany({
        where: { lessonId: id },
        select: { userId: true, status: true, submittedAt: true, updatedAt: true, _count: { select: { feedback: { where: { outcome: "RETURNED" } } } } },
      }),
    ])
    const byStudent = new Map(submissions.map((s) => [s.userId, s]))
    const order: Record<string, number> = { SUBMITTED: 0, RETURNED: 1, DRAFT: 2, NONE: 3, COMPLETE: 4 }

    const students = enrolments.map(({ student }) => {
      const s = byStudent.get(student.id)
      return {
        ...student,
        status: (s?.status ?? "NONE") as string,
        submittedAt: s?.submittedAt ?? null,
        updatedAt: s?.updatedAt ?? null,
        // How many times it has been sent back for changes.
        rounds: s?._count.feedback ?? 0,
      }
    }).sort((a, b) => order[a.status] - order[b.status])

    return NextResponse.json({ students })
  } catch (err) {
    console.error("[GET /api/tutor/lessons/[id]/reflections]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
