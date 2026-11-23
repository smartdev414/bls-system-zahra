// File types tutors/admins can upload through /api/upload/presign and
// /api/upload/multipart, with the S3 folder each lands in. Client-safe (no
// server imports) so the browser can label an upload's asset type too.
// Images are NOT listed here — they go through /api/upload/image for WebP conversion.

export const ALLOWED_UPLOAD_TYPES: Record<string, { prefix: string; assetType: string }> = {
  "video/mp4":        { prefix: "videos",    assetType: "VIDEO" },
  "video/webm":       { prefix: "videos",    assetType: "VIDEO" },
  "video/quicktime":  { prefix: "videos",    assetType: "VIDEO" },
  "application/pdf":  { prefix: "documents", assetType: "PDF" },
  "audio/mpeg":       { prefix: "audio",     assetType: "AUDIO" },
  "audio/wav":        { prefix: "audio",     assetType: "AUDIO" },
  "text/vtt":         { prefix: "subtitles", assetType: "SUBTITLE" },
  "application/msword":                                                       { prefix: "documents", assetType: "DOCUMENT" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":  { prefix: "documents", assetType: "DOCUMENT" },
  "application/vnd.ms-powerpoint":                                            { prefix: "documents", assetType: "DOCUMENT" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { prefix: "documents", assetType: "DOCUMENT" },
  "application/vnd.ms-excel":                                                 { prefix: "documents", assetType: "DOCUMENT" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":        { prefix: "documents", assetType: "DOCUMENT" },
}

/**
 * Upload ceiling. Storage could take far more (multipart goes to 5 TB), but
 * `fileSize` columns are Postgres INT, which tops out just under 2 GiB.
 */
export const MAX_UPLOAD_BYTES = 2000 * 1024 * 1024
export const MAX_UPLOAD_LABEL = "2 GB"
