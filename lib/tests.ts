import prisma from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { createNotifications } from "@/lib/notifications"
import { isReleased, releaseInSection } from "@/lib/lesson-release"
import { courseTeachScope } from "@/lib/permissions"
import { isSignTest, sameWord, type TestKind } from "@/lib/quiz"

/**
 * The questions students are given. A word typed into a fingerspelling or
 * vocabulary test waits there, unseen, until its sign is filmed.
 */
export const READY_QUESTION = {
  NOT: { imageUrl: null, test: { testKind: { in: ["FINGERSPELLING", "VOCABULARY"] } } },
} satisfies Prisma.QuizQuestionWhereInput

/**
 * The test bank (the Tests menu).
 *
 * A test is made once and put in any number of courses — one per level, say —
 * without building it again. Each placement is a lesson of type QUIZ pointing
 * at the test: it sits in the course outline like any lesson (order, release
 * date, progress), while the questions and how the test is passed live on the
 * test, so a change reaches every course using it. Attempts are kept on the
 * lesson, so each course has its own results.
 *
 * Tutors and admins both use the bank. Everyone sees every test so the school's
 * work is shared; a tutor changes the tests they made and copies the others,
 * an admin changes any.
 */

type Who = { role: string; sub: string }

/** Prisma `where` fragment: the tests this person may change. */
export function testEditScope(session: Who): Prisma.TestWhereInput {
  return session.role === "ADMIN" ? {} : { createdById: session.sub }
}

export function canEditTest(session: Who, test: { createdById: string | null }): boolean {
  return session.role === "ADMIN" || test.createdById === session.sub
}

/** Prisma `where` fragment: the courses this person may put a test in — the ones they teach. */
export function testCourseScope(session: Who): Prisma.CourseWhereInput {
  return { ...courseTeachScope(session), status: { not: "ARCHIVED" } }
}

/** A test with a link to another of the same title reads oddly: "Greetings (copy)". */
export function copyTitle(title: string): string {
  return /\(copy\)$/i.test(title) ? title : `${title} (copy)`
}

/**
 * The lessons that show a test take its title and description, so the course
 * outline and the student's Tests page always name it as the bank does.
 */
export async function syncTestLessons(testId: string, data: { title?: string; description?: string | null }) {
  if (data.title === undefined && data.description === undefined) return
  await prisma.lesson.updateMany({ where: { testId }, data })
}

/**
 * Puts a test at the end of a course section. Students on a published course
 * are told about it once they can open it.
 */
export async function placeTest(
  test: { id: string; title: string; description: string | null },
  section: { id: string; course: { id: string; title: string; status: string } },
  releaseAt: Date | null,
) {
  const siblings = await prisma.lesson.findMany({
    where: { sectionId: section.id },
    orderBy: { order: "asc" },
    select: { releaseAt: true, order: true },
  })

  const lesson = await prisma.lesson.create({
    data: {
      sectionId: section.id,
      type: "QUIZ",
      testId: test.id,
      title: test.title,
      description: test.description,
      releaseAt: releaseInSection(siblings, releaseAt),
      order: Math.max(0, ...siblings.map((l) => l.order)) + 1,
    },
  })

  if (section.course.status === "PUBLISHED" && isReleased(lesson)) {
    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: section.course.id },
      select: { studentId: true },
    })
    void createNotifications(
      enrollments.map((e) => e.studentId),
      "NEW_LESSON",
      "New test available",
      `"${test.title}" has been added to "${section.course.title}"`,
      `/student/tests`,
    )
  }

  return lesson
}

// ─── Questions from the dictionary ────────────────────────────────────────────

export type DictionarySign = {
  id: string
  word: string
  category: string
  level: string
  videoUrl: string | null
  imageUrl: string | null
}

/** Answers offered on a "What does this sign mean?" question — the right one among them. */
const DICTIONARY_CHOICES = 4

function shuffled<T>(items: readonly T[]): T[] {
  const list = [...items]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

/** A sign's clip, or its picture when it has no clip; null when there is nothing to show. */
export function signMedia(sign: Pick<DictionarySign, "videoUrl" | "imageUrl">): { url: string; type: "video" | "image" } | null {
  if (sign.videoUrl) return { url: sign.videoUrl, type: "video" }
  if (sign.imageUrl) return { url: sign.imageUrl, type: "image" }
  return null
}

/**
 * Wrong answers for a sign: other words from the dictionary, closest first —
 * the same category and level make a real choice, not a giveaway.
 */
function distractors(sign: DictionarySign, pool: readonly DictionarySign[], count: number): string[] {
  const rank = (other: DictionarySign) =>
    (other.category === sign.category ? 0 : 2) + (other.level === sign.level ? 0 : 1)
  const candidates = shuffled(pool).sort((a, b) => rank(a) - rank(b))
  const picked: string[] = []
  for (const other of candidates) {
    if (picked.length >= count) break
    if (sameWord(other.word, sign.word) || picked.some((w) => sameWord(w, other.word))) continue
    picked.push(other.word)
  }
  return picked
}

export type GeneratedQuestion = {
  question: string
  imageUrl: string
  mediaType: "video" | "image"
  type: "MULTIPLE_CHOICE"
  options: Array<{ text: string; isCorrect: boolean; order: number }>
}

/**
 * The questions a test gets from dictionary signs. In a fingerspelling or
 * vocabulary test a sign is a question as it is: its clip and its word. In the
 * other kinds each sign becomes "What does this sign mean?" with its word and
 * three others to choose from.
 */
export function questionsFromSigns(
  kind: TestKind,
  signs: readonly DictionarySign[],
  pool: readonly DictionarySign[],
): GeneratedQuestion[] {
  return signs.flatMap((sign) => {
    const media = signMedia(sign)
    if (!media) return []
    if (isSignTest(kind)) {
      return [{ question: sign.word, imageUrl: media.url, mediaType: media.type, type: "MULTIPLE_CHOICE", options: [] }]
    }
    const words = shuffled([sign.word, ...distractors(sign, pool, DICTIONARY_CHOICES - 1)])
    // A dictionary with no other words leaves nothing to choose between.
    if (words.length < 2) return []
    return [{
      question: "What does this sign mean?",
      imageUrl: media.url,
      mediaType: media.type,
      type: "MULTIPLE_CHOICE",
      options: words.map((text, order) => ({ text, isCorrect: text === sign.word, order })),
    }]
  })
}
