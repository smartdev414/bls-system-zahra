// CloudConvert PPTX → PDF helper. Server-only.
//
// The PPTX renderer we use client-side can't decode WMF/EMF picture parts,
// which are common in decks copy-pasted from Word/Visio/ClipArt. We solve
// that by converting the deck to PDF server-side (CloudConvert uses
// LibreOffice under the hood, which rasterizes those formats), and then
// rendering the PDF — that path handles everything.

import { Readable } from "node:stream"
import CloudConvert from "cloudconvert"

const CC_API_KEY = process.env.CLOUDCONVERT_API_KEY ?? ""

function inputFormatForFileName(fileName: string): "ppt" | "pptx" {
  return /\.ppt$/i.test(fileName) && !/\.pptx$/i.test(fileName) ? "ppt" : "pptx"
}

function getClient(): CloudConvert {
  if (!CC_API_KEY) {
    throw new Error("CLOUDCONVERT_API_KEY is not configured")
  }
  return new CloudConvert(CC_API_KEY)
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
  const cloudConvert = getClient()
  const job = await cloudConvert.jobs.create({ tasks: pptxJobTasks(sourceFileName) })

  const uploadTask = job.tasks?.find((t) => t.name === "import-pptx")
  const form = uploadTask?.result?.form
  if (!form?.url || !form.parameters) {
    throw new Error("CloudConvert upload task is not ready")
  }

  return {
    jobId: job.id,
    uploadUrl: form.url,
    uploadParameters: form.parameters as Record<string, string>,
  }
}

/** Wait for a job started via createPptxToPdfUpload and return the PDF bytes. */
export async function finishPptxToPdfJob(jobId: string): Promise<Buffer> {
  const cloudConvert = getClient()
  const job = await cloudConvert.jobs.wait(jobId)

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
  const cloudConvert = getClient()
  const job = await cloudConvert.jobs.create({ tasks: pptxJobTasks(sourceFileName) })

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

  return finishPptxToPdfJob(job.id)
}
