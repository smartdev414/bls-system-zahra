export type QuestionBody = {
  question: string
  /** Image or video shown with the question. */
  imageUrl?: string | null
  mediaType?: string | null
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE"
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
export function validateQuestion(body: QuestionBody): string | null {
  if (!body.question?.trim()) return "Question text is required"
  if (!Array.isArray(body.options) || body.options.length < 2) return "A question needs at least two options"
  // Students pick one answer, so exactly one can be right.
  if (body.options.filter((o) => o.isCorrect).length !== 1) return "Mark exactly one option as the correct answer"
  // Each option must have text OR an image
  if (body.options.some((o) => !o.text?.trim() && !o.imageUrl)) return "Each option needs text or an image"
  return null
}
