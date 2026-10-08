import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, type ListObjectsV2CommandOutput, type PutObjectCommandInput } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const REGION = process.env.AWS_REGION ?? "eu-west-2"
const BUCKET = process.env.AWS_S3_BUCKET ?? ""

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
})

/** Returns a presigned PUT URL valid for the given seconds (default 5 minutes) */
export async function getPresignedUploadUrl(key: string, contentType: string, expiresIn = 300): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(s3, command, { expiresIn })
}

/** Public URL for an object */
export function publicUrl(key: string): string {
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`
}

/**
 * Returns a presigned GET URL valid for the given seconds (default 4 hours).
 * Pass `downloadAs` to make the browser save the file under that name rather
 * than play it inline.
 */
export async function getPresignedDownloadUrl(key: string, expiresIn = 14400, downloadAs?: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(downloadAs && {
      ResponseContentDisposition: `attachment; filename="${downloadAs.replace(/[^\w.\-()[\] ]/g, "_")}"`,
    }),
  })
  return getSignedUrl(s3, command, { expiresIn })
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

/** List the S3 keys under a given prefix. Returns an array of keys (no leading slash). */
export async function listObjectKeys(prefix: string): Promise<string[]> {
  const out: string[] = []
  let token: string | undefined = undefined
  while (true) {
    const res: ListObjectsV2CommandOutput = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }))
    for (const obj of res.Contents ?? []) {
      if (obj.Key) out.push(obj.Key)
    }
    if (!res.NextContinuationToken) break
    token = res.NextContinuationToken
  }
  return out
}

/** Download an object into memory. Throws if the key does not exist. */
export async function downloadObject(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  if (!res.Body) {
    throw new Error(`Object not found in storage: ${key}`)
  }
  return Buffer.from(await res.Body.transformToByteArray())
}

/** Returns true when the object exists in the bucket. */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

// ─── Multipart uploads ───────────────────────────────────────────────────────
// A single presigned PUT tops out at 5 GB and gives the browser no way to
// resume or report progress. Multipart splits the file into parts the browser
// PUTs independently, which is what lets classroom chat take a full-length
// video instead of a 50 MB clip.

/** S3 hard limits — the client sizes its parts against these. */
export const MULTIPART_MIN_PART_SIZE = 5 * 1024 * 1024      // S3 minimum (all but the last part)
export const MULTIPART_MAX_PARTS = 10_000                    // S3 maximum parts per upload

export type CompletedPart = { PartNumber: number; ETag: string }

/** Begin a multipart upload. Returns the uploadId the parts are attached to. */
export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const res = await s3.send(new CreateMultipartUploadCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  }))
  if (!res.UploadId) throw new Error("S3 did not return an UploadId")
  return res.UploadId
}

/**
 * Presign PUT URLs for the given part numbers, valid for 1 hour.
 *
 * Parts are signed in batches as the upload walks the file rather than all at
 * once: a 5 TB file is 10,000 parts, and URLs signed at the start of a
 * multi-hour upload would expire long before the last part is reached.
 */
export async function getPresignedUploadPartUrls(
  key: string,
  uploadId: string,
  partNumbers: number[],
  expiresIn = 3600,
): Promise<{ partNumber: number; url: string }[]> {
  return Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await getSignedUrl(
        s3,
        new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn },
      ),
    })),
  )
}

/** Stitch the uploaded parts into the final object. Parts must be in ascending order. */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: CompletedPart[],
): Promise<void> {
  await s3.send(new CompleteMultipartUploadCommand({
    Bucket: BUCKET,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber) },
  }))
}

/** Discard an in-flight multipart upload so its parts stop being billed. */
export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }))
}

/** Upload a buffer directly to S3 */
export async function uploadObject(
  
  key: string,
  body: Buffer,
  contentType: string,
  extra?: Partial<PutObjectCommandInput>,
): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, ...extra }))
}
