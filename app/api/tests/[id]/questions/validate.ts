import { isSignTest } from "@/lib/quiz"

export type QuestionBody = {
  question: string
  /** Image or video shown with the question. */
  imageUrl?: string | null
  mediaType?: string | null
  /** Students may pause and rewind this question's videos during the test. */
  videoControls?: boolean
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE"
  /** Left out for a sign in a fingerspelling or vocabulary test. */
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
  // A sign to spell or name: its video and its word, nothing else.
  if (isSignTest(testKind)) {
    if (!body.imageUrl) return "Each sign needs its video"
    if (!body.question?.trim()) return "Each sign needs its word"
    return null
  }
  if (!body.question?.trim()) return "Question text is required"
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
