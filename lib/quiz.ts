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
  /** Vocabulary tests: which way round the signs are practised. */
  vocabularyMode: VocabularyMode
  /** Assessments: minutes to film the answers to each part. */
  answerMinutes: number
  /** Assessments: a teacher marks the answers instead of the student. */
  tutorMarks: boolean
}


// ─── Kinds of test ────────────────────────────────────────────────────────────

export const TEST_KINDS = ["STANDARD", "STORY", "FINGERSPELLING", "VOCABULARY", "ASSESSMENT"] as const
export type TestKind = (typeof TEST_KINDS)[number]

export const TEST_KIND_INFO: Record<TestKind, { label: string; hint: string }> = {
  STANDARD: { label: "Questions", hint: "Questions, each with or without a video." },
  STORY: { label: "Story", hint: "One signed story, then questions about it." },
  FINGERSPELLING: { label: "Fingerspelling", hint: "Students watch a word being spelled and type it." },
  VOCABULARY: { label: "Vocabulary", hint: "Students pick the word for a sign, or read a word and sign it." },
  ASSESSMENT: { label: "Assessment", hint: "A signed story in parts. Students watch each part's questions and the part, then film their answers." },
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

// ─── Vocabulary both ways round ───────────────────────────────────────────────

export const VOCABULARY_MODES = ["PICK_WORD", "SIGN_IT", "BOTH"] as const
export type VocabularyMode = (typeof VOCABULARY_MODES)[number]

export const VOCABULARY_MODE_INFO: Record<VocabularyMode, { label: string; hint: string }> = {
  PICK_WORD: { label: "Sign → word", hint: "Students watch each sign and pick its word, against the clock." },
  SIGN_IT: { label: "Word → sign", hint: "Students read each word and film themselves signing it. Then the sign plays next to theirs and they mark it." },
  BOTH: { label: "Both ways", hint: "Students first read each word and sign it, then watch the signs and pick the words." },
}

export function parseVocabularyMode(value: unknown): VocabularyMode | null {
  return VOCABULARY_MODES.includes(value as VocabularyMode) ? (value as VocabularyMode) : null
}

/** A vocabulary test the student watches and picks words in (one way, or both ways round). */
export function picksWords(test: { testKind: string; vocabularyMode?: string | null }): boolean {
  return test.testKind === "VOCABULARY" && test.vocabularyMode !== "SIGN_IT"
}

/** A vocabulary test the student signs the words in (one way, or both ways round). */
export function signsWords(test: { testKind: string; vocabularyMode?: string | null }): boolean {
  return test.testKind === "VOCABULARY" && (test.vocabularyMode === "SIGN_IT" || test.vocabularyMode === "BOTH")
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
  /** Vocabulary signed: the word to sign. */
  word?: string
}

/**
 * A fingerspelling or vocabulary test as the student is sent it: the word is
 * the answer, so it is left out. In a vocabulary test each sign comes with
 * words to pick from — its own, and others taken from the rest of the test.
 *
 * A vocabulary test the student signs sends each word to sign. Signed only
 * (no picking), the sign's video is held back until they have submitted
 * (`showModel`) — it is what they mark their own signing against.
 */
export function signQuestionsForStudent(
  test: { testKind: "FINGERSPELLING" | "VOCABULARY"; vocabularyMode?: string | null },
  questions: ReadonlyArray<{ id: string; question: string; imageUrl: string | null; mediaType: string | null }>,
  reveal: boolean,
  showModel: boolean,
): SignQuestion[] {
  const picks = test.testKind === "FINGERSPELLING" || picksWords(test)
  return questions.map((q) => {
    const sign: SignQuestion = picks || showModel
      ? { id: q.id, imageUrl: q.imageUrl, mediaType: q.mediaType }
      : { id: q.id, imageUrl: null, mediaType: null }
    if (reveal) sign.answer = q.question
    if (signsWords(test)) sign.word = q.question
    if (test.testKind === "VOCABULARY" && picks) {
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

// ─── Assessments ──────────────────────────────────────────────────────────────
// Each question of an assessment is one part of the story: its questions
// signed on video (questionsVideoUrl), the part itself (imageUrl), and the
// answer sheet (modelAnswer) with what the part is worth (maxMarks). It is
// stored as a WRITTEN question, so it is marked like one — 0 up to its marks —
// but the student films their answers instead of typing them.

/** Minutes a student can be given to film their answers to a part. */
export const ANSWER_MINUTES = [5, 10, 15, 20, 30] as const
export const DEFAULT_ANSWER_MINUTES = 15
/** What a part is worth unless the teacher chose otherwise, and the most it can be. */
export const DEFAULT_PART_MARKS = 10
export const MAX_PART_MARKS = 30

/** Whether the student's answer to this test is filmed, part by part. */
export function isAssessment(kind: string | null | undefined): kind is "ASSESSMENT" {
  return kind === "ASSESSMENT"
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/**
 * Reads the test settings sent by the lesson forms. Fields that were not sent
 * are left out, so a PUT only changes what it was given. Returns a message
 * instead when a value makes no sense, for the caller to answer 400 with.
 */
export function parseTestSettings(
  body: {
    passMark?: unknown; maxAttempts?: unknown; answerSeconds?: unknown; signPlays?: unknown; storyUrl?: unknown
    storyControls?: unknown; vocabularyMode?: unknown; answerMinutes?: unknown; tutorMarks?: unknown
  },
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

  if (body.vocabularyMode !== undefined) {
    const mode = parseVocabularyMode(body.vocabularyMode)
    if (!mode) return "Choose how the vocabulary is practised"
    settings.vocabularyMode = mode
  }

  if (body.answerMinutes !== undefined) {
    const answerMinutes = Number(body.answerMinutes)
    if (!ANSWER_MINUTES.includes(answerMinutes as (typeof ANSWER_MINUTES)[number])) {
      return `Time to answer each part must be ${ANSWER_MINUTES.join(", ")} minutes`
    }
    settings.answerMinutes = answerMinutes
  }

  if (body.tutorMarks !== undefined) settings.tutorMarks = body.tutorMarks === true

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

/** What students read for a question the tutor signed on video instead of typing. */
export const SIGNED_QUESTION_TEXT = "Watch the video and answer the question"

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

/**
 * Days a student has to download their recordings once the course has ended
 * for them (archived, or they left it) before they are deleted.
 */
export const ANSWER_VIDEO_GRACE_DAYS = 7

/** What a written answer is worth unless the teacher chose otherwise. */
export const DEFAULT_WRITTEN_MARKS = 3
/** The most a written answer can be worth. */
export const MAX_WRITTEN_MARKS = 10

/**
 * What a question is worth: a written answer (or an assessment's part) as many
 * marks as it was given (3 unless chosen), anything else 1.
 */
export function maxMarks(question: { type?: string | null; maxMarks?: number | null } | null | undefined): number {
  return question?.type === "WRITTEN" ? question.maxMarks ?? DEFAULT_WRITTEN_MARKS : 1
}

/** "1 mark", "2 marks" — what students see after a written question. */
export function marksLabel(marks: number): string {
  return marks === 1 ? "1 mark" : `${marks} marks`
}

/** The question's test, as far as marking goes. */
export type MarkingTest = { testKind: string; vocabularyMode?: string | null; tutorMarks?: boolean }

/**
 * How a question is marked in its test: whether it has an answer the server
 * marks — an option, or the word typed or picked, worth 1 when right — and how
 * many marks the student gives themselves on top (0 for none). A vocabulary
 * test done both ways round has both: the word picked, and the sign filmed.
 */
export function questionMarking(
  question: { type: string; maxMarks?: number | null },
  test: MarkingTest,
): { picked: boolean; self: number } {
  if (test.testKind === "VOCABULARY") return { picked: picksWords(test), self: signsWords(test) ? 1 : 0 }
  if (test.testKind === "FINGERSPELLING") return { picked: true, self: 0 }
  return isSelfMarked(question.type) ? { picked: false, self: maxMarks(question) } : { picked: true, self: 0 }
}

/** Whether an answer still waits for the student to mark it. */
export function awaitsMarks(
  question: { type: string; maxMarks?: number | null },
  answer: { marks?: number | null },
  test: MarkingTest,
): boolean {
  return questionMarking(question, test).self > 0 && (answer.marks === null || answer.marks === undefined)
}

/**
 * An attempt's score, out of 100, from its answers. An answer the server marks
 * is worth 1 when right; marks the student gave themselves count as given
 * (none until marked). With only one-mark questions this is simply the share
 * answered correctly, as it always was.
 */
export function attemptScore(
  questions: ReadonlyArray<{ id: string; type: string; maxMarks?: number | null }>,
  answers: ReadonlyArray<{ questionId: string; isCorrect: boolean; marks?: number | null }>,
  test: MarkingTest,
): { earned: number; total: number; score: number } {
  let earned = 0
  let total = 0
  for (const q of questions) {
    const { picked, self } = questionMarking(q, test)
    total += (picked ? 1 : 0) + self
    const answer = answers.find((a) => a.questionId === q.id)
    if (!answer) continue
    earned += (picked && answer.isCorrect ? 1 : 0) + Math.min(answer.marks ?? 0, self)
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

/**
 * An assessment's parts as the student is sent them. The answer sheet only
 * once `showModel` allows: after they have sent their answers in, to mark them
 * against — or, when a teacher marks, once the teacher has.
 */
export function partsForStudent<
  Q extends {
    id: string; question: string; imageUrl: string | null; mediaType: string | null
    questionsVideoUrl: string | null; modelAnswer: string | null; maxMarks: number | null
  },
>(parts: readonly Q[], showModel: boolean) {
  return parts.map((p) => ({
    id: p.id,
    question: p.question,
    type: "WRITTEN" as const,
    imageUrl: p.imageUrl,
    mediaType: p.mediaType,
    questionsVideoUrl: p.questionsVideoUrl,
    maxMarks: p.maxMarks,
    options: [],
    ...(showModel && { modelAnswer: p.modelAnswer }),
  }))
}
