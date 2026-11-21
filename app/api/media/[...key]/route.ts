import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession, type SessionPayload } from "@/lib/auth"
import { getPresignedDownloadUrl, objectExists } from "@/lib/s3"
import { requireTutorAccess } from "@/lib/tutor-access"
import { cleanKeyFor, isRawRecordingKey } from "@/lib/background-clean-keys"
import { assertCanAccessSession, recordingViewers } from "@/lib/session-access"
import { isProtectedMediaKey } from "@/lib/protected-media"
import { withAudit } from "@/lib/audit"
import { recorderSessionId } from "@/lib/recorder-pass"
import { can, courseTeachScope } from "@/lib/permissions"
import { parseAnswerVideoKey } from "@/lib/test-recordings"

/**
 * The only way to a private video (see lib/protected-media.ts).
 *
 * Checks who is asking, then redirects to a signed S3 URL. The redirect rather
 * than a proxied stream keeps video bytes off the serverless function; the
 * signature is what stops the link working for anyone it is passed on to once
 * it expires.
 */

// Long enough to sit through a full-length recording segment with pauses. The
// player asks again (and gets a fresh URL) if this runs out mid-watch.
const MEDIA_URL_TTL_SECS = 3 * 60 * 60
// A download starts straight away, so its link only needs to live a moment.
const DOWNLOAD_URL_TTL_SECS = 5 * 60

const notFound = () => NextResponse.json({ message: "Not found" }, { status: 404 })

/** Returns an error response when the caller may not have this file, else null. */
async function denyReason(session: SessionPayload, key: string): Promise<NextResponse | null> {
  // Class recordings: same rule as GET /api/sessions/[id]/recording — the
  // tutor who ran the class, the students it was for, and admins.
  if (key.startsWith("recordings/")) {
    if (session.role === "ADMIN") return null
    const m = key.match(/^recordings\/([^/]+)\.mp4$/)
    if (!m) return notFound()
    // `{id}.mp4` is the first segment, `{id}-2.mp4` onwards the later ones.
    const sessionIds = [m[1], m[1].replace(/-\d+$/, "")]
    const liveSession = await prisma.liveSession.findFirst({
      where: { id: { in: sessionIds }, ...recordingViewers(session.sub) },
      select: { id: true },
    })
    return liveSession ? null : notFound()
  }

  // Chat attachments belong to one class: `classroom-chat/{sessionId}/{userId}/…`
  if (key.startsWith("classroom-chat/")) {
    const sessionId = key.split("/")[1]
    const access = await assertCanAccessSession(session, sessionId)
    return access.error ?? null
  }

  // A student's recording in a test: theirs, and the course's teaching staff's.
  if (key.startsWith("test-answers/")) {
    const parsed = parseAnswerVideoKey(key)
    if (!parsed) return notFound()
    if (session.role === "STUDENT") return parsed.userId === session.sub ? null : notFound()
    if (!can(session.role, "resources.view")) return notFound()
    const lesson = await prisma.lesson.findFirst({
      where: { id: parsed.lessonId, section: { course: courseTeachScope(session) } },
      select: { id: true },
    })
    return lesson ? null : notFound()
  }

  // Lesson, dictionary and presented videos are reused across courses and
  // classes (library, recent presentations), so there is no single owner to
  // check against — being signed in is the gate, and the key is unguessable.
  return null
}

/** Whether some lesson file stored at `key` lets students download it. */
async function studentMayDownload(key: string): Promise<boolean> {
  // Stored URLs end in the key, either as written or percent-encoded.
  const encoded = key.split("/").map(encodeURIComponent).join("/")
  const asset = await prisma.lessonAsset.findFirst({
    where: {
      allowDownload: true,
      OR: [{ fileUrl: { endsWith: `/${key}` } }, { fileUrl: { endsWith: `/${encoded}` } }],
    },
    select: { id: true },
  })
  return asset !== null
}

/** The name a download is saved under: a student's recording by its date, anything else by its own name. */
function downloadName(key: string): string | undefined {
  const recording = parseAnswerVideoKey(key)
  if (recording) {
    const day = new Date(recording.recordedAt).toISOString().slice(0, 10)
    return `my-signing-${day}-${recording.recordedAt % 100000}.${key.split(".").pop()}`
  }
  return key.split("/").pop()
}

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  try {
    const { key: segments } = await params
    const key = segments.join("/")
    if (!isProtectedMediaKey(key)) return notFound()

    const session = await getSession()
    if (!session) {
      // The class recorder (lib/recorder-pass.ts) is nobody's login, but must
      // play a video the tutor presents. It gets presented material only —
      // never a recording or a chat file — to watch, not to download.
      const presented = key.startsWith("slides/") || key.startsWith("videos/")
      if (!presented || !(await recorderSessionId()) || req.nextUrl.searchParams.has("download")) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
      }
      const res = NextResponse.redirect(await getPresignedDownloadUrl(key, MEDIA_URL_TTL_SECS), 302)
      res.headers.set("Cache-Control", "private, no-store")
      return res
    }

    const denied = await denyReason(session, key)
    if (denied) return denied

    // Saving a copy is for teaching staff only; students watch in the player —
    // except their own recordings in tests, which are theirs to keep (denyReason
    // has already made sure a student only reaches their own).
    // A lesson video whose teacher ticked "Students can download" is the other
    // exception.
    const download = req.nextUrl.searchParams.has("download")
    const staff = session.role === "TUTOR" || session.role === "ADMIN"
    if (download && !staff && !key.startsWith("test-answers/") && !(await studentMayDownload(key))) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }
    if (download && staff) {
      const off = await requireTutorAccess(session, "download")
      if (off) return off
    }

    // A recording sent for background replacement (lib/background-clean.ts)
    // keeps its raw address; serve the finished version once there is one.
    // Until then it shows the tutor's real room, so students don't get it.
    let serveKey = key
    if (isRawRecordingKey(key)) {
      const cleanKey = cleanKeyFor(key)
      if (await objectExists(cleanKey)) serveKey = cleanKey
      else if (session.role === "STUDENT") return notFound()
    }

    const url = download
      ? await getPresignedDownloadUrl(serveKey, DOWNLOAD_URL_TTL_SECS, downloadName(serveKey))
      : await getPresignedDownloadUrl(serveKey, MEDIA_URL_TTL_SECS)
    const res = NextResponse.redirect(url, 302)
    // The signed URL is per-request — never let a shared cache replay it.
    res.headers.set("Cache-Control", "private, no-store")
    return res
  } catch (err) {
    console.error("[GET /api/media/[...key]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export const GET = withAudit(handleGET)
