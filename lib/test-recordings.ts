/**
 * Students' recordings of signed answers in tests.
 *
 * Stored at `test-answers/{lessonId}/{userId}/{recordedAt}-{uuid}.{ext}`, which
 * is private (lib/protected-media.ts): the student who made it and the
 * course's teachers can watch it, nobody else. They are kept while the course
 * runs. When it ends for a student — the course is archived, or they leave it
 * — they are told to download them, reminded the day before, and a week later
 * they are deleted (scheduleAnswerVideoDeletion, runAnswerVideoDeletions).
 * Deleting the course or the student's account deletes them straight away.
 * Being filed by test and student, a take recorded again over — never
 * submitted — goes with the rest.
 */
import { randomUUID } from "crypto"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { deleteObject, listObjectKeys } from "@/lib/s3"
import { createNotification } from "@/lib/notifications"
import { ANSWER_VIDEO_GRACE_DAYS } from "@/lib/quiz"

export const ANSWER_VIDEO_PREFIX = "test-answers/"

/** Recording formats browsers produce (and phones' own camera apps). */
export const ANSWER_VIDEO_TYPES: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
}

/** A short signed answer is a few MB; this only stops something absurd. */
export const ANSWER_VIDEO_MAX_BYTES = 150 * 1024 * 1024
/** An assessment's answers to one part run to many minutes, filmed in one go. */
export const ASSESSMENT_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024

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
  // A teacher's feedback is kept in the same folder, and went with it.
  await prisma.quizAttemptAnswer.updateMany({ where: { ...answers, feedbackVideoUrl: { not: null } }, data: { feedbackVideoUrl: null } })
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
    // A teacher's filmed feedback on a self-reflection is kept in the same folders.
    await prisma.reflectionFeedback.updateMany({
      where: {
        videoUrl: { not: null },
        submission: { lessonId: { in: lessons.map((l) => l.id) }, ...(studentId && { userId: studentId }) },
      },
      data: { videoUrl: null },
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

// ─── A week to download them ──────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000

/** Where a student finds and downloads their recordings. */
export const MY_VIDEOS_PATH = "/student/videos"

const dateLabel = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" })

/**
 * The course has ended for these students (with `studentId`, just that one):
 * their recordings in its tests are deleted in ANSWER_VIDEO_GRACE_DAYS, and
 * they are told so now, with a link to download them. A student with nothing
 * recorded hears nothing. Never throws.
 */
export async function scheduleAnswerVideoDeletion(courseId: string, studentId?: string): Promise<void> {
  try {
    const recorded = await prisma.quizAttempt.findMany({
      where: {
        lesson: { section: { courseId } },
        ...(studentId && { userId: studentId }),
        answers: { some: { videoUrl: { not: null } } },
      },
      distinct: ["userId"],
      select: { userId: true, lesson: { select: { section: { select: { course: { select: { title: true } } } } } } },
    })
    const deleteAt = new Date(Date.now() + ANSWER_VIDEO_GRACE_DAYS * DAY)
    for (const { userId, lesson } of recorded) {
      const existing = await prisma.testVideoDeletion.findUnique({ where: { userId_courseId: { userId, courseId } } })
      if (existing) continue
      await prisma.testVideoDeletion.create({ data: { userId, courseId, deleteAt } })
      void createNotification(
        userId,
        "TEST_VIDEOS_EXPIRING",
        "Download your signing videos",
        `"${lesson.section.course.title}" has finished for you. Your signing videos from its tests will be deleted on ${dateLabel(deleteAt)} — download any you want to keep before then.`,
        MY_VIDEOS_PATH,
      )
    }
  } catch (err) {
    console.error("[test-recordings] scheduling deletion", courseId, studentId, err)
  }
}

/**
 * Run by the cron: reminds students the day before their recordings go, and
 * deletes those whose week is up. A student back on the course (or a course
 * brought back from the archive) keeps theirs — the deletion is dropped.
 */
export async function runAnswerVideoDeletions(now = new Date()): Promise<{ reminded: number; deleted: number; kept: number }> {
  const result = { reminded: 0, deleted: 0, kept: 0 }
  const pending = await prisma.testVideoDeletion.findMany({ where: { deleteAt: { lte: new Date(now.getTime() + DAY) } } })
  for (const row of pending) {
    const course = await prisma.course.findUnique({ where: { id: row.courseId }, select: { title: true, status: true } })
    const enrolled = course && course.status !== "ARCHIVED" && await prisma.enrollment.findFirst({
      where: { courseId: row.courseId, studentId: row.userId },
      select: { id: true },
    })
    if (enrolled) {
      await prisma.testVideoDeletion.delete({ where: { id: row.id } })
      result.kept++
      continue
    }
    if (row.deleteAt <= now) {
      await deleteCourseAnswerVideos(row.courseId, row.userId)
      await prisma.testVideoDeletion.delete({ where: { id: row.id } })
      result.deleted++
      continue
    }
    // The day before — unless the week was cut short to a day already.
    if (!row.remindedAt && row.createdAt.getTime() < now.getTime() - DAY) {
      await prisma.testVideoDeletion.update({ where: { id: row.id }, data: { remindedAt: now } })
      void createNotification(
        row.userId,
        "TEST_VIDEOS_EXPIRING",
        "Your signing videos are deleted tomorrow",
        `Your signing videos from "${course?.title ?? "your course"}" will be deleted on ${dateLabel(row.deleteAt)}. Download any you want to keep now.`,
        MY_VIDEOS_PATH,
      )
      result.reminded++
    }
  }
  return result
}
