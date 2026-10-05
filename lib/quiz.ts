/**
 * Tests (lessons of type QUIZ) — the rules shared by the builder, the routes
 * that mark an attempt, and the screens that show results, so they cannot
 * disagree about what passing means or when the answers may be shown.
 */

export const DEFAULT_PASS_MARK = 70
export const MAX_ATTEMPTS_LIMIT = 20

export type TestSettings = { passMark: number; maxAttempts: number | null }

/**
 * Reads the test settings sent by the lesson forms. Fields that were not sent
 * are left out, so a PUT only changes what it was given. Returns a message
 * instead when a value makes no sense, for the caller to answer 400 with.
 */
export function parseTestSettings(body: { passMark?: unknown; maxAttempts?: unknown }): Partial<TestSettings> | string {
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

/** Question and answer media is stored as one URL; this says how to show it. */
export function isVideoMedia(url: string | null | undefined, mediaType?: string | null): boolean {
  if (mediaType === "video") return true
  if (mediaType === "image" || !url) return false
  return /\.(mp4|webm|mov|ogg|m4v)(\?|$)/i.test(url)
}
