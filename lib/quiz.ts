/**
 * Tests (lessons of type QUIZ) — the rules shared by the builder, the routes
 * that mark an attempt, and the screens that show results, so they cannot
 * disagree about what passing means or when the answers may be shown.
 */

export const DEFAULT_PASS_MARK = 70
export const MAX_ATTEMPTS_LIMIT = 20

export type TestSettings = {
  passMark: number
  maxAttempts: number | null
  answerSeconds: number
  /** Sign tests: how often each video plays; null = repeats until the time is up. */
  signPlays: number | null
  storyUrl: string | null
  /** Story tests: students may pause, rewind and skip the story video. */
  storyControls: boolean
}


// ─── Kinds of test ────────────────────────────────────────────────────────────

export const TEST_KINDS = ["STANDARD", "STORY", "FINGERSPELLING", "VOCABULARY"] as const
export type TestKind = (typeof TEST_KINDS)[number]

export const TEST_KIND_INFO: Record<TestKind, { label: string; hint: string }> = {
  STANDARD: { label: "Questions", hint: "Questions, each with or without a video." },
  STORY: { label: "Story", hint: "One signed story, then questions about it." },
  FINGERSPELLING: { label: "Fingerspelling", hint: "Students watch a word being spelled and type it." },
  VOCABULARY: { label: "Vocabulary", hint: "Students watch a sign and pick the right word." },
}

export function parseTestKind(value: unknown): TestKind | null {
  return TEST_KINDS.includes(value as TestKind) ? (value as TestKind) : null
}

/**
 * Fingerspelling and vocabulary tests: each question is a video and its word
 * (kept as the question's text, with no options), answered against the clock.
 */
export function isSignTest(kind: string | null | undefined): kind is "FINGERSPELLING" | "VOCABULARY" {
  return kind === "FINGERSPELLING" || kind === "VOCABULARY"
}

/** Seconds a student can be given for each sign. */
export const ANSWER_SECONDS = [5, 10] as const
export const DEFAULT_ANSWER_SECONDS = 10

/** Words offered for each sign in a vocabulary test — the right one among them. */
export const VOCABULARY_CHOICES = 6

/** How many students the high scores list. */
export const HIGH_SCORES = 5

