/**
 * Students' recordings of signed answers in tests.
 *
 * Stored at `test-answers/{lessonId}/{userId}/{recordedAt}-{uuid}.{ext}`, which
 * is private (lib/protected-media.ts): the student who made it and the
 * course's teachers can watch it, nobody else. The time in the name is what
 * the clean-up goes by, so a take the student recorded again over — and never
 * submitted — is deleted on the same 30 days as the rest.
 */
import { randomUUID } from "crypto"
import prisma from "@/lib/prisma"
import { deleteObject, listObjectKeys, publicUrl } from "@/lib/s3"
import { ANSWER_VIDEO_DAYS } from "@/lib/quiz"

export const ANSWER_VIDEO_PREFIX = "test-answers/"

const DAY = 24 * 60 * 60 * 1000

/** Recording formats browsers produce (and phones' own camera apps). */
export const ANSWER_VIDEO_TYPES: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
}

/** A short signed answer is a few MB; this only stops something absurd. */
export const ANSWER_VIDEO_MAX_BYTES = 150 * 1024 * 1024

export function answerVideoKey(lessonId: string, userId: string, contentType: string): string {
  const ext = ANSWER_VIDEO_TYPES[contentType.split(";")[0]] ?? "webm"
  return `${ANSWER_VIDEO_PREFIX}${lessonId}/${userId}/${Date.now()}-${randomUUID()}.${ext}`
}

/** Lesson, student and recording time named by a recording's key, or null when it is not one. */
export function parseAnswerVideoKey(key: string): { lessonId: string; userId: string; recordedAt: number } | null {
  const m = key.match(/^test-answers\/([^/]+)\/([^/]+)\/(\d+)-[0-9a-f-]+\.(webm|mp4|mov)$/)
  return m ? { lessonId: m[1], userId: m[2], recordedAt: Number(m[3]) } : null
}

/** The key inside a stored S3 URL. */
export function keyOfUrl(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1))
  } catch {
    return null
  }
}

/** Whether a URL sent with an attempt is this student's own recording for this test. */
export function isOwnAnswerVideo(url: unknown, lessonId: string, userId: string): url is string {
  if (typeof url !== "string") return false
  const key = keyOfUrl(url)
  const parsed = key ? parseAnswerVideoKey(key) : null
  return !!parsed && parsed.lessonId === lessonId && parsed.userId === userId
}

/**
 * Deletes recordings older than ANSWER_VIDEO_DAYS, and clears them from the
 * answers that pointed at them, which then show "deleted after 30 days". Run
 * by the cron (app/api/cron/reminders). Returns how many files went.
 */
export async function deleteExpiredAnswerVideos(now = new Date()): Promise<number> {
  const cutoff = now.getTime() - ANSWER_VIDEO_DAYS * DAY
  const deleted: string[] = []
  for (const key of await listObjectKeys(ANSWER_VIDEO_PREFIX)) {
    const parsed = parseAnswerVideoKey(key)
    if (!parsed || parsed.recordedAt >= cutoff) continue
    await deleteObject(key)
    deleted.push(publicUrl(key))
  }
  await prisma.quizAttemptAnswer.updateMany({
    where: {
      OR: [
        { videoUrl: { in: deleted } },
        { videoUrl: { not: null }, attempt: { createdAt: { lt: new Date(cutoff) } } },
      ],
    },
    data: { videoUrl: null },
  })
  return deleted.length
}
