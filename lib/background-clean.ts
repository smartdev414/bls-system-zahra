/**
 * Background replacement after upload.
 *
 * The recorders can put a flat colour behind the tutor live in the browser,
 * but the model that has to run there can't follow fast hands. When this is
 * configured they upload the camera as it was instead, and a RunPod worker
 * (agents/background-replacer) redoes the job properly a few minutes later.
 *
 * The raw upload is named `….raw.webm` and the finished file is written next
 * to it as `….clean.mp4`. The media gateway serves the clean one once it
 * exists, so the URL saved on the lesson or sign never changes. Until then the
 * recording is the tutor's to see, not students': the raw file shows their
 * real room and has no logo.
 *
 * Each recording has a VideoCleanJob row, which is how the tutor is shown
 * progress after leaving the recorder, told when it finishes or fails, and
 * given a retry. RunPod reports the outcome to /api/webhooks/runpod; a job
 * whose report never arrives is caught up with the next time anyone looks.
 *
 * Server-only. The key helpers the browser needs are in
 * lib/background-clean-keys.ts.
 */

import { createHmac, timingSafeEqual } from "crypto"
import prisma from "@/lib/prisma"
import type { VideoCleanJob } from "@/app/generated/prisma/client"
import { getPresignedDownloadUrl, getPresignedUploadUrl, objectExists, publicUrl } from "@/lib/s3"
import { publicAppUrl } from "@/lib/publicUrl"
import { createNotification } from "@/lib/notifications"
import { cleanKeyFor, rawKeyFromUrl } from "@/lib/background-clean-keys"
import { LOGO_MARK_SRC } from "@/components/layout/logo"

const RUNPOD_API = "https://api.runpod.ai/v2"
// A job can wait for a worker to start and then run for several minutes per
// minute of video; the signed URLs have to outlive both.
const JOB_URL_TTL_SECS = 6 * 60 * 60
// Longest a single job may run before RunPod stops it (and stops charging).
const JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000
// How long to trust that RunPod's report is still on its way before asking.
const STALE_AFTER_MS = 2 * 60 * 1000

export type CleanState = "processing" | "done" | "failed"

function endpoint(): { id: string; key: string } | null {
  const id = process.env.RUNPOD_BACKGROUND_ENDPOINT_ID
  const key = process.env.RUNPOD_API_KEY
  return id && key ? { id, key } : null
}

export function backgroundCleanConfigured(): boolean {
  return endpoint() !== null
}

// ─── Webhook signature ───────────────────────────────────────────────────────
// RunPod calls back to a URL we give it and sends nothing to prove who it is,
// so the URL itself carries a signature only this server could have made.

function sign(jobId: string): string {
  const secret = process.env.JWT_SECRET ?? "bsl-dev-secret-change-in-production"
  return createHmac("sha256", secret).update(`video-clean:${jobId}`).digest("hex")
}

