/**
 * Students' recordings of signed answers in tests.
 *
 * Stored at `test-answers/{lessonId}/{userId}/{recordedAt}-{uuid}.{ext}`, which
 * is private (lib/protected-media.ts): the student who made it and the
 * course's teachers can watch it, nobody else. They are kept until the course
 * ends: archiving (or deleting) it deletes them all, and a student taken off
 * the course loses theirs. Being filed by test and student, a take recorded
 * again over — never submitted — goes with the rest.
 */
import { randomUUID } from "crypto"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { deleteObject, listObjectKeys } from "@/lib/s3"

export const ANSWER_VIDEO_PREFIX = "test-answers/"

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

/** Deletes the recordings under these key prefixes and clears them from the answers that used them. */
async function deleteUnder(prefixes: string[], answers: Prisma.QuizAttemptAnswerWhereInput): Promise<number> {
  let deleted = 0
  for (const prefix of prefixes) {
    for (const key of await listObjectKeys(prefix)) {
      await deleteObject(key)
      deleted++
    }
  }
  await prisma.quizAttemptAnswer.updateMany({ where: { ...answers, videoUrl: { not: null } }, data: { videoUrl: null } })
  return deleted
}

/**
 * When a course ends — it is archived or deleted — its students' recordings
 * go; with `studentId`, only that student's, as they leave the course. Never
 * throws: a failure is logged, and must not stop the archive or removal.
 */
export async function deleteCourseAnswerVideos(courseId: string, studentId?: string): Promise<void> {
  try {
    const lessons = await prisma.lesson.findMany({ where: { type: "QUIZ", section: { courseId } }, select: { id: true } })
    if (lessons.length === 0) return
    const prefixes = lessons.map((l) => `${ANSWER_VIDEO_PREFIX}${l.id}/${studentId ? `${studentId}/` : ""}`)
    await deleteUnder(prefixes, {
      attempt: { lessonId: { in: lessons.map((l) => l.id) }, ...(studentId && { userId: studentId }) },
    })
  } catch (err) {
    console.error("[test-recordings] deleting a course's recordings", courseId, studentId, err)
  }
}

/** Every recording a student made, on any course — for when their account is deleted. */
export async function deleteStudentAnswerVideos(studentId: string): Promise<void> {
  try {
    for (const key of await listObjectKeys(ANSWER_VIDEO_PREFIX)) {
      if (parseAnswerVideoKey(key)?.userId === studentId) await deleteObject(key)
    }
  } catch (err) {
    console.error("[test-recordings] deleting a student's recordings", studentId, err)
  }
}
