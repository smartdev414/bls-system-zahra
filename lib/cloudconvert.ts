// CloudConvert PPTX → PDF helper. Server-only.
//
// The PPTX renderer we use client-side can't decode WMF/EMF picture parts,
// which are common in decks copy-pasted from Word/Visio/ClipArt. We solve
// that by converting the deck to PDF server-side (CloudConvert uses
// LibreOffice under the hood, which rasterizes those formats), and then
// rendering the PDF — that path handles everything.

import CloudConvert from "cloudconvert"

const CC_API_KEY = process.env.CLOUDCONVERT_API_KEY ?? ""

export async function convertPptxToPdf(
  sourceUrl: string,
  sourceFileName: string,
): Promise<Buffer> {
  if (!CC_API_KEY) {
    throw new Error("CLOUDCONVERT_API_KEY is not configured")
  }

  const cloudConvert = new CloudConvert(CC_API_KEY)

  // Always send "pptx" as the input format — CloudConvert accepts both .ppt
  // and .pptx via that key, and detecting from the filename keeps it simple.
  let job = await cloudConvert.jobs.create({
    tasks: {
      "import-pptx": {
        operation: "import/url",
        url: sourceUrl,
        filename: sourceFileName,
      },
      "convert-to-pdf": {
        operation: "convert",
        input: "import-pptx",
        input_format: "pptx",
        output_format: "pdf",
      },
      "export-pdf": {
        operation: "export/url",
        input: "convert-to-pdf",
      },
    },
  })

  job = await cloudConvert.jobs.wait(job.id)

  if (job.status !== "finished") {
    const failed = job.tasks.find((t) => t.status === "error")
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
  const arrayBuffer = await pdfRes.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
