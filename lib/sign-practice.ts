import prisma from "@/lib/prisma"
import { urlsHiddenFromStudents } from "@/lib/background-clean"
import { VOCABULARY_CHOICES, sameWord, type SignQuestion } from "@/lib/quiz"

/**
 * Practice from the dictionary — the student's starred signs as flashcards,
 * and "this week's signs" in the timed vocabulary game. Nothing here is
 * marked or recorded: it is the student's own practice, not a test.
 */

/** Signs in one practice round, so a long list stays a short go. */
export const PRACTICE_ROUND_SIGNS = 20

/** How far back "this week" reaches. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** A sign as practice needs it: its video (or picture) and its word. */
export type PracticeSign = SignQuestion & { answer: string }

function shuffled<T>(items: readonly T[]): T[] {
  const list = [...items]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

type SignRow = { id: string; word: string; videoUrl: string | null; imageUrl: string | null }

/**
 * Turns dictionary rows into practice signs, as a student may see them: a
 * video still having its background replaced is left out (the picture is used
 * instead), and a sign with nothing to show cannot be practised at all.
 */
async function toPracticeSigns(signs: SignRow[]): Promise<PracticeSign[]> {
  const hidden = await urlsHiddenFromStudents(signs.map((s) => s.videoUrl))
  return signs.flatMap((s) => {
    const video = s.videoUrl && !hidden.has(s.videoUrl) ? s.videoUrl : null
    if (video) return [{ id: s.id, imageUrl: video, mediaType: "video", answer: s.word }]
    if (s.imageUrl) return [{ id: s.id, imageUrl: s.imageUrl, mediaType: "image", answer: s.word }]
    return []
  })
}

const signSelect = { id: true, word: true, videoUrl: true, imageUrl: true } as const

/** The student's starred signs that can be shown, a round's worth, in a new order each time. */
export async function savedPracticeSigns(userId: string): Promise<PracticeSign[]> {
  const saved = await prisma.savedSign.findMany({
    where: { userId },
    select: { sign: { select: signSelect } },
  })
  const signs = await toPracticeSigns(saved.map((s) => s.sign))
  return shuffled(signs).slice(0, PRACTICE_ROUND_SIGNS)
}

/**
 * The dictionary signs taught this week: lessons and tests released on the
 * student's courses in the last 7 days. Lessons are not linked to dictionary
 * signs, so a sign counts when its word is
 *   • a sign in a vocabulary or fingerspelling test released this week (each
 *     question there is a word — the surest link), or
 *   • a word in the title of a lesson released this week ("Family", "Colours").
 * Lessons with no release date were there from the start, so are not "this week".
 */
async function weekSignIds(studentId: string, allSigns: { id: string; word: string }[]): Promise<Set<string>> {
  const now = new Date()
  const lessons = await prisma.lesson.findMany({
    where: {
      releaseAt: { gte: new Date(now.getTime() - WEEK_MS), lte: now },
      section: { course: { status: "PUBLISHED", enrollments: { some: { studentId } } } },
    },
    select: {
      title: true,
      type: true,
      test: { select: { testKind: true, questions: { select: { question: true } } } },
    },
  })

  const words: string[] = []
  for (const lesson of lessons) {
    words.push(...lesson.title.split(/[^\p{L}\p{N}'-]+/u))
    const test = lesson.type === "QUIZ" ? lesson.test : null
    if (test && (test.testKind === "VOCABULARY" || test.testKind === "FINGERSPELLING")) {
      words.push(...test.questions.map((q) => q.question))
    }
  }

  const ids = new Set<string>()
  for (const sign of allSigns) {
    if (words.some((w) => sameWord(w, sign.word))) ids.add(sign.id)
  }
  return ids
}

/**
 * A round of the timed vocabulary game: this week's signs, or — when nothing
 * new was taught this week — the student's starred signs. Each sign comes with
 * words to pick from, the wrong ones drawn from the rest of the round and then
 * from the dictionary, so even a short round has the full six.
 */
export async function weekPracticeRound(studentId: string): Promise<{ source: "week" | "saved"; signs: PracticeSign[] }> {
  const allSigns = await prisma.sign.findMany({ select: { id: true, word: true } })

  const ids = await weekSignIds(studentId, allSigns)
  let source: "week" | "saved" = "week"
  let signs: PracticeSign[] = []
  if (ids.size > 0) {
    const rows = await prisma.sign.findMany({ where: { id: { in: [...ids] } }, select: signSelect })
    signs = shuffled(await toPracticeSigns(rows)).slice(0, PRACTICE_ROUND_SIGNS)
  }
  if (signs.length === 0) {
    source = "saved"
    signs = await savedPracticeSigns(studentId)
  }

  const roundWords = signs.map((s) => s.answer)
  const dictionaryWords = shuffled(allSigns.map((s) => s.word))
  const withChoices = signs.map((sign) => {
    const others: string[] = []
    for (const word of [...shuffled(roundWords), ...dictionaryWords]) {
      if (others.length >= VOCABULARY_CHOICES - 1) break
      if (!sameWord(word, sign.answer) && !others.some((w) => sameWord(w, word))) others.push(word)
    }
    return { ...sign, choices: shuffled([sign.answer, ...others]) }
  })

  return { source, signs: withChoices }
}
