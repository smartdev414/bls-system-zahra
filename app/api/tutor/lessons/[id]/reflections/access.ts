import prisma from "@/lib/prisma"
import { can, courseTeachScope } from "@/lib/permissions"
import type { SessionPayload } from "@/lib/auth"

/**
 * The self-reflection lesson, if the caller teaches its course and may read
 * students' work (teaching staff; support staff see scores only, and a
 * self-reflection has none).
 */
export async function teachableReflection(session: Pick<SessionPayload, "role" | "sub">, lessonId: string) {
  if (!can(session.role, "students.view") || !can(session.role, "resources.view")) return null
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, type: "QUIZ", test: { testKind: "REFLECTION" }, section: { course: courseTeachScope(session) } },
    select: { id: true, title: true, testId: true, section: { select: { courseId: true } } },
  })
  return lesson?.testId ? { ...lesson, testId: lesson.testId } : null
}
