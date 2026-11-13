/**
 * YouTube and Vimeo links, used in place of an uploaded video.
 *
 * A lesson video or a classroom video can be a link instead of a file. It is
 * kept wherever a file URL would be (LessonAsset.fileUrl, the classroom stage
 * `url`), in the canonical form `videoLinkUrl` returns, so every player can tell
 * a link from a stored file with `parseVideoLink` alone. Nothing about the
 * database or the classroom protocol had to change for it.
 *
 * Pure — shared by the server, the browser and (copied) the phone app.
 */

export type VideoLink = {
  provider: "youtube" | "vimeo"
  /** YouTube video id, or Vimeo's numeric id. */
  id: string
  /** Vimeo's privacy hash, for unlisted videos (vimeo.com/123/abc or ?h=abc). */
  hash?: string
}

/** Kept on LessonAsset.mimeType so lists can say what the asset is without parsing. */
export const VIDEO_LINK_MIME: Record<VideoLink["provider"], string> = {
  youtube: "video/x-youtube",
  vimeo: "video/x-vimeo",
}

export const VIDEO_LINK_LABEL: Record<VideoLink["provider"], string> = {
  youtube: "YouTube video",
  vimeo: "Vimeo video",
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const YT_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
  "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be", "www.youtu.be",
])
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"])

/** Recognise a YouTube or Vimeo video link. Anything else (a stored file, a channel page) → null. */
export function parseVideoLink(raw: string | null | undefined): VideoLink | null {
  if (!raw) return null
  let url: URL
  try {
    // People paste "youtube.com/watch?v=…" without the scheme.
    url = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split("/").filter(Boolean)

  if (YT_HOSTS.has(host)) {
    let id: string | null = null
    if (host.endsWith("youtu.be")) id = parts[0] ?? null
    else if (parts[0] === "watch") id = url.searchParams.get("v")
    else if (["embed", "shorts", "live", "v", "e"].includes(parts[0] ?? "")) id = parts[1] ?? null
    return id && YT_ID.test(id) ? { provider: "youtube", id } : null
  }

  if (VIMEO_HOSTS.has(host)) {
    // player.vimeo.com/video/123?h=abc · vimeo.com/123 · vimeo.com/123/abc ·
    // vimeo.com/channels/staffpicks/123 · vimeo.com/showcase/1/video/123
    const at = parts.findIndex((p) => /^\d+$/.test(p) && p.length >= 5)
    if (at < 0) return null
    const id = parts[at]
    const next = parts[at + 1]
    const hash = url.searchParams.get("h") ?? (next && /^[0-9a-f]{6,}$/i.test(next) ? next : undefined)
    return hash ? { provider: "vimeo", id, hash } : { provider: "vimeo", id }
  }

  return null
}

/** The one URL a link is stored as. */
export function videoLinkUrl(link: VideoLink): string {
  if (link.provider === "youtube") return `https://www.youtube.com/watch?v=${link.id}`
  return link.hash ? `https://vimeo.com/${link.id}/${link.hash}` : `https://vimeo.com/${link.id}`
}

/** True for a stored URL that is a YouTube or Vimeo link rather than a file. */
export function isVideoLink(url: string | null | undefined): boolean {
  return parseVideoLink(url) !== null
}

/** A YouTube or Vimeo link in its stored form; any other URL (an uploaded file) unchanged. */
export function normalizeAssetUrl(url: string): string {
  const link = parseVideoLink(url)
  return link ? videoLinkUrl(link) : url
}
