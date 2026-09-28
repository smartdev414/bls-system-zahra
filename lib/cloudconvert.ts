// CloudConvert PPTX → PDF helper. Server-only.
//
// The PPTX renderer we use client-side can't decode WMF/EMF picture parts,
// which are common in decks copy-pasted from Word/Visio/ClipArt. We solve
// that by converting the deck to PDF server-side (CloudConvert uses
// LibreOffice under the hood, which rasterizes those formats), and then
// rendering the PDF — that path handles everything.

import { Readable } from "node:stream"
import CloudConvert from "cloudconvert"
import type { Job } from "cloudconvert/built/lib/JobsResource"

const CC_API_KEY = process.env.CLOUDCONVERT_API_KEY ?? ""

// Second CloudConvert account, used when the primary one can't start a job
// (typically out of conversion credits). Optional.
const CC_FALLBACK_API_KEY = process.env.CLOUDCONVERT_API_KEY2 ?? ""

// Jobs have to be waited on with the account that created them, so jobs from
// the fallback account carry this prefix through the browser round trip.
const FALLBACK_JOB_PREFIX = "fb:"

function inputFormatForFileName(fileName: string): "ppt" | "pptx" {
  return /\.ppt$/i.test(fileName) && !/\.pptx$/i.test(fileName) ? "ppt" : "pptx"
}

function getClient(fallback = false): CloudConvert {
  const key = fallback ? CC_FALLBACK_API_KEY : CC_API_KEY
  if (!key) {
    throw new Error(`${fallback ? "CLOUDCONVERT_API_KEY2" : "CLOUDCONVERT_API_KEY"} is not configured`)
  }
  return new CloudConvert(key)
}

/** Create a job on the primary account, falling back to the second one if that fails. */
async function createJob(sourceFileName: string): Promise<{ job: Job; fallback: boolean }> {
  const tasks = pptxJobTasks(sourceFileName)
  try {
    return { job: await getClient().jobs.create({ tasks }), fallback: false }
  } catch (err) {
    if (!CC_FALLBACK_API_KEY) throw err
    console.warn("[cloudconvert] primary account failed to create job; using fallback", err)
    return { job: await getClient(true).jobs.create({ tasks }), fallback: true }
  }
}

function toJobId(job: Job, fallback: boolean): string {
  return fallback ? `${FALLBACK_JOB_PREFIX}${job.id}` : job.id
}

function pptxJobTasks(sourceFileName: string) {
  const inputFormat = inputFormatForFileName(sourceFileName)
  return {
    "import-pptx": { operation: "import/upload" as const },
    "convert-to-pdf": {
      operation: "convert" as const,
      input: "import-pptx",
      input_format: inputFormat,
      output_format: "pdf",
    },
    "export-pdf": {
      operation: "export/url" as const,
      input: "convert-to-pdf",
    },
  }
}

/** Create a job and return browser-upload credentials for the source deck. */
export async function createPptxToPdfUpload(sourceFileName: string): Promise<{
  jobId: string
  uploadUrl: string
  uploadParameters: Record<string, string>
}> {
  const { job, fallback } = await createJob(sourceFileName)

  const uploadTask = job.tasks?.find((t) => t.name === "import-pptx")
  const form = uploadTask?.result?.form
  if (!form?.url || !form.parameters) {
    throw new Error("CloudConvert upload task is not ready")
  }

  return {
    jobId: toJobId(job, fallback),
    uploadUrl: form.url,
    uploadParameters: form.parameters as Record<string, string>,
  }
}

/** Wait for a job started via createPptxToPdfUpload and return the PDF bytes. */
export async function finishPptxToPdfJob(jobId: string): Promise<Buffer> {
  const fallback = jobId.startsWith(FALLBACK_JOB_PREFIX)
  const cloudConvert = getClient(fallback)
  const job = await cloudConvert.jobs.wait(fallback ? jobId.slice(FALLBACK_JOB_PREFIX.length) : jobId)

  if (job.status !== "finished") {
    const failed = job.tasks?.find((t) => t.status === "error")
    throw new Error(
      `CloudConvert job did not finish (status: ${job.status}${failed?.message ? `, ${failed.message}` : ""})`,
    )
  }

  const [exportedFile] = cloudConvert.jobs.getExportUrls(job)
  if (!exportedFile?.url) {
    throw new Error("CloudConvert export task returned no file URL")
  }

  const pdfRes = await fetch(exportedFile.url)
  if (!pdfRes.ok) {
    throw new Error(`Failed to download converted PDF (${pdfRes.status})`)
  }
  return Buffer.from(await pdfRes.arrayBuffer())
}

/** Server-side upload (e.g. tests or non-browser callers). */
export async function convertPptxToPdf(
  sourceBuffer: Buffer,
  sourceFileName: string,
): Promise<Buffer> {
  const { job, fallback } = await createJob(sourceFileName)
  const cloudConvert = getClient(fallback)

  const uploadTask = job.tasks?.find((t) => t.name === "import-pptx")
  if (!uploadTask) {
    throw new Error("CloudConvert import task was not created")
  }

  await cloudConvert.tasks.upload(
    uploadTask,
    Readable.from(sourceBuffer),
    sourceFileName,
    sourceBuffer.byteLength,
  )

  return finishPptxToPdfJob(toJobId(job, fallback))
}
