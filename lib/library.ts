// Shared shape of the tutor resource library, used by the API and the picker.

export type LibraryAssetType = "VIDEO" | "PDF" | "IMAGE" | "DOCUMENT" | "AUDIO" | "SUBTITLE"

export type LibraryItem = {
  /** LibraryFile id for files in the library; the source row's id otherwise. */
  id: string
  /**
   * "library" — uploaded to the library, and can be removed from it.
   * "used"    — not in the library, but already attached to one of this tutor's
   *             lessons or sessions, so it can be picked again without re-uploading.
   */
  source: "library" | "used"
  title: string
  fileUrl: string
  fileName: string
  fileSize: number | null
  mimeType: string | null
  assetType: LibraryAssetType
  presentationUrl: string | null
  presentationMimeType: string | null
  /** Where a "used" file was found, e.g. a lesson or session title. */
  usedIn: string | null
  createdAt: string
}

export const LIBRARY_ASSET_TYPES: readonly LibraryAssetType[] =
  ["VIDEO", "PDF", "IMAGE", "DOCUMENT", "AUDIO", "SUBTITLE"]

/** Session resources don't record an asset type; derive it the way presign does. */
export function assetTypeFromMime(mimeType: string | null | undefined): LibraryAssetType {
  const m = mimeType ?? ""
  if (m.startsWith("video/")) return "VIDEO"
  if (m.startsWith("image/")) return "IMAGE"
  if (m.startsWith("audio/")) return "AUDIO"
  if (m === "application/pdf") return "PDF"
  if (m === "text/vtt") return "SUBTITLE"
  return "DOCUMENT"
}

/** Longest caption a tutor can type or prepare — about two lines on screen. */
export const TYPED_CAPTION_MAX = 300

/** Prepared captions kept per tutor. */
export const PREPARED_CAPTION_LIMIT = 50

/** Prepared captions are edited as text, one per line. */
export function parsePreparedCaptions(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim().slice(0, TYPED_CAPTION_MAX))
    .filter(Boolean)
    .slice(0, PREPARED_CAPTION_LIMIT)
}
