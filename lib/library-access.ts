// Server-only: which stored files a tutor or admin may pick, by id or by URL.
//
// The library list (GET /api/tutor/library) is built from three places: the
// LibraryFile table, lesson files on courses the person teaches, and resources
// on their own live sessions. Anything that acts on one of those files — the
// "use this file" screens, background replacement — has to answer the same
// question the list does, so the rule lives here.

import prisma from "@/lib/prisma"
import { courseTeachScope } from "@/lib/permissions"
import { assetTypeFromMime, type LibraryItem } from "@/lib/library"

type Who = { role: string; sub: string }

/** How the file is being looked for. One of the two must be given. */
export type FileRef = { id?: string; fileUrl?: string }

function visibleLibraryFiles(session: Who) {
  return session.role === "ADMIN"
    ? { tutor: { role: "ADMIN" as const } }
    : { OR: [{ tutor: { role: "ADMIN" as const } }, { tutorId: session.sub }] }
}

/**
 * The file as the library list would describe it, or null if there is no
 * such file or this person may not see it.
 */
export async function findVisibleFile(session: Who, ref: FileRef): Promise<LibraryItem | null> {
  if (!ref.id && !ref.fileUrl) return null
  const isAdmin = session.role === "ADMIN"
  const match = ref.id ? { id: ref.id } : { fileUrl: ref.fileUrl }

  const file = await prisma.libraryFile.findFirst({
    where: { ...match, ...visibleLibraryFiles(session) },
    include: { tutor: { select: { role: true } } },
  })
  if (file) {
    const shared = file.tutor.role === "ADMIN"
    return {
      id: file.id,
      source: "library",
      shared,
      canRemove: isAdmin ? shared : file.tutorId === session.sub,
      level: file.level,
      title: file.title,
      fileUrl: file.fileUrl,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      assetType: file.assetType,
      presentationUrl: file.presentationUrl,
      presentationMimeType: file.presentationMimeType,
      usedIn: null,
      createdAt: file.createdAt.toISOString(),
    }
  }

  const asset = await prisma.lessonAsset.findFirst({
    where: { ...match, lesson: { section: { course: courseTeachScope(session) } } },
    include: { lesson: { select: { title: true } } },
  })
  if (asset) {
    return {
      id: asset.id,
      source: "used",
      shared: false,
      canRemove: false,
      level: null,
      title: asset.fileName,
      fileUrl: asset.fileUrl,
      fileName: asset.fileName,
      fileSize: asset.fileSize,
      mimeType: asset.mimeType,
      assetType: asset.type,
      presentationUrl: null,
      presentationMimeType: null,
      usedIn: `Lesson: ${asset.lesson.title}`,
      createdAt: asset.createdAt.toISOString(),
    }
  }

  const resource = await prisma.liveSessionResource.findFirst({
    where: { ...match, session: { tutorId: session.sub }, title: { not: "__presentation__" } },
    include: { session: { select: { title: true } } },
  })
  if (resource) {
    return {
      id: resource.id,
      source: "used",
      shared: false,
      canRemove: false,
      level: null,
      title: resource.fileName,
      fileUrl: resource.fileUrl,
      fileName: resource.fileName,
      fileSize: resource.fileSize,
      mimeType: resource.mimeType,
      assetType: assetTypeFromMime(resource.mimeType),
      presentationUrl: resource.presentationUrl,
      presentationMimeType: resource.presentationMimeType,
      usedIn: resource.session?.title ? `Session: ${resource.session.title}` : "Live session",
      createdAt: resource.createdAt.toISOString(),
    }
  }

  return null
}
