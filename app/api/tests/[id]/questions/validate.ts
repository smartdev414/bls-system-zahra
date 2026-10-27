import { MAX_PART_MARKS, MAX_WRITTEN_MARKS, SIGNED_QUESTION_TEXT, isAssessment, isSelfMarked, isSignTest, isVideoMedia } from "@/lib/quiz"

export type QuestionBody = {
  question: string
  /** Image or video shown with the question. */
  imageUrl?: string | null
  mediaType?: string | null
  /** Students may pause and rewind this question's videos during the test. */
  videoControls?: boolean
  /** Hide the question and answers until its video has played to the end. */
  questionAfterVideo?: boolean
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "WRITTEN" | "SIGN"
  /** WRITTEN: what a full-marks answer says. */
  modelAnswer?: string | null
  /** WRITTEN: what it is worth; left out = 3. */
  maxMarks?: number | null
  /** SIGN: the video of the sign done right. */
  answerVideoUrl?: string | null
  /** An assessment's part: its questions, signed. */
  questionsVideoUrl?: string | null
  /** Left out for a sign in a fingerspelling or vocabulary test, and for a written or signed answer. */
  options: Array<{
    /** Present when the option already exists, so it is updated rather than replaced. */
    id?: string
    text: string
    imageUrl?: string | null
    mediaType?: string | null
    isCorrect: boolean
  }>
}

/** What is wrong with a question sent by the builder, or null when it can be saved. */
export function validateQuestion(body: QuestionBody, testKind?: string): string | null {
  // A sign to spell or name: its video and its word, nothing else. A word may
  // come first, to be filmed later — students are not given it until then.
  if (isSignTest(testKind)) {
    if (!body.question?.trim()) return "Each sign needs its word"
    return null
  }
  // A part of an assessment: its questions (signed, or written out), the part
  // itself, and the answer sheet. Marked like a written answer.
  if (isAssessment(testKind)) {
    body.type = "WRITTEN"
    body.question = body.question?.trim() ?? ""
    if (!body.questionsVideoUrl && !body.question) return "Add the video of the part's questions"
    if (!isVideoMedia(body.imageUrl, body.mediaType)) return "Add the video of the part"
    if (body.maxMarks != null && (!Number.isInteger(body.maxMarks) || body.maxMarks < 1 || body.maxMarks > MAX_PART_MARKS)) {
      return `A part is worth 1 to ${MAX_PART_MARKS} marks`
    }
    return body.modelAnswer?.trim() ? null : "Add the answer sheet"
  }
  // A question signed on video needs no typed text — it gets a default line.
  if (!body.question?.trim()) {
    if (!isVideoMedia(body.imageUrl, body.mediaType)) return "Question text is required"
    body.question = SIGNED_QUESTION_TEXT
  }
  if (body.type === "WRITTEN") {
    if (body.maxMarks != null && (!Number.isInteger(body.maxMarks) || body.maxMarks < 1 || body.maxMarks > MAX_WRITTEN_MARKS)) {
      return `A written answer is worth 1 to ${MAX_WRITTEN_MARKS} marks`
    }
    return body.modelAnswer?.trim() ? null : "Add the model answer"
  }
  if (body.type === "SIGN") return body.answerVideoUrl ? null : "Add the video of the sign"
  if (isSelfMarked(body.type)) return null
  if (!Array.isArray(body.options) || body.options.length < 2) return "A question needs at least two options"
  // True / false has one right answer; multiple choice may have several, and
  // the student then ticks them all.
  const correct = body.options.filter((o) => o.isCorrect).length
  if (correct === 0) return "Mark the correct answer"
  if (body.type === "TRUE_FALSE" && correct !== 1) return "Mark exactly one option as the correct answer"
  if (correct === body.options.length) return "At least one answer must be wrong"
  // Each option must have text OR an image
  if (body.options.some((o) => !o.text?.trim() && !o.imageUrl)) return "Each option needs text or an image"
  return null
}
