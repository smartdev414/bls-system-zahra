/**
 * Which stored files are private, and how the browser reaches them.
 *
 * Uploads are saved in the database as plain S3 URLs. Video must not be
 * fetchable from that address — anyone holding the link could download it
 * without signing in — so the bucket policy blocks public reads for the keys
 * matched here (see docs/RUNBOOK.md §8) and the browser is pointed at
 * /api/media instead, which checks the caller and redirects to a short-lived
 * signed URL.
 *
 * Shared by the client (rewriting `src`) and the route (validating the key), so
 * the two can never disagree about what is protected. Keep the bucket policy in
 * docs/s3-bucket-policy.video-private.json in step with these rules.
 */

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i

/** Everything under these prefixes is private. */
const PRIVATE_PREFIXES = ["videos/", "recordings/"]

/** Mixed-content prefixes (images, PDFs, …): only their video files are private. */
const VIDEO_ONLY_PREFIXES = ["classroom-chat/", "slides/"]

const S3_HOST = /\.s3[.-]([a-z0-9-]+\.)?amazonaws\.com$/i

export const MEDIA_GATEWAY_PATH = "/api/media"

export function isProtectedMediaKey(key: string): boolean {
  if (key.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return false
  if (PRIVATE_PREFIXES.some((p) => key.startsWith(p))) return true
  return VIDEO_ONLY_PREFIXES.some((p) => key.startsWith(p)) && VIDEO_EXT.test(key)
}

/** Same-origin path that serves `key` to an authorised viewer. */
export function mediaGatewayPath(key: string): string {
  return `${MEDIA_GATEWAY_PATH}/${key.split("/").map(encodeURIComponent).join("/")}`
}

/**
 * Turn a stored file URL into the address the browser should load. Protected
 * files go through the gateway; everything else (images, PDFs, blob: previews,
 * external links) is returned untouched.
 */
export function mediaSrc(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (!S3_HOST.test(parsed.hostname)) return url

  let key: string
  try {
    key = decodeURIComponent(parsed.pathname.slice(1))
  } catch {
    return url
  }
  return isProtectedMediaKey(key) ? mediaGatewayPath(key) : url
}

/**
 * Link that saves the file instead of playing it. Only tutors and admins are
 * shown these, and the gateway refuses `download` from anyone else.
 */
export function mediaDownloadHref(url: string): string {
  const src = mediaSrc(url)
  return src.startsWith(`${MEDIA_GATEWAY_PATH}/`) ? `${src}?download=1` : src
}