/** Whether two words are the same answer: capitals, spaces and punctuation do not count. */
export function sameWord(a: string | null | undefined, b: string | null | undefined): boolean {
  const plain = (word: string | null | undefined) => (word ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
  return plain(a) !== "" && plain(a) === plain(b)
}

function shuffled<T>(items: readonly T[]): T[] {
  const list = [...items]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

export type SignQuestion = {
  id: string
  imageUrl: string | null
  mediaType: string | null
  /** Vocabulary only: the words to pick from. */
  choices?: string[]
  /** The word itself — only once the student may see the correct answers. */
  answer?: string
}

/**
 * A fingerspelling or vocabulary test as the student is sent it: the word is
 * the answer, so it is left out. In a vocabulary test each sign comes with
 * words to pick from — its own, and others taken from the rest of the test.
 */
export function signQuestionsForStudent(
  kind: "FINGERSPELLING" | "VOCABULARY",
  questions: ReadonlyArray<{ id: string; question: string; imageUrl: string | null; mediaType: string | null }>,
  reveal: boolean,
): SignQuestion[] {
  return questions.map((q) => {
    const sign: SignQuestion = { id: q.id, imageUrl: q.imageUrl, mediaType: q.mediaType }
    if (reveal) sign.answer = q.question
    if (kind === "VOCABULARY") {
      const others: string[] = []
      for (const other of shuffled(questions)) {
        if (others.length >= VOCABULARY_CHOICES - 1) break
        if (!sameWord(other.question, q.question) && !others.some((w) => sameWord(w, other.question))) {
          others.push(other.question)
        }
      }
      sign.choices = shuffled([q.question, ...others])
    }
    return sign
  })
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/**
 * Reads the test settings sent by the lesson forms. Fields that were not sent
 * are left out, so a PUT only changes what it was given. Returns a message
 * instead when a value makes no sense, for the caller to answer 400 with.
 */
export function parseTestSettings(
  body: { passMark?: unknown; maxAttempts?: unknown; answerSeconds?: unknown; signPlays?: unknown; storyUrl?: unknown; storyControls?: unknown },
): Partial<TestSettings> | string {
  const settings: Partial<TestSettings> = {}

  if (body.passMark !== undefined) {
    const passMark = Number(body.passMark)
    if (!Number.isInteger(passMark) || passMark < 1 || passMark > 100) {
      return "Pass mark must be a whole number from 1 to 100"
    }
    settings.passMark = passMark
  }

  if (body.maxAttempts !== undefined) {
    if (body.maxAttempts === null || body.maxAttempts === "") {
      settings.maxAttempts = null
    } else {
      const maxAttempts = Number(body.maxAttempts)
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS_LIMIT) {
        return `Attempts must be a whole number from 1 to ${MAX_ATTEMPTS_LIMIT}, or left unlimited`
      }
      settings.maxAttempts = maxAttempts
    }
  }

  if (body.answerSeconds !== undefined) {
    const answerSeconds = Number(body.answerSeconds)
    if (!ANSWER_SECONDS.includes(answerSeconds as (typeof ANSWER_SECONDS)[number])) {
      return `Time for each sign must be ${ANSWER_SECONDS.join(" or ")} seconds`
    }
    settings.answerSeconds = answerSeconds
  }

  if (body.signPlays !== undefined) {
    if (body.signPlays === null || body.signPlays === "") {
      settings.signPlays = null
    } else {
      const signPlays = Number(body.signPlays)
      if (signPlays !== 1 && signPlays !== 2) return "Each sign plays once, twice, or on repeat"
      settings.signPlays = signPlays
    }
  }

  if (body.storyUrl !== undefined) {
    settings.storyUrl = typeof body.storyUrl === "string" && body.storyUrl.trim() ? body.storyUrl.trim() : null
  }

  if (body.storyControls !== undefined) settings.storyControls = body.storyControls === true

  return settings
}

/** Attempts a student still has; null when the test can be sat any number of times. */
export function attemptsLeft(maxAttempts: number | null, used: number): number | null {
  return maxAttempts === null ? null : Math.max(0, maxAttempts - used)
}

/**
 * Whether a student may be shown which answers were correct.
 *
 * A test with unlimited attempts is practice: the answers are shown after every
 * go. Once attempts are limited, showing them after a failed go would hand over
 * the next one, so they are held back until the student has passed or has no
 * attempts left. Until then they only see which of their own answers were right.
 */
export function revealsAnswers(maxAttempts: number | null, attempts: ReadonlyArray<{ passed: boolean }>): boolean {
  if (maxAttempts === null) return true
  return attempts.some((a) => a.passed) || attempts.length >= maxAttempts
}

/**
 * How many questions must be right to reach the pass mark. Scores are rounded
 * to a whole percent when an attempt is marked, so the same rounding is used.
 */
export function correctNeeded(passMark: number, total: number): number {
  let needed = 0
  while (needed < total && Math.round((needed / total) * 100) < passMark) needed++
  return needed
}

/** Question and answer media is stored as one URL; this says how to show it. */
export function isVideoMedia(url: string | null | undefined, mediaType?: string | null): boolean {
  if (mediaType === "video") return true
  if (mediaType === "image" || !url) return false
  return /\.(mp4|webm|mov|ogg|m4v)(\?|$)/i.test(url)
}

/**
 * Whether a question has more than one correct answer. The student is then
 * asked to tick every one of them, and gets the question right only when they
 * tick exactly those — no fewer, no more.
 */
export function hasMultipleAnswers(options: ReadonlyArray<{ isCorrect: boolean }>): boolean {
  return options.filter((o) => o.isCorrect).length > 1
}

/** The options a stored answer ticked: optionIds for a several-answer question, else its one optionId. */
export function chosenOptionIds(answer: { optionId: string | null; optionIds?: string[] | null } | null | undefined): string[] {
  if (!answer) return []
  if (answer.optionIds && answer.optionIds.length > 0) return answer.optionIds
  return answer.optionId ? [answer.optionId] : []
}

// ─── Questions the student marks ──────────────────────────────────────────────

/**
 * Written and signed answers cannot be marked by the server. Once the attempt
 * is submitted the student sees the model answer (or the sign's video next to
 * their own) and marks themselves; a teacher can change the marks afterwards.
 */
export function isSelfMarked(type: string | null | undefined): type is "WRITTEN" | "SIGN" {
  return type === "WRITTEN" || type === "SIGN"
}

/** What a question is worth: a written answer up to 3 marks, anything else 1. */
export function maxMarks(type: string | null | undefined): number {
  return type === "WRITTEN" ? 3 : 1
}

/** How long a student's recording of a signed answer is kept. */
export const ANSWER_VIDEO_DAYS = 30

/**
 * An attempt's score, out of 100, from its answers. A self-marked question
 * counts the marks given (none until it is marked); any other question is
 * worth 1 when right. With only one-mark questions this is simply the share
 * answered correctly, as it always was.
 */
export function attemptScore(
  questions: ReadonlyArray<{ id: string; type: string }>,
  answers: ReadonlyArray<{ questionId: string; isCorrect: boolean; marks?: number | null }>,
): { earned: number; total: number; score: number } {
  let earned = 0
  let total = 0
  for (const q of questions) {
    const answer = answers.find((a) => a.questionId === q.id)
    total += maxMarks(q.type)
    if (!answer) continue
    earned += isSelfMarked(q.type) ? Math.min(answer.marks ?? 0, maxMarks(q.type)) : answer.isCorrect ? 1 : 0
  }
  return { earned, total, score: total > 0 ? Math.round((earned / total) * 100) : 0 }
}

/**
 * A Questions or Story test's questions as the student is sent them. Which
 * options are correct only once `reveal` allows; the model answer of a written
 * or signed question only once `showModel` does (after their first submit,
 * when they need it to mark themselves).
 */
export function questionsForStudent<
  Q extends {
    type: string
    modelAnswer: string | null
    answerVideoUrl: string | null
    options: ReadonlyArray<{ isCorrect: boolean }>
  },
>(questions: readonly Q[], reveal: boolean, showModel: boolean) {
  return questions.map(({ modelAnswer, answerVideoUrl, ...q }) => ({
    ...q,
    // Whether to tick every correct answer, without saying which they are.
    multiple: hasMultipleAnswers(q.options),
    options: q.options.map(({ isCorrect, ...option }) => (reveal ? { ...option, isCorrect } : option)),
    ...(showModel && isSelfMarked(q.type) && { modelAnswer, answerVideoUrl }),
  }))
}
