// Extra practice material for students, kept in folders: exam samples,
// YouTube videos, slides to read. Admins add it on /admin/student-resources,
// students open it on /student/resources. Shared by the API and both screens.

import { parseVideoLink, videoLinkUrl, VIDEO_LINK_MIME } from "@/lib/video-link"
import type { CourseLevel } from "@/lib/levels"

export type StudentResourceFolder = "EXAM_SAMPLES" | "VIDEO_LESSONS" | "SLIDES" | "PRACTICE" | "LINKS"

/** In the order the folders are shown. */
export const STUDENT_RESOURCE_FOLDERS: readonly StudentResourceFolder[] =
  ["VIDEO_LESSONS", "EXAM_SAMPLES", "SLIDES", "PRACTICE", "LINKS"]

export const FOLDER_INFO: Record<StudentResourceFolder, { label: string; blurb: string }> = {
  VIDEO_LESSONS: { label: "Video lessons", blurb: "Watch and practise along" },
  EXAM_SAMPLES:  { label: "Exam samples",  blurb: "See what the exam looks like" },
  SLIDES:        { label: "Slides & reading", blurb: "Slides and notes to read" },
  PRACTICE:      { label: "Practice",      blurb: "Worksheets and exercises" },
  LINKS:         { label: "Useful links",  blurb: "Websites worth a visit" },
}

export function isStudentResourceFolder(value: unknown): value is StudentResourceFolder {
  return STUDENT_RESOURCE_FOLDERS.includes(value as StudentResourceFolder)
}

/** One item as the API returns it. */
export type StudentResourceItem = {
  id: string
  folder: StudentResourceFolder
  title: string
  description: string | null
  url: string
  isLink: boolean
  fileName: string | null
  fileSize: number | null
  mimeType: string | null
  level: CourseLevel | null
  createdAt: string
}

/**
 * A pasted web address, ready to store: YouTube and Vimeo in the one form the
 * players recognise, anything else as a plain https page. Null if it isn't a
 * web address at all.
 */
export function normalizeResourceLink(raw: string): { url: string; mimeType: string | null } | null {
  const video = parseVideoLink(raw)
  if (video) return { url: videoLinkUrl(video), mimeType: VIDEO_LINK_MIME[video.provider] }
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (!url.hostname.includes(".")) return null
  return { url: url.toString(), mimeType: null }
}

/** YouTube's still for a video link, for the card picture. */
export function youtubeThumbnail(url: string): string | null {
  const link = parseVideoLink(url)
  return link?.provider === "youtube" ? `https://i.ytimg.com/vi/${link.id}/hqdefault.jpg` : null
}
