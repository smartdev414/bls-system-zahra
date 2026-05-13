import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, type PutObjectCommandInput } from "@aws-sdk/client-s3"
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

/** Returns a presigned PUT URL valid for 5 minutes */
export async function getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(s3, command, { expiresIn: 300 })
}

/** Public URL for an object */
export function publicUrl(key: string): string {
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`
}

/** Returns a presigned GET URL valid for the given seconds (default 4 hours) */
export async function getPresignedDownloadUrl(key: string, expiresIn = 14400): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
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

/** Upload a buffer directly to S3 */
export async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string,
  extra?: Partial<PutObjectCommandInput>,
): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, ...extra }))
}