export function verifyCleanWebhook(jobId: string, signature: string): boolean {
  const expected = Buffer.from(sign(jobId))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// ─── Starting and retrying ───────────────────────────────────────────────────

/** Hands the job to RunPod. Returns RunPod's id for it. */
async function sendToRunpod(job: Pick<VideoCleanJob, "id" | "rawKey" | "color">): Promise<string> {
  const target = endpoint()
  if (!target) throw new Error("Background replacement is not configured")

  const [sourceUrl, uploadUrl] = await Promise.all([
    getPresignedDownloadUrl(job.rawKey, JOB_URL_TTL_SECS),
    getPresignedUploadUrl(cleanKeyFor(job.rawKey), "video/mp4", JOB_URL_TTL_SECS),
  ])
  const res = await fetch(`${RUNPOD_API}/${target.id}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${target.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: {
        source_url: sourceUrl,
        upload_url: uploadUrl,
        color: job.color,
        logo_url: `${publicAppUrl()}${LOGO_MARK_SRC}`,
      },
      webhook: `${publicAppUrl()}/api/webhooks/runpod?job=${job.id}&sig=${sign(job.id)}`,
      policy: { executionTimeout: JOB_TIMEOUT_MS },
    }),
  })
  if (!res.ok) throw new Error(`RunPod refused the job (${res.status})`)
  const { id } = await res.json() as { id?: string }
  if (!id) throw new Error("RunPod returned no job id")
  return id
}

/**
 * (Re)start background replacement for a raw recording. Never throws: a job
 * that could not be handed over comes back FAILED, ready to be retried.
 */
export async function startBackgroundClean(rawKey: string, userId: string, color: string): Promise<VideoCleanJob> {
  const job = await prisma.videoCleanJob.upsert({
    where: { rawKey },
    create: { rawKey, userId, color },
    update: { color, status: "PROCESSING", runpodJobId: null },
  })
  try {
    const runpodJobId = await sendToRunpod(job)
    return await prisma.videoCleanJob.update({ where: { id: job.id }, data: { runpodJobId } })
  } catch (err) {
    console.error(`[background-clean] could not start job for ${rawKey}`, err)
    return prisma.videoCleanJob.update({ where: { id: job.id }, data: { status: "FAILED" } })
  }
}

// ─── Finishing ───────────────────────────────────────────────────────────────

/**
 * Record how a job ended and tell whoever recorded the video. Safe to call
 * twice for the same job (webhook and catch-up can both get there): only the
 * call that actually moves it out of PROCESSING notifies.
 */
export async function settleBackgroundClean(jobId: string, succeeded: boolean): Promise<void> {
  const job = await prisma.videoCleanJob.findUnique({ where: { id: jobId } })
  if (!job || job.status !== "PROCESSING") return

  // "Completed" only counts if the finished file really is where it should be.
  const done = succeeded && await objectExists(cleanKeyFor(job.rawKey))
  const { count } = await prisma.videoCleanJob.updateMany({
    where: { id: jobId, status: "PROCESSING" },
    data: { status: done ? "DONE" : "FAILED" },
  })
  if (count === 0) return

  const fileUrl = publicUrl(job.rawKey)
  const [sign, asset, user] = await Promise.all([
    prisma.sign.findFirst({ where: { videoUrl: fileUrl }, select: { word: true } }),
    prisma.lessonAsset.findFirst({
      where: { fileUrl },
      select: { lesson: { select: { id: true, title: true, section: { select: { courseId: true } } } } },
    }),
    prisma.user.findUnique({ where: { id: job.userId }, select: { role: true } }),
  ])
  const lesson = asset?.lesson
  const what = sign ? `the sign "${sign.word}"` : lesson ? `the lesson "${lesson.title}"` : "your recording"
  const link = sign
    ? "/admin/signs"
    : lesson && user?.role === "TUTOR"
    ? `/tutor/courses/${lesson.section.courseId}/lessons/${lesson.id}`
    : undefined

  if (!done) {
    await createNotification(
      job.userId,
      "VIDEO_BACKGROUND_FAILED",
      "A video's background could not be replaced",
      `The background on ${what} could not be replaced, so students cannot see that video yet. Open it and press Retry, or record it again.`,
      link,
    )
    return
  }
  // A dictionary sitting can be hundreds of takes; one message each would
  // bury everything else. Signs only speak up when something goes wrong.
  if (sign) return
  await createNotification(
    job.userId,
    "VIDEO_BACKGROUND_READY",
    "Your video is ready",
    `The background on ${what} has been replaced and students can now watch it.`,
    link,
  )
}

/** Ask RunPod about jobs whose report is overdue, and settle any that have ended. */
async function catchUp(jobs: VideoCleanJob[]): Promise<void> {
  const target = endpoint()
  const overdue = jobs.filter(
    (job) => job.status === "PROCESSING" && Date.now() - job.updatedAt.getTime() > STALE_AFTER_MS,
  )
  await Promise.all(overdue.map(async (job) => {
    try {
      // Never reached RunPod at all (the server died between the two writes).
      if (!job.runpodJobId || !target) return await settleBackgroundClean(job.id, false)
      const res = await fetch(`${RUNPOD_API}/${target.id}/status/${encodeURIComponent(job.runpodJobId)}`, {
        headers: { Authorization: `Bearer ${target.key}` },
        cache: "no-store",
      })
      // RunPod forgets finished jobs after a while; the file says how it went.
      if (res.status === 404) return await settleBackgroundClean(job.id, true)
      if (!res.ok) return
      const { status } = await res.json() as { status?: string }
      if (status === "COMPLETED") await settleBackgroundClean(job.id, true)
      else if (status !== "IN_QUEUE" && status !== "IN_PROGRESS") await settleBackgroundClean(job.id, false)
    } catch (err) {
      console.error(`[background-clean] catch-up failed for job ${job.id}`, err)
    }
  }))
}

// ─── Reading state ───────────────────────────────────────────────────────────

/** Where each of these stored file URLs stands. URLs that aren't raw recordings are left out. */
export async function cleanStatesForUrls(urls: string[]): Promise<Record<string, CleanState>> {
  const keyByUrl = new Map<string, string>()
  for (const url of urls) {
    const key = rawKeyFromUrl(url)
    if (key) keyByUrl.set(url, key)
  }
  if (keyByUrl.size === 0) return {}

  const rawKeys = [...new Set(keyByUrl.values())]
  await catchUp(await prisma.videoCleanJob.findMany({ where: { rawKey: { in: rawKeys }, status: "PROCESSING" } }))
  const jobs = await prisma.videoCleanJob.findMany({
    where: { rawKey: { in: rawKeys } },
    select: { rawKey: true, status: true },
  })
  const statusByKey = new Map(jobs.map((job) => [job.rawKey, job.status]))

  const states: Record<string, CleanState> = {}
  for (const [url, key] of keyByUrl) {
    const status = statusByKey.get(key)
    // A raw recording with no job never had one started: as good as failed.
    states[url] = status === "DONE" ? "done" : status === "PROCESSING" ? "processing" : "failed"
  }
  return states
}

/**
 * The stored file URLs among these that students must not be given yet: raw
 * recordings whose background hasn't been replaced. If that can't be looked
 * up, every raw recording is held back — hiding one for a moment is better
 * than showing a tutor's room.
 */
export async function urlsHiddenFromStudents(urls: (string | null | undefined)[]): Promise<Set<string>> {
  const keyByUrl = new Map<string, string>()
  for (const url of urls) {
    const key = url ? rawKeyFromUrl(url) : null
    if (url && key) keyByUrl.set(url, key)
  }
  if (keyByUrl.size === 0) return new Set()

  let finished = new Set<string>()
  try {
    const jobs = await prisma.videoCleanJob.findMany({
      where: { rawKey: { in: [...new Set(keyByUrl.values())] }, status: "DONE" },
      select: { rawKey: true },
    })
    finished = new Set(jobs.map((job) => job.rawKey))
  } catch (err) {
    console.error("[background-clean] could not look up finished recordings", err)
  }
  return new Set([...keyByUrl].filter(([, key]) => !finished.has(key)).map(([url]) => url))
}
