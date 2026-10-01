import { randomUUID } from "crypto"

/**
 * Sanitize a user-supplied filename for use as an S3 object key segment.
 * Keeps the original name recognizable while blocking path traversal and
 * characters that break URLs or S3 keys.
 */
export function sanitizeUploadFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop()?.trim() || "file"
  const cleaned = base
    // Spaces → underscore so public S3 URLs stay valid without encoding issues
    .replace(/\s+/g, "_")
    .replace(/[^\w.\-()[\]]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180)
    .replace(/^_+|_+$/g, "")
    // The bucket policy that keeps video private matches on the file suffix and
    // is case-sensitive, so `.MOV` must be stored as `.mov`.
    .replace(/\.[A-Za-z0-9]+$/, (ext) => ext.toLowerCase())
  return cleaned || "file"
}

/**
 * Build a unique S3 key that still ends with the original filename so browsers
 * show/download the real name instead of a bare UUID.
 *
 * Example: `videos/userId/a1b2c3d4/My Lesson Intro.mp4`
 */
export function uniqueUploadKey(prefix: string, fileName: string): string {
  const safeName = sanitizeUploadFileName(fileName)
  return `${prefix.replace(/\/+$/, "")}/${randomUUID()}/${safeName}`
}

/**
 * Like uniqueUploadKey, but forces a specific extension (e.g. images converted
 * to `.webp`). The original basename is preserved.
 */
export function uniqueUploadKeyWithExt(prefix: string, fileName: string, ext: string): string {
  const safeName = sanitizeUploadFileName(fileName)
  const bare = safeName.includes(".")
    ? safeName.slice(0, safeName.lastIndexOf("."))
    : safeName
  const normalizedExt = ext.replace(/^\./, "")
  return `${prefix.replace(/\/+$/, "")}/${randomUUID()}/${bare || "file"}.${normalizedExt}`
}
