import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"
import { withAudit } from "@/lib/audit"

/**
 * Returns the list of people the current user can message:
 * - Students → tutors of courses they're enrolled in
 * - Tutors   → students enrolled in their courses
 */
async function handleGET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    if (session.role === "STUDENT") {
      const enrollments = await prisma.enrollment.findMany({
        where: { studentId: session.sub },
        include: {
          course: {
            include: {
              tutor: { select: { id: true, name: true, avatarUrl: true } },
            },
          },
        },
      })

      const seen = new Set<string>()
      const contacts = enrollments
        .map((e) => e.course.tutor)
        .filter((t) => {
          if (seen.has(t.id)) return false
          seen.add(t.id)
          return true
        })

      return NextResponse.json({ contacts })
    }

    if (session.role === "TUTOR") {
      const enrollments = await prisma.enrollment.findMany({
        where: { course: { tutorId: session.sub } },
        include: {
          student: { select: { id: true, name: true, avatarUrl: true } },
        },
      })

      const seen = new Set<string>()
      const contacts = enrollments
        .map((e) => e.student)
        .filter((s) => {
          if (seen.has(s.id)) return false
          seen.add(s.id)
          return true
        })

      return NextResponse.json({ contacts })
    }

    return NextResponse.json({ contacts: [] })
  } catch (err) {
    console.error("[GET /api/messages/contacts]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
