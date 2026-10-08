/**
 * Background replacement after upload.
 *
 * The recorders can put a flat colour behind the tutor live in the browser,
 * but the model that has to run there can't follow fast hands. When this is
 * configured they upload the camera as it was instead, and a RunPod worker
 * (agents/background-replacer) redoes the job properly a few minutes later.
 *
 * Nothing is stored about a job. The raw upload is named `….raw.webm`, the
 * finished file is written next to it as `….clean.mp4`, and the media gateway
 * serves the clean one once it exists — so the URL saved on the lesson or sign
 * never changes, and a failed job simply leaves the raw recording playing.
 *
 * Server-only (reads the RunPod key). The key helpers the browser needs are
 * in lib/background-clean-keys.ts.
 */

import { getPresignedDownloadUrl, getPresignedUploadUrl } from "@/lib/s3"
import { publicAppUrl } from "@/lib/publicUrl"
import { cleanKeyFor } from "@/lib/background-clean-keys"

const RUNPOD_API = "https://api.runpod.ai/v2"
// A job can wait for a worker to start and then run for several minutes per
// minute of video; the signed URLs have to outlive both.
const JOB_URL_TTL_SECS = 6 * 60 * 60
// Longest a single job may run before RunPod stops it (and stops charging).
const JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000

export type CleanStatus = "queued" | "running" | "done" | "failed"

function endpoint(): { id: string; key: string } | null {
  const id = process.env.RUNPOD_BACKGROUND_ENDPOINT_ID
  const key = process.env.RUNPOD_API_KEY
  return id && key ? { id, key } : null
}

export function backgroundCleanConfigured(): boolean {
  return endpoint() !== null
}

/** Queue a raw recording for background replacement. Returns the job id. */
export async function submitBackgroundClean(rawKey: string, color: string, logoPath?: string): Promise<string> {
  const target = endpoint()
  if (!target) throw new Error("Background replacement is not configured")

  const [sourceUrl, uploadUrl] = await Promise.all([
    getPresignedDownloadUrl(rawKey, JOB_URL_TTL_SECS),
    getPresignedUploadUrl(cleanKeyFor(rawKey), "video/mp4", JOB_URL_TTL_SECS),
  ])
  const res = await fetch(`${RUNPOD_API}/${target.id}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${target.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: {
        source_url: sourceUrl,
        upload_url: uploadUrl,
        color,
        ...(logoPath && { logo_url: `${publicAppUrl()}${logoPath}` }),
      },
      policy: { executionTimeout: JOB_TIMEOUT_MS },
    }),
  })
  if (!res.ok) throw new Error(`RunPod refused the job (${res.status})`)
  const { id } = await res.json() as { id?: string }
  if (!id) throw new Error("RunPod returned no job id")
  return id
}

export async function backgroundCleanStatus(jobId: string): Promise<CleanStatus> {
  const target = endpoint()
  if (!target) throw new Error("Background replacement is not configured")
  const res = await fetch(`${RUNPOD_API}/${target.id}/status/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${target.key}` },
    cache: "no-store",
  })
  // RunPod forgets finished jobs after a while; by then the outcome is on S3.
  if (res.status === 404) return "failed"
  if (!res.ok) throw new Error(`RunPod status check failed (${res.status})`)
  const { status } = await res.json() as { status?: string }
  if (status === "COMPLETED") return "done"
  if (status === "IN_QUEUE") return "queued"
  if (status === "IN_PROGRESS") return "running"
  return "failed"
}
