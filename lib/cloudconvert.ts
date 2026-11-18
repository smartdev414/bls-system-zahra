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

/**
 * CloudConvert accounts, tried in order when one can't start a job (typically
 * out of conversion credits): CLOUDCONVERT_API_KEY, then the optional
 * CLOUDCONVERT_API_KEY2 and CLOUDCONVERT_API_KEY3.
 *
 * Jobs have to be waited on with the account that created them, so the job id
 * carries the account through the browser round trip: no tag for the first,
 * then each account's own tag ("fb:" kept for the second so ids issued before
 * the third account existed still resolve).
 */
const ACCOUNTS = [
  { env: "CLOUDCONVERT_API_KEY", tag: "" },
  { env: "CLOUDCONVERT_API_KEY2", tag: "fb:" },
  { env: "CLOUDCONVERT_API_KEY3", tag: "fb3:" },
] as const

type Account = number

function inputFormatForFileName(fileName: string): "ppt" | "pptx" {
  return /\.ppt$/i.test(fileName) && !/\.pptx$/i.test(fileName) ? "ppt" : "pptx"
}

const keyFor = (account: Account) => process.env[ACCOUNTS[account].env] ?? ""

function getClient(account: Account = 0): CloudConvert {
  const key = keyFor(account)
  if (!key) throw new Error(`${ACCOUNTS[account].env} is not configured`)
  return new CloudConvert(key)
}

/** Create a job on the first account that will take it. */
async function createJob(sourceFileName: string): Promise<{ job: Job; account: Account }> {
  const tasks = pptxJobTasks(sourceFileName)
  const configured = ACCOUNTS.map((_, i) => i).filter((i) => i === 0 || keyFor(i))
  let lastErr: unknown
  for (const account of configured) {
    try {
      return { job: await getClient(account).jobs.create({ tasks }), account }
    } catch (err) {
      lastErr = err
      const next = configured[configured.indexOf(account) + 1]
      if (next !== undefined) {
        console.warn(`[cloudconvert] ${ACCOUNTS[account].env} failed to create job; trying ${ACCOUNTS[next].env}`, err)
      }
    }
  }
  throw lastErr
}

function toJobId(job: Job, account: Account): string {
  return `${ACCOUNTS[account].tag}${job.id}`
}

/** The account a job id belongs to, and the id CloudConvert knows it by. */
function fromJobId(jobId: string): { account: Account; id: string } {
  // Longest tag first, so "fb3:" is not read as "fb:".
  for (let account = ACCOUNTS.length - 1; account > 0; account--) {
    const { tag } = ACCOUNTS[account]
    if (jobId.startsWith(tag)) return { account, id: jobId.slice(tag.length) }
  }
  return { account: 0, id: jobId }
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
  const { job, account } = await createJob(sourceFileName)

  const uploadTask = job.tasks?.find((t) => t.name === "import-pptx")
  const form = uploadTask?.result?.form
  if (!form?.url || !form.parameters) {
    throw new Error("CloudConvert upload task is not ready")
  }

  return {
    jobId: toJobId(job, account),
    uploadUrl: form.url,
    uploadParameters: form.parameters as Record<string, string>,
  }
}

/** Wait for a job started via createPptxToPdfUpload and return the PDF bytes. */
export async function finishPptxToPdfJob(jobId: string): Promise<Buffer> {
  const { account, id } = fromJobId(jobId)
  const cloudConvert = getClient(account)
  const job = await cloudConvert.jobs.wait(id)

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
  const { job, account } = await createJob(sourceFileName)
  const cloudConvert = getClient(account)

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

  return finishPptxToPdfJob(toJobId(job, account))
}
