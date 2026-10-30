import prisma from "@/lib/prisma"
import { NotificationType } from "@/app/generated/prisma/enums"
import { createNotification } from "@/lib/notifications"
import { rawKeyFromUrl } from "@/lib/background-clean-keys"

export const MAX_REQUEST_WORD = 60
export const MAX_REQUEST_CONTEXT = 300

/** Where a student lands to see a sign they asked for. */
export function dictionaryLink(word: string): string {
  return `/student/dictionary?q=${encodeURIComponent(word)}`
}

/**
 * Called whenever a sign is saved with a video or picture, and again when a
 * video's background replacement finishes: once students can actually see the
 * sign, every open request for it (linked to it, or asking for the same word)
 * is marked added and each student who asked is told — in the app and by
 * email. Never throws: the sign itself is already saved.
 */
export async function fulfilSignRequests(sign: {
  id: string
  word: string
  videoUrl: string | null
  imageUrl: string | null
}): Promise<void> {
  if (!sign.videoUrl && !sign.imageUrl) return
  try {
    // A take still having its background replaced is hidden from students;
    // this runs again when that finishes.
    // (The same test as urlsHiddenFromStudents, kept here because
    // lib/background-clean calls into this file.)
    const rawKey = sign.videoUrl ? rawKeyFromUrl(sign.videoUrl) : null
    const videoVisible = !!sign.videoUrl && (
      !rawKey || !!(await prisma.videoCleanJob.findFirst({ where: { rawKey, status: "DONE" }, select: { id: true } }))
    )
    if (!videoVisible && !sign.imageUrl) return

    const open = await prisma.signRequest.findMany({
      where: {
        status: "OPEN",
        OR: [{ signId: sign.id }, { word: { equals: sign.word, mode: "insensitive" } }],
      },
      select: { id: true, studentId: true, context: true },
    })
    if (!open.length) return

    await prisma.signRequest.updateMany({
      where: { id: { in: open.map((r) => r.id) } },
      data: { status: "ADDED", signId: sign.id, resolvedAt: new Date() },
    })

    // One message per student, even if they asked for the word twice.
    const told = new Set<string>()
    for (const request of open) {
      if (told.has(request.studentId)) continue
      told.add(request.studentId)
      await createNotification(
        request.studentId,
        NotificationType.DICTIONARY_SIGN_ADDED,
        `"${sign.word}" is now in the dictionary`,
        `The sign you asked for, "${sign.word}"${request.context ? ` (${request.context})` : ""}, has been added to the BSL dictionary. Have a look and add it to My signs to practise it.`,
        dictionaryLink(sign.word),
      )
    }
  } catch (err) {
    console.error(`[sign-requests] fulfilSignRequests failed (sign=${sign.id})`, err)
  }
}

export type RequestedSign = {
  /** The dictionary sign's id, or `request:<word>` for a word not in it yet. */
  id: string
  word: string
  category?: string
  level?: import("@/app/generated/prisma/client").CourseLevel
  description?: string
  requests: { studentName: string; context: string; createdAt: Date }[]
}

/**
 * Open requests that still need filming, one entry per word, oldest ask first.
 * A word already in the dictionary without a video uses that sign; a new word
 * gets a `request:` id and becomes a sign when its first take is saved.
 */
export async function requestedToFilm(): Promise<RequestedSign[]> {
  const open = await prisma.signRequest.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "asc" },
    select: {
      word: true,
      context: true,
      createdAt: true,
      signId: true,
      student: { select: { name: true } },
    },
  })
  if (!open.length) return []

  const groups = new Map<string, typeof open>()
  for (const r of open) {
    const key = r.word.toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), r])
  }

  const linkedIds = [...new Set(open.flatMap((r) => (r.signId ? [r.signId] : [])))]
  const signs = await prisma.sign.findMany({
    where: {
      OR: [
        ...(linkedIds.length ? [{ id: { in: linkedIds } }] : []),
        ...[...groups.keys()].map((w) => ({ word: { equals: w, mode: "insensitive" as const } })),
      ],
    },
    select: { id: true, word: true, category: true, level: true, description: true, videoUrl: true, imageUrl: true },
  })
  const byId = new Map(signs.map((s) => [s.id, s]))
  const byWord = new Map(signs.map((s) => [s.word.toLowerCase(), s]))

  const result: RequestedSign[] = []
  for (const [key, rows] of groups) {
    const linked = rows.find((r) => r.signId && byId.has(r.signId))
    const sign = linked ? byId.get(linked.signId!)! : byWord.get(key)
    // Filmed already (its background is still being replaced): nothing to do.
    if (sign && (sign.videoUrl || sign.imageUrl)) continue
    result.push({
      id: sign?.id ?? `request:${key}`,
      word: sign?.word ?? rows[0].word,
      category: sign?.category,
      level: sign?.level,
      description: sign?.description || undefined,
      requests: rows.map((r) => ({ studentName: r.student.name, context: r.context, createdAt: r.createdAt })),
    })
  }
  return result
}
