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
 * Upload ceiling. Files over 8 MB go up in parts straight to S3 (which takes
 * up to 5 TB) and `fileSize` columns are double precision, so this is a sanity
 * cap rather than a storage one — long signed videos can run well past 2 GB.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024
export const MAX_UPLOAD_LABEL = "20 GB"
