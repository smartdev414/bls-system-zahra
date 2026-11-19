import type { StudentResource } from "@/app/generated/prisma/client"
import { parseLevel } from "@/lib/levels"
import {
  isStudentResourceFolder, normalizeResourceLink, type StudentResourceItem,
} from "@/lib/student-resources"

export function toItem(r: StudentResource): StudentResourceItem {
  return {
    id: r.id,
    folder: r.folder,
    title: r.title,
    description: r.description,
    url: r.url,
    isLink: r.isLink,
    fileName: r.fileName,
    fileSize: r.fileSize,
    mimeType: r.mimeType,
    level: r.level,
    createdAt: r.createdAt.toISOString(),
  }
}

type Body = {
  folder?: unknown
  title?: unknown
  description?: unknown
  level?: unknown
  link?: unknown
  file?: { fileUrl?: unknown; fileName?: unknown; fileSize?: unknown; mimeType?: unknown } | null
}

export type ResourceInput = {
  folder: StudentResource["folder"]
  title: string
  description: string | null
  level: StudentResource["level"]
  url: string
  isLink: boolean
  fileName: string | null
  fileSize: number | null
  mimeType: string | null
}

/**
 * Reads what the admin screen sends. `partial` (editing) lets the file or link
 * be left out to keep the one already saved.
 */
export function parseResourceBody(body: Body, partial: boolean): { data: Partial<ResourceInput> } | { error: string } {
  const data: Partial<ResourceInput> = {}

  if (body.folder !== undefined || !partial) {
    if (!isStudentResourceFolder(body.folder)) return { error: "Choose a folder" }
    data.folder = body.folder
  }
  if (body.title !== undefined || !partial) {
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : ""
    if (!title) return { error: "Give it a title" }
    data.title = title
  }
  if (body.description !== undefined) {
    const d = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : ""
    data.description = d || null
  }
  if (body.level !== undefined) {
    const level = parseLevel(body.level)
    if (level === undefined) return { error: "Unknown level" }
    data.level = level
  }

  if (typeof body.link === "string" && body.link.trim()) {
    const link = normalizeResourceLink(body.link)
    if (!link) return { error: "That isn't a web address. Copy it from the browser's address bar." }
    Object.assign(data, { url: link.url, isLink: true, fileName: null, fileSize: null, mimeType: link.mimeType })
  } else if (body.file && typeof body.file.fileUrl === "string") {
    const f = body.file
    let url: URL
    try { url = new URL(f.fileUrl as string) } catch { return { error: "The upload didn't finish. Try again." } }
    if (url.protocol !== "https:") return { error: "The upload didn't finish. Try again." }
    Object.assign(data, {
      url: url.toString(),
      isLink: false,
      fileName: typeof f.fileName === "string" ? f.fileName.slice(0, 300) : null,
      fileSize: typeof f.fileSize === "number" && Number.isFinite(f.fileSize) ? Math.round(f.fileSize) : null,
      mimeType: typeof f.mimeType === "string" ? f.mimeType.slice(0, 200) : null,
    })
  } else if (!partial) {
    return { error: "Upload a file or paste a link" }
  }

  return { data }
}
